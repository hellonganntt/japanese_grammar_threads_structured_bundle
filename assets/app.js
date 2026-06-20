let lessonFiles = [];
const lessonCache = new Map();
let activeLesson = "";
let vocabPanelOpen = true;
let vocabMode = "flashcard";
let vocabCardIndex = 0;
let vocabCardFlipped = false;
let vocabShuffleEnabled = false;
let vocabCardOrder = [];
let currentAudio = null;
let currentAudioSequenceId = 0;
let pendingAudioSequence = null;
let suppressNextVocabAutoplay = false;
let suppressNextVocabIdleStart = false;
let vocabAudioAutoplayEnabled = localStorage.getItem("vocabAudioAutoplay") !== "false";
let vocabIdleLearningEnabled = localStorage.getItem("vocabIdleLearning") === "true";
let vocabIdleRunId = 0;
let vocabQuizQuestions = [];
let vocabQuizQuestionIndex = 0;
let vocabQuizSelectedChoice = null;
let vocabQuizScore = 0;

const AUDIO_RESULT = {
  BLOCKED: "blocked",
  CANCELLED: "cancelled",
  COMPLETE: "complete"
};

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderAudioButton(src, label){
  if(!src) return "";

  return `<button class="audio-btn" type="button" data-audio-src="${escapeHtml(src)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">▶</button>`;
}

function getVocabAudioPaths(item){
  return [
    item?.audio?.word,
    item?.audio?.example
  ].filter(Boolean);
}

function stopCurrentAudio(){
  currentAudioSequenceId += 1;
  pendingAudioSequence = null;

  if(currentAudio){
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

function waitForAudioEnd(audio, sequenceId){
  return new Promise(resolve => {
    const cleanup = () => {
      audio.removeEventListener("ended", onDone);
      audio.removeEventListener("error", onDone);
      audio.removeEventListener("pause", onPause);
    };
    const onDone = () => {
      cleanup();
      resolve(true);
    };
    const onPause = () => {
      cleanup();
      resolve(sequenceId === currentAudioSequenceId);
    };

    audio.addEventListener("ended", onDone, { once: true });
    audio.addEventListener("error", onDone, { once: true });
    audio.addEventListener("pause", onPause, { once: true });
  });
}

async function playAudioSequence(paths, options = {}){
  const audioPaths = paths.filter(Boolean);
  if(!audioPaths.length) return AUDIO_RESULT.COMPLETE;

  stopCurrentAudio();
  const sequenceId = currentAudioSequenceId;

  for(const path of audioPaths){
    if(sequenceId !== currentAudioSequenceId) return AUDIO_RESULT.CANCELLED;

    const audio = new Audio(path);
    currentAudio = audio;

    try{
      await audio.play();
    }catch(error){
      if(sequenceId === currentAudioSequenceId){
        if(options.deferOnBlocked){
          pendingAudioSequence = {
            paths: audioPaths,
            onComplete: options.onComplete
          };
          showToast("Click once to start autoplay.");
        }else{
          showToast("Click once to allow audio playback.");
        }
      }
      return AUDIO_RESULT.BLOCKED;
    }

    const finished = await waitForAudioEnd(audio, sequenceId);
    if(!finished || sequenceId !== currentAudioSequenceId){
      return AUDIO_RESULT.CANCELLED;
    }
  }

  if(sequenceId === currentAudioSequenceId){
    currentAudio = null;
  }

  if(typeof options.onComplete === "function"){
    options.onComplete();
  }

  return AUDIO_RESULT.COMPLETE;
}

function maybeAutoplayVocab(item){
  if(vocabIdleLearningEnabled || !vocabAudioAutoplayEnabled || suppressNextVocabAutoplay){
    suppressNextVocabAutoplay = false;
    return;
  }

  playAudioSequence(getVocabAudioPaths(item), {
    deferOnBlocked: true
  });
}

function playPendingAudioAfterInteraction(event){
  if(!pendingAudioSequence || !vocabAudioAutoplayEnabled) return;

  const pending = pendingAudioSequence;
  pendingAudioSequence = null;

  if(event){
    if(event.cancelable){
      event.preventDefault();
    }
    event.stopImmediatePropagation();
  }

  playAudioSequence(pending.paths, {
    onComplete: pending.onComplete
  });
}

document.addEventListener("pointerup", playPendingAudioAfterInteraction, true);
document.addEventListener("touchend", playPendingAudioAfterInteraction, { capture: true, passive: false });
document.addEventListener("click", playPendingAudioAfterInteraction, true);
document.addEventListener("keydown", playPendingAudioAfterInteraction, true);

function syncVocabAutoplayButton(){
  const button = document.getElementById("vocabAutoplayBtn");
  if(!button) return;

  button.classList.toggle("active", vocabAudioAutoplayEnabled);
  button.textContent = vocabAudioAutoplayEnabled ? "Audio: On" : "Audio: Off";
}

function syncVocabIdleButton(){
  const button = document.getElementById("vocabIdleBtn");
  if(!button) return;

  button.classList.toggle("active", vocabIdleLearningEnabled);
  button.textContent = vocabIdleLearningEnabled ? "Idle: On" : "Idle: Off";
}

function stopVocabIdleLearning(options = {}){
  vocabIdleRunId += 1;

  if(options.disable){
    vocabIdleLearningEnabled = false;
    localStorage.setItem("vocabIdleLearning", "false");
    syncVocabIdleButton();
  }
}

function getVocabForSelectedLesson(){
  return lessonCache.get(String(activeLesson))?.vocab || [];
}

function createShuffledOrder(length){
  const order = Array.from({ length }, (_, index) => index);

  for(let index = order.length - 1; index > 0; index -= 1){
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }

  return order;
}

function syncVocabCardOrder(vocab){
  if(!vocabShuffleEnabled){
    vocabCardOrder = [];
    return;
  }

  if(vocabCardOrder.length !== vocab.length){
    vocabCardOrder = createShuffledOrder(vocab.length);
  }
}

function getVocabFlashcardItems(vocab){
  syncVocabCardOrder(vocab);

  if(!vocabShuffleEnabled){
    return vocab;
  }

  return vocabCardOrder.map(index => vocab[index]).filter(Boolean);
}

function resetVocabFlashcard(){
  vocabCardIndex = 0;
  vocabCardFlipped = false;
  vocabCardOrder = [];
}

function resetVocabQuiz(){
  vocabQuizQuestions = [];
  vocabQuizQuestionIndex = 0;
  vocabQuizSelectedChoice = null;
  vocabQuizScore = 0;
}

function clampVocabCardIndex(vocab){
  if(!vocab.length){
    stopCurrentAudio();
    vocabCardIndex = 0;
    return;
  }

  vocabCardIndex = Math.max(0, Math.min(vocabCardIndex, vocab.length - 1));
}

function goToPreviousVocabCard(vocab){
  if(!vocab.length || vocabCardIndex === 0) return;
  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  vocabCardIndex -= 1;
  vocabCardFlipped = false;
  renderVocabPanel();
}

function goToNextVocabCard(vocab, options = {}){
  if(!vocab.length) return;
  if(options.disableIdle !== false){
    stopVocabIdleLearning({ disable: true });
  }
  if(options.stopAudio !== false){
    stopCurrentAudio();
  }
  vocabCardIndex = vocabCardIndex >= vocab.length - 1 ? 0 : vocabCardIndex + 1;
  vocabCardFlipped = false;
  renderVocabPanel();
}

async function continueVocabIdleAfterWord(runId, item){
  if(runId !== vocabIdleRunId || !vocabIdleLearningEnabled || vocabMode !== "flashcard") return;

  vocabCardFlipped = true;
  suppressNextVocabAutoplay = true;
  suppressNextVocabIdleStart = true;
  renderVocabPanel();

  if(runId !== vocabIdleRunId || !vocabIdleLearningEnabled) return;

  const exampleResult = await playAudioSequence([item?.audio?.example]);
  if(exampleResult !== AUDIO_RESULT.COMPLETE || runId !== vocabIdleRunId || !vocabIdleLearningEnabled) return;

  const flashcardItems = getVocabFlashcardItems(getVocabForSelectedLesson());
  goToNextVocabCard(flashcardItems, {
    disableIdle: false,
    stopAudio: false
  });
}

async function startVocabIdleLearningCycle(vocab){
  if(!vocabIdleLearningEnabled || vocabMode !== "flashcard" || !vocab.length) return;

  if(!vocabAudioAutoplayEnabled){
    vocabAudioAutoplayEnabled = true;
    localStorage.setItem("vocabAudioAutoplay", "true");
    syncVocabAutoplayButton();
  }

  if(vocabCardFlipped){
    vocabCardFlipped = false;
    suppressNextVocabAutoplay = true;
    renderVocabPanel();
    return;
  }

  const runId = vocabIdleRunId + 1;
  vocabIdleRunId = runId;
  const item = vocab[vocabCardIndex];
  const continueAfterWord = () => {
    continueVocabIdleAfterWord(runId, item);
  };

  if(!item?.audio?.word){
    continueAfterWord();
    return;
  }

  await playAudioSequence([item.audio.word], {
    deferOnBlocked: true,
    onComplete: continueAfterWord
  });
}

function renderVocabList(vocab){
  return `
    <div class="vocab-list">
      ${vocab.map(item => `
        <article class="vocab-item">
          <div class="vocab-head">
            <span class="vocab-jp">${escapeHtml(item.jp)}</span>
            ${renderAudioButton(item.audio?.word, "Play vocabulary audio")}
            ${item.reading ? `<span class="vocab-reading">${escapeHtml(item.reading)}</span>` : ""}
            ${item.pos ? `<span class="vocab-pos">${escapeHtml(item.pos)}</span>` : ""}
          </div>
          <div class="vocab-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="vocab-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="vocab-example"><span>${escapeHtml(item.example)}</span>${renderAudioButton(item.audio?.example, "Play example audio")}</div>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderVocabFlashcardLegacy(vocab){
  clampVocabCardIndex(vocab);
  const item = vocab[vocabCardIndex];

  return `
    <div class="flashcard-shell">
      <div class="flashcard-status">${vocabCardIndex + 1} / ${vocab.length}</div>
      <button class="flashcard" id="vocabFlashcard" type="button" data-face="${vocabCardFlipped ? "back" : "front"}" aria-label="Lật thẻ từ vựng">
        <div class="flashcard-face flashcard-front">
          <div class="flashcard-face-label">Mặt trước</div>
          <div class="flashcard-main">${escapeHtml(item.jp)}</div>
          ${item.reading ? `<div class="flashcard-reading">${escapeHtml(item.reading)}</div>` : ""}
          ${item.pos ? `<div class="flashcard-pos">${escapeHtml(item.pos)}</div>` : ""}
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-face-label">Mặt sau</div>
          <div class="flashcard-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="flashcard-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="flashcard-example">${escapeHtml(item.example)}</div>` : ""}
        </div>
      </button>
      <div class="flashcard-controls">
        <button class="flashcard-nav" id="vocabPrevBtn" type="button" ${vocabCardIndex === 0 ? "disabled" : ""}>Trước</button>
        <button class="flashcard-flip-btn" id="vocabFlipBtn" type="button">${vocabCardFlipped ? "Xem mặt trước" : "Lật thẻ"}</button>
        <button class="flashcard-nav" id="vocabNextBtn" type="button" ${vocabCardIndex === vocab.length - 1 ? "disabled" : ""}>Tiếp</button>
      </div>
    </div>
  `;
}

function renderVocabFlashcardBroken(vocab){
  const flashcardItems = getVocabFlashcardItems(vocab);
  clampVocabCardIndex(flashcardItems);
  const item = flashcardItems[vocabCardIndex];

  return `
    <div class="flashcard-shell">
      <div class="flashcard-toolbar">
        <div class="flashcard-status">${vocabCardIndex + 1} / ${flashcardItems.length}</div>
        <div class="flashcard-options">
          <button class="flashcard-option-btn ${vocabShuffleEnabled ? "active" : ""}" id="vocabShuffleBtn" type="button">${vocabShuffleEnabled ? "Shuffle: On" : "Shuffle: Off"}</button>
          ${vocabShuffleEnabled ? '<button class="flashcard-option-btn" id="vocabReshuffleBtn" type="button">Shuffle Again</button>' : ""}
        </div>
      </div>
      <button class="flashcard" id="vocabFlashcard" type="button" data-face="${vocabCardFlipped ? "back" : "front"}" aria-label="Láº­t tháº» tá»« vá»±ng">
        <div class="flashcard-face flashcard-front">
          <div class="flashcard-face-label">Máº·t trÆ°á»›c</div>
          <div class="flashcard-main">${escapeHtml(item.jp)}</div>
          ${item.reading ? `<div class="flashcard-reading">${escapeHtml(item.reading)}</div>` : ""}
          ${item.pos ? `<div class="flashcard-pos">${escapeHtml(item.pos)}</div>` : ""}
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-face-label">Máº·t sau</div>
          <div class="flashcard-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="flashcard-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="flashcard-example">${escapeHtml(item.example)}</div>` : ""}
        </div>
      </button>
      <div class="flashcard-controls">
        <button class="flashcard-nav" id="vocabPrevBtn" type="button" ${vocabCardIndex === 0 ? "disabled" : ""}>TrÆ°á»›c</button>
        <button class="flashcard-flip-btn" id="vocabFlipBtn" type="button">${vocabCardFlipped ? "Xem máº·t trÆ°á»›c" : "Láº­t tháº»"}</button>
        <button class="flashcard-nav" id="vocabNextBtn" type="button" ${vocabCardIndex === flashcardItems.length - 1 ? "disabled" : ""}>Tiáº¿p</button>
      </div>
    </div>
  `;
}

function renderVocabFlashcard(vocab){
  const flashcardItems = getVocabFlashcardItems(vocab);
  clampVocabCardIndex(flashcardItems);
  const item = flashcardItems[vocabCardIndex];

  return `
    <div class="flashcard-shell">
      <div class="flashcard-toolbar">
        <div class="flashcard-status">${vocabCardIndex + 1} / ${flashcardItems.length}</div>
        <div class="flashcard-options">
          <button class="flashcard-option-btn ${vocabAudioAutoplayEnabled ? "active" : ""}" id="vocabAutoplayBtn" type="button">${vocabAudioAutoplayEnabled ? "Audio: On" : "Audio: Off"}</button>
          <button class="flashcard-option-btn ${vocabIdleLearningEnabled ? "active" : ""}" id="vocabIdleBtn" type="button">${vocabIdleLearningEnabled ? "Idle: On" : "Idle: Off"}</button>
          <button class="flashcard-option-btn ${vocabShuffleEnabled ? "active" : ""}" id="vocabShuffleBtn" type="button">${vocabShuffleEnabled ? "Trộn: Bật" : "Trộn: Tắt"}</button>
          ${vocabShuffleEnabled ? '<button class="flashcard-option-btn" id="vocabReshuffleBtn" type="button">Trộn lại</button>' : ""}
        </div>
      </div>
      <div class="flashcard" id="vocabFlashcard" role="button" tabindex="0" data-face="${vocabCardFlipped ? "back" : "front"}" aria-label="Lật thẻ từ vựng">
        <div class="flashcard-face flashcard-front">
          <div class="flashcard-face-label">Mặt trước</div>
          <div class="flashcard-line">
            <div class="flashcard-main">${escapeHtml(item.jp)}</div>
            ${renderAudioButton(item.audio?.word, "Play vocabulary audio")}
          </div>
          ${item.reading ? `<div class="flashcard-reading">${escapeHtml(item.reading)}</div>` : ""}
          ${item.pos ? `<div class="flashcard-pos">${escapeHtml(item.pos)}</div>` : ""}
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-face-label">Mặt sau</div>
          <div class="flashcard-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="flashcard-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="flashcard-example"><span>${escapeHtml(item.example)}</span>${renderAudioButton(item.audio?.example, "Play example audio")}</div>` : ""}
        </div>
      </div>
      <div class="flashcard-controls">
        <button class="flashcard-nav" id="vocabPrevBtn" type="button" ${vocabCardIndex === 0 ? "disabled" : ""}>Trước</button>
        <button class="flashcard-flip-btn" id="vocabFlipBtn" type="button">${vocabCardFlipped ? "Xem mặt trước" : "Lật thẻ"}</button>
        <button class="flashcard-nav" id="vocabNextBtn" type="button">Tiếp</button>
      </div>
    </div>
  `;
}

function getUsableQuizItems(vocab){
  return vocab.filter(item => item?.jp && item?.meaning);
}

function getQuizChoiceMeanings(vocab, item){
  const distractors = [];
  const seen = new Set([item.meaning]);

  for(const candidate of createShuffledOrder(vocab.length).map(index => vocab[index])){
    if(!candidate?.meaning || seen.has(candidate.meaning)) continue;

    seen.add(candidate.meaning);
    distractors.push(candidate.meaning);

    if(distractors.length >= 3) break;
  }

  const choices = [item.meaning, ...distractors];
  return createShuffledOrder(choices.length).map(index => choices[index]);
}

function ensureVocabQuizQuestions(vocab){
  const usableItems = getUsableQuizItems(vocab);

  if(usableItems.length < 2){
    resetVocabQuiz();
    return usableItems;
  }

  if(vocabQuizQuestions.length) return usableItems;

  vocabQuizQuestions = createShuffledOrder(usableItems.length).map(index => {
    const item = usableItems[index];
    return {
      item,
      choices: getQuizChoiceMeanings(usableItems, item)
    };
  });
  vocabQuizQuestionIndex = 0;
  vocabQuizSelectedChoice = null;
  vocabQuizScore = 0;

  return usableItems;
}

function renderVocabQuiz(vocab){
  const usableItems = ensureVocabQuizQuestions(vocab);

  if(usableItems.length < 2){
    return '<div class="empty" style="padding:18px 8px">Cần ít nhất 2 từ có nghĩa để làm quiz.</div>';
  }

  if(vocabQuizQuestionIndex >= vocabQuizQuestions.length){
    return `
      <div class="quiz-shell">
        <div class="quiz-summary">
          <div class="quiz-summary-label">Hoàn thành</div>
          <div class="quiz-summary-score">${vocabQuizScore} / ${vocabQuizQuestions.length}</div>
          <button class="quiz-primary-btn" id="vocabQuizRestartBtn" type="button">Làm lại</button>
        </div>
      </div>
    `;
  }

  const question = vocabQuizQuestions[vocabQuizQuestionIndex];
  const answered = vocabQuizSelectedChoice !== null;
  const correctChoice = question.item.meaning;
  const selectedIsCorrect = vocabQuizSelectedChoice === correctChoice;

  return `
    <div class="quiz-shell">
      <div class="quiz-toolbar">
        <div class="quiz-status">Câu ${vocabQuizQuestionIndex + 1} / ${vocabQuizQuestions.length}</div>
        <div class="quiz-score">Điểm: ${vocabQuizScore}</div>
      </div>
      <div class="quiz-card">
        <div class="quiz-prompt-label">Chọn nghĩa đúng</div>
        <div class="quiz-prompt">${escapeHtml(question.item.jp)}</div>
        ${question.item.reading ? `<div class="quiz-reading">${escapeHtml(question.item.reading)}</div>` : ""}
      </div>
      <div class="quiz-choices">
        ${question.choices.map((choice, index) => {
          const isSelected = choice === vocabQuizSelectedChoice;
          const isCorrect = choice === correctChoice;
          const resultClass = answered && isCorrect ? "correct" : answered && isSelected ? "incorrect" : "";

          return `
            <button class="quiz-choice ${isSelected ? "selected" : ""} ${resultClass}" type="button" data-choice-index="${index}" ${answered ? "disabled" : ""}>
              ${escapeHtml(choice)}
            </button>
          `;
        }).join("")}
      </div>
      ${answered ? `
        <div class="quiz-feedback ${selectedIsCorrect ? "correct" : "incorrect"}">
          ${selectedIsCorrect ? "Đúng rồi." : `Chưa đúng. Đáp án: ${escapeHtml(correctChoice)}`}
        </div>
      ` : ""}
      <div class="quiz-actions">
        <button class="quiz-primary-btn" id="vocabQuizNextBtn" type="button" ${answered ? "" : "disabled"}>
          ${vocabQuizQuestionIndex === vocabQuizQuestions.length - 1 ? "Xem kết quả" : "Tiếp"}
        </button>
      </div>
    </div>
  `;
}

function bindVocabInteractions(vocab){
  document.querySelectorAll(".audio-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      stopVocabIdleLearning({ disable: true });
      playAudioSequence([btn.dataset.audioSrc]);
    });
  });

  document.querySelectorAll(".vocab-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if(vocabMode === btn.dataset.mode) return;
      stopVocabIdleLearning({ disable: true });
      stopCurrentAudio();
      vocabMode = btn.dataset.mode;
      resetVocabFlashcard();
      resetVocabQuiz();
      renderVocabPanel();
    });
  });

  if(vocabMode === "quiz"){
    const currentQuestion = vocabQuizQuestions[vocabQuizQuestionIndex];

    document.querySelectorAll(".quiz-choice").forEach(btn => {
      btn.addEventListener("click", () => {
        if(vocabQuizSelectedChoice !== null || !currentQuestion) return;

        const choice = currentQuestion.choices[Number(btn.dataset.choiceIndex)];
        vocabQuizSelectedChoice = choice;

        if(choice === currentQuestion.item.meaning){
          vocabQuizScore += 1;
        }

        renderVocabPanel();
      });
    });

    document.getElementById("vocabQuizNextBtn")?.addEventListener("click", () => {
      if(vocabQuizSelectedChoice === null) return;

      vocabQuizQuestionIndex += 1;
      vocabQuizSelectedChoice = null;
      renderVocabPanel();
    });

    document.getElementById("vocabQuizRestartBtn")?.addEventListener("click", () => {
      resetVocabQuiz();
      renderVocabPanel();
    });

    return;
  }

  if(vocabMode !== "flashcard" || !vocab.length) return;

  const flipCard = () => {
    stopVocabIdleLearning({ disable: true });
    vocabCardFlipped = !vocabCardFlipped;
    suppressNextVocabAutoplay = true;
    renderVocabPanel();
  };

  const flashcard = document.getElementById("vocabFlashcard");
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  let swipeTriggered = false;
  const swipeThreshold = 48;
  const verticalTolerance = 36;

  flashcard?.addEventListener("touchstart", event => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchMoved = false;
    swipeTriggered = false;
  }, { passive: true });

  flashcard?.addEventListener("touchmove", event => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if(Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8){
      touchMoved = true;
    }
  }, { passive: true });

  flashcard?.addEventListener("touchend", event => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if(Math.abs(deltaX) >= swipeThreshold && Math.abs(deltaY) <= verticalTolerance){
      swipeTriggered = true;
      if(deltaX < 0){
        goToNextVocabCard(vocab);
      }else{
        goToPreviousVocabCard(vocab);
      }
    }
  });

  flashcard?.addEventListener("click", event => {
    if(event.target.closest(".audio-btn")) return;

    if(swipeTriggered){
      swipeTriggered = false;
      return;
    }

    if(touchMoved){
      touchMoved = false;
      return;
    }

    flipCard(event);
  });
  flashcard?.addEventListener("keydown", event => {
    if(event.target.closest(".audio-btn")) return;
    if(event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    flipCard(event);
  });
  document.getElementById("vocabFlipBtn")?.addEventListener("click", flipCard);
  document.getElementById("vocabAutoplayBtn")?.addEventListener("click", () => {
    vocabAudioAutoplayEnabled = !vocabAudioAutoplayEnabled;
    localStorage.setItem("vocabAudioAutoplay", String(vocabAudioAutoplayEnabled));
    syncVocabAutoplayButton();

    if(vocabAudioAutoplayEnabled){
      const flashcardItems = getVocabFlashcardItems(vocab);
      playAudioSequence(getVocabAudioPaths(flashcardItems[vocabCardIndex]));
    }else{
      stopVocabIdleLearning({ disable: true });
      stopCurrentAudio();
    }
  });
  document.getElementById("vocabIdleBtn")?.addEventListener("click", () => {
    vocabIdleLearningEnabled = !vocabIdleLearningEnabled;
    localStorage.setItem("vocabIdleLearning", String(vocabIdleLearningEnabled));
    syncVocabIdleButton();

    if(vocabIdleLearningEnabled){
      vocabAudioAutoplayEnabled = true;
      localStorage.setItem("vocabAudioAutoplay", "true");
      vocabCardFlipped = false;
      suppressNextVocabAutoplay = true;
      stopCurrentAudio();
      renderVocabPanel();
    }else{
      stopVocabIdleLearning();
      stopCurrentAudio();
    }
  });
  document.getElementById("vocabShuffleBtn")?.addEventListener("click", () => {
    stopVocabIdleLearning({ disable: true });
    stopCurrentAudio();
    vocabShuffleEnabled = !vocabShuffleEnabled;
    resetVocabFlashcard();
    renderVocabPanel();
  });
  document.getElementById("vocabReshuffleBtn")?.addEventListener("click", () => {
    stopVocabIdleLearning({ disable: true });
    stopCurrentAudio();
    vocabCardOrder = createShuffledOrder(vocab.length);
    vocabCardIndex = 0;
    vocabCardFlipped = false;
    renderVocabPanel();
  });
  document.getElementById("vocabPrevBtn")?.addEventListener("click", () => {
    goToPreviousVocabCard(vocab);
  });
  document.getElementById("vocabNextBtn")?.addEventListener("click", () => {
    goToNextVocabCard(vocab);
  });
}

function renderVocabPanel(){
  const panel = document.getElementById("vocabPanel");
  const toggle = document.getElementById("vocabToggle");
  const title = document.getElementById("vocabTitle");
  const meta = document.getElementById("vocabMeta");
  const content = document.getElementById("vocabContent");
  const vocab = getVocabForSelectedLesson();

  title.textContent = "Từ vựng";
  meta.textContent = `${vocab.length} từ`;
  toggle.setAttribute("aria-expanded", "true");
  panel.classList.add("open");

  if(!vocab.length){
    stopVocabIdleLearning({ disable: true });
    content.innerHTML = '<div class="empty" style="padding:18px 8px">Chưa có từ vựng cho bài này.</div>';
    return;
  }

  content.innerHTML = `
    <div class="vocab-mode-switch" role="tablist" aria-label="Chế độ từ vựng">
      <button class="vocab-mode-btn ${vocabMode === "list" ? "active" : ""}" type="button" data-mode="list">List</button>
      <button class="vocab-mode-btn ${vocabMode === "flashcard" ? "active" : ""}" type="button" data-mode="flashcard">Flashcard</button>
      <button class="vocab-mode-btn ${vocabMode === "quiz" ? "active" : ""}" type="button" data-mode="quiz">Quiz</button>
    </div>
    ${vocabMode === "flashcard" ? renderVocabFlashcard(vocab) : vocabMode === "quiz" ? renderVocabQuiz(vocab) : renderVocabList(vocab)}
  `;
  bindVocabInteractions(vocab);

  if(vocabMode === "flashcard"){
    const flashcardItems = getVocabFlashcardItems(vocab);
    if(vocabIdleLearningEnabled){
      if(suppressNextVocabIdleStart){
        suppressNextVocabIdleStart = false;
      }else{
        startVocabIdleLearningCycle(flashcardItems);
      }
    }else{
      suppressNextVocabIdleStart = false;
      maybeAutoplayVocab(flashcardItems[vocabCardIndex]);
    }
  }else{
    suppressNextVocabAutoplay = false;
    suppressNextVocabIdleStart = false;
  }
}

function showToast(text){
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function renderLessonFilters(){
  const container = document.getElementById("lessonFilters");
  const lessons = lessonFiles.map(item => item.lesson).filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  container.innerHTML = `
    ${lessons.map(lesson => `
      <button class="chip ${String(activeLesson) === String(lesson) ? "active" : ""}" data-lesson="${lesson}">
        Bài ${lesson}
      </button>
    `).join("")}
  `;

  container.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", async () => {
      stopVocabIdleLearning({ disable: true });
      stopCurrentAudio();
      activeLesson = chip.dataset.lesson;
      resetVocabFlashcard();
      resetVocabQuiz();
      renderLessonFilters();
      await loadVocabForSelectedLesson();
    });
  });
}

let dark = false;
document.getElementById("themeBtn").addEventListener("click", () => {
  dark = !dark;
  document.documentElement.style.setProperty("--bg", dark ? "#101010" : "#ffffff");
  document.documentElement.style.setProperty("--text", dark ? "#f2f2f2" : "#111111");
  document.documentElement.style.setProperty("--muted", dark ? "#a0a0a0" : "#777777");
  document.documentElement.style.setProperty("--border", dark ? "#2a2a2a" : "#e8e8e8");
  document.documentElement.style.setProperty("--soft", dark ? "#1b1b1b" : "#f7f7f7");
  document.querySelector(".topbar").style.background = dark ? "rgba(16,16,16,.93)" : "rgba(255,255,255,.93)";
  document.querySelectorAll(".icon-btn,.chip").forEach(el => {
    if(!el.classList.contains("active")) el.style.background = dark ? "#151515" : "#fff";
  });
});

async function fetchJson(url){
  const response = await fetch(url, {
    cache: "no-store"
  });

  if(!response.ok){
    throw new Error(`Cannot load JSON: HTTP ${response.status}`);
  }

  return response.json();
}

async function loadLessonManifest(){
  const data = await fetchJson("./data/lessons.json");

  if(!data || !Array.isArray(data.lessons)){
    throw new Error("data/lessons.json must contain a lessons array.");
  }

  lessonFiles = data.lessons;
  if(!activeLesson && lessonFiles.length){
    activeLesson = String(lessonFiles[0].lesson);
  }
}

async function loadLessonData(lesson){
  const lessonKey = String(lesson);

  if(lessonCache.has(lessonKey)){
    return lessonCache.get(lessonKey);
  }

  const lessonFile = lessonFiles.find(item => String(item.lesson) === lessonKey);
  if(!lessonFile){
    throw new Error(`Cannot find a JSON file for lesson ${lesson}.`);
  }

  const data = await fetchJson(lessonFile.file);
  if(!data || typeof data !== "object"){
    throw new Error(`${lessonFile.file} must contain a lesson data object.`);
  }

  const lessonData = {
    vocab: Array.isArray(data.vocab) ? data.vocab : []
  };

  lessonCache.set(lessonKey, lessonData);
  return lessonData;
}

async function loadVocabForSelectedLesson(){
  try{
    await loadLessonData(activeLesson);
    renderVocabPanel();
  }catch(error){
    console.error(error);
    showToast("Cannot load the selected lesson.");
  }
}

async function loadVocabData(){
  try{
    await loadLessonManifest();
    renderLessonFilters();
    await loadVocabForSelectedLesson();
  }catch(error){
    console.error(error);
    showToast("Cannot load the lesson list.");
  }
}

loadVocabData();
