let lessonFiles = [];
const lessonCache = new Map();
let activeLesson = "";
let vocabPanelOpen = true;
let vocabMode = "flashcard";
let vocabCardIndex = 0;
let vocabCardFlipped = false;
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
let vocabQuizMissedQuestions = [];
let vocabQuizIsReview = false;
let vocabQuizReviewCompleted = false;
let vocabQuizAutoAdvanceTimer = null;
let vocabularyCatalog = [];
let appView = "lessons";
let dailyReviewQueue = [];
let dailyReviewIndex = 0;
let dailyReviewRevealed = false;
let dailyReviewCompleted = false;
let dailyReviewSessionStats = null;
let driveTokenClient = null;
let driveAccessToken = null;
let driveAccessTokenExpiresAt = 0;
let driveAuthorizationPending = false;
let driveSyncInFlight = false;
let driveLastError = "";

const VOCAB_CHUNK_SIZE = 10;
const VOCAB_QUIZ_AUTO_ADVANCE_DELAY = 1500;
const SRS_STORAGE_KEY = "japaneseVocabSrs:v1";
const SRS_DRIVE_META_KEY = "japaneseVocabSrsDrive:v1";
const SRS_NEW_CARD_LIMIT = 10;
const SRS_DRIVE_FILENAME = "japanese-vocab-progress.json";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_CLIENT_ID = window.APP_CONFIG?.googleClientId?.trim() || "";
let srsProgress = loadSrsProgress();
let driveMetadata = loadDriveMetadata();

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

function loadSrsProgress(){
  try{
    const saved = JSON.parse(localStorage.getItem(SRS_STORAGE_KEY) || "null");
    return SRSCore.normalizeProgress(saved);
  }catch(error){
    console.warn("Could not load SRS progress.", error);
    return SRSCore.createEmptyProgress();
  }
}

function createDeviceId(){
  if(globalThis.crypto?.randomUUID){
    return globalThis.crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadDriveMetadata(){
  try{
    const saved = JSON.parse(localStorage.getItem(SRS_DRIVE_META_KEY) || "null");
    return {
      driveFileId: typeof saved?.driveFileId === "string" ? saved.driveFileId : "",
      lastSyncedAt: typeof saved?.lastSyncedAt === "string" ? saved.lastSyncedAt : "",
      deviceId: typeof saved?.deviceId === "string" ? saved.deviceId : createDeviceId(),
      dirty: saved?.dirty === true
    };
  }catch(error){
    console.warn("Could not load Drive metadata.", error);
    return {
      driveFileId: "",
      lastSyncedAt: "",
      deviceId: createDeviceId(),
      dirty: false
    };
  }
}

function saveDriveMetadata(){
  localStorage.setItem(SRS_DRIVE_META_KEY, JSON.stringify(driveMetadata));
}

function saveSrsProgress(progress, options = {}){
  srsProgress = SRSCore.normalizeProgress(progress);
  localStorage.setItem(SRS_STORAGE_KEY, JSON.stringify(srsProgress));

  if(options.markDirty !== false){
    driveMetadata.dirty = true;
    saveDriveMetadata();
  }

  renderSrsDashboard();
  renderDriveStatus();
}

function buildVocabularyCatalog(){
  const seen = new Set();
  const catalog = [];
  const sortedLessons = [...lessonFiles].sort((left, right) => Number(left.lesson) - Number(right.lesson));

  sortedLessons.forEach(lessonEntry => {
    const vocab = lessonCache.get(String(lessonEntry.lesson))?.vocab || [];
    vocab.forEach((item, index) => {
      if(!item?.id){
        throw new Error(`Lesson ${lessonEntry.lesson} vocabulary ${index + 1} is missing an id.`);
      }
      if(seen.has(item.id)){
        throw new Error(`Duplicate vocabulary id: ${item.id}`);
      }

      seen.add(item.id);
      catalog.push({
        ...item,
        lesson: Number(lessonEntry.lesson),
        lessonIndex: index,
        order: catalog.length
      });
    });
  });

  vocabularyCatalog = catalog;
}

function getSrsStats(){
  return SRSCore.getProgressStats(
    vocabularyCatalog,
    srsProgress,
    new Date(),
    SRS_NEW_CARD_LIMIT
  );
}

function renderSrsDashboard(){
  const statsElement = document.getElementById("srsDashboardStats");
  const startButton = document.getElementById("startDailyReviewBtn");
  if(!statsElement || !startButton) return;

  if(!vocabularyCatalog.length){
    statsElement.textContent = "No vocabulary loaded.";
    startButton.disabled = true;
    return;
  }

  const stats = getSrsStats();
  statsElement.textContent = `${stats.due} due · ${stats.newToday} new today · ${stats.learning} learning · ${stats.mature} mature`;
  startButton.disabled = stats.due + stats.newToday === 0;
  startButton.textContent = stats.due + stats.newToday === 0 ? "All Caught Up" : "Start Review";
}

function renderAudioButton(src, label){
  if(!src) return "";

  return `<button class="audio-btn" type="button" data-audio-src="${escapeHtml(src)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">&gt;</button>`;
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

function getVocabChunkStorageKey(lesson){
  return `vocabChunk:${lesson}`;
}

function getVocabChunks(vocab){
  const chunks = [];

  for(let start = 0; start < vocab.length; start += VOCAB_CHUNK_SIZE){
    const end = Math.min(start + VOCAB_CHUNK_SIZE, vocab.length);
    chunks.push({
      index: chunks.length,
      start,
      end,
      items: vocab.slice(start, end)
    });
  }

  return chunks;
}

function getSelectedChunkIndex(lesson, chunkCount){
  if(chunkCount <= 0) return 0;

  const storageKey = getVocabChunkStorageKey(lesson);
  const savedIndex = Number(localStorage.getItem(storageKey));
  const selectedIndex = Number.isInteger(savedIndex) ? savedIndex : 0;
  const clampedIndex = Math.max(0, Math.min(selectedIndex, chunkCount - 1));

  if(clampedIndex !== savedIndex){
    localStorage.setItem(storageKey, String(clampedIndex));
  }

  return clampedIndex;
}

function saveSelectedChunkIndex(lesson, chunkIndex){
  localStorage.setItem(getVocabChunkStorageKey(lesson), String(chunkIndex));
}

function getActiveVocabChunk(vocab = getVocabForSelectedLesson()){
  const chunks = getVocabChunks(vocab);
  const selectedIndex = getSelectedChunkIndex(activeLesson, chunks.length);

  return chunks[selectedIndex] || {
    index: 0,
    start: 0,
    end: 0,
    items: []
  };
}

function createShuffledOrder(length){
  const order = Array.from({ length }, (_, index) => index);

  for(let index = order.length - 1; index > 0; index -= 1){
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }

  return order;
}

function getVocabFlashcardItems(vocab){
  if(vocabCardOrder.length !== vocab.length){
    return vocab;
  }

  return vocabCardOrder.map(index => vocab[index]).filter(Boolean);
}

function resetVocabFlashcard(){
  vocabCardIndex = 0;
  vocabCardFlipped = false;
  vocabCardOrder = [];
}

function cancelVocabQuizAutoAdvance(){
  if(vocabQuizAutoAdvanceTimer === null) return;

  clearTimeout(vocabQuizAutoAdvanceTimer);
  vocabQuizAutoAdvanceTimer = null;
}

function resetVocabQuiz(){
  cancelVocabQuizAutoAdvance();
  vocabQuizQuestions = [];
  vocabQuizQuestionIndex = 0;
  vocabQuizSelectedChoice = null;
  vocabQuizScore = 0;
  vocabQuizMissedQuestions = [];
  vocabQuizIsReview = false;
  vocabQuizReviewCompleted = false;
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

  const flashcardItems = getVocabFlashcardItems(getActiveVocabChunk().items);
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
          <button class="flashcard-option-btn" id="vocabShuffleBtn" type="button">Shuffle</button>
        </div>
      </div>
      <div class="flashcard" id="vocabFlashcard" role="button" tabindex="0" data-face="${vocabCardFlipped ? "back" : "front"}" aria-label="Flip vocabulary card">
        <div class="flashcard-face flashcard-front">
          <div class="flashcard-face-label">Front</div>
          <div class="flashcard-line">
            <div class="flashcard-main">${escapeHtml(item.jp)}</div>
            ${renderAudioButton(item.audio?.word, "Play vocabulary audio")}
          </div>
          ${item.reading ? `<div class="flashcard-reading">${escapeHtml(item.reading)}</div>` : ""}
          ${item.pos ? `<div class="flashcard-pos">${escapeHtml(item.pos)}</div>` : ""}
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-face-label">Back</div>
          <div class="flashcard-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="flashcard-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="flashcard-example"><span>${escapeHtml(item.example)}</span>${renderAudioButton(item.audio?.example, "Play example audio")}</div>` : ""}
        </div>
      </div>
      <div class="flashcard-controls">
        <button class="flashcard-nav" id="vocabPrevBtn" type="button" ${vocabCardIndex === 0 ? "disabled" : ""}>Previous</button>
        <button class="flashcard-flip-btn" id="vocabFlipBtn" type="button">${vocabCardFlipped ? "Show Front" : "Flip Card"}</button>
        <button class="flashcard-nav" id="vocabNextBtn" type="button">Next</button>
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

function createVocabQuizQuestions(items, choicePool){
  return createShuffledOrder(items.length).map(index => {
    const item = items[index];
    return {
      item,
      choices: getQuizChoiceMeanings(choicePool, item)
    };
  });
}

function resetVocabQuizProgress(){
  cancelVocabQuizAutoAdvance();
  vocabQuizQuestionIndex = 0;
  vocabQuizSelectedChoice = null;
  vocabQuizScore = 0;
}

function advanceVocabQuizQuestion(expectedQuestion = null, expectedQuestionIndex = null){
  cancelVocabQuizAutoAdvance();

  if(vocabQuizSelectedChoice === null) return;
  if(expectedQuestion && vocabQuizQuestions[vocabQuizQuestionIndex] !== expectedQuestion) return;
  if(expectedQuestionIndex !== null && vocabQuizQuestionIndex !== expectedQuestionIndex) return;

  vocabQuizQuestionIndex += 1;
  vocabQuizSelectedChoice = null;
  renderVocabPanel();
}

function scheduleVocabQuizAutoAdvance(question, questionIndex){
  cancelVocabQuizAutoAdvance();

  vocabQuizAutoAdvanceTimer = setTimeout(() => {
    vocabQuizAutoAdvanceTimer = null;

    if(vocabMode !== "quiz") return;
    if(vocabQuizQuestions[vocabQuizQuestionIndex] !== question) return;
    if(vocabQuizQuestionIndex !== questionIndex) return;
    if(vocabQuizSelectedChoice !== question.item.meaning) return;

    advanceVocabQuizQuestion(question, questionIndex);
  }, VOCAB_QUIZ_AUTO_ADVANCE_DELAY);
}

function startVocabMissedReview(vocab){
  const usableItems = getUsableQuizItems(vocab);
  const missedItems = vocabQuizMissedQuestions.map(question => question.item).filter(Boolean);

  vocabQuizQuestions = createVocabQuizQuestions(missedItems, usableItems);
  vocabQuizIsReview = true;
  vocabQuizReviewCompleted = true;
  resetVocabQuizProgress();
}

function trackMissedVocabQuestion(question){
  if(vocabQuizIsReview || !question?.item) return;

  const alreadyMissed = vocabQuizMissedQuestions.some(missed => missed.item === question.item);
  if(!alreadyMissed){
    vocabQuizMissedQuestions.push(question);
  }
}

function ensureVocabQuizQuestions(vocab){
  const usableItems = getUsableQuizItems(vocab);

  if(usableItems.length < 2){
    resetVocabQuiz();
    return usableItems;
  }

  if(vocabQuizQuestions.length) return usableItems;

  vocabQuizQuestions = createVocabQuizQuestions(usableItems, usableItems);
  resetVocabQuizProgress();

  return usableItems;
}

function renderVocabQuiz(vocab){
  const usableItems = ensureVocabQuizQuestions(vocab);

  if(usableItems.length < 2){
    return '<div class="empty" style="padding:18px 8px">At least 2 words with meanings are needed for a quiz.</div>';
  }

  if(vocabQuizQuestionIndex >= vocabQuizQuestions.length){
    const missedCount = vocabQuizMissedQuestions.length;
    const canReviewMissed = missedCount > 0 && !vocabQuizIsReview && !vocabQuizReviewCompleted;
    const showMissedCount = missedCount > 0 && !vocabQuizIsReview;

    return `
      <div class="quiz-shell">
        <div class="quiz-summary">
          <div class="quiz-summary-label">${vocabQuizIsReview ? "Review Complete" : "Complete"}</div>
          <div class="quiz-summary-score">${vocabQuizScore} / ${vocabQuizQuestions.length}</div>
          ${showMissedCount ? `<div class="quiz-summary-meta">Missed: ${missedCount}</div>` : ""}
          <div class="quiz-summary-actions">
            ${canReviewMissed ? '<button class="quiz-primary-btn" id="vocabQuizReviewBtn" type="button">Review Missed</button>' : ""}
            <button class="quiz-primary-btn" id="vocabQuizRestartBtn" type="button">Try Again</button>
          </div>
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
        <div class="quiz-status">Question ${vocabQuizQuestionIndex + 1} / ${vocabQuizQuestions.length}</div>
        <div class="quiz-score">Score: ${vocabQuizScore}</div>
      </div>
      <div class="quiz-card">
        <div class="quiz-prompt-label">Choose the correct meaning</div>
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
          ${selectedIsCorrect ? "Correct." : `Not quite. Answer: ${escapeHtml(correctChoice)}`}
        </div>
      ` : ""}
      <div class="quiz-actions">
        <button class="quiz-primary-btn" id="vocabQuizNextBtn" type="button" ${answered ? "" : "disabled"}>
          ${vocabQuizQuestionIndex === vocabQuizQuestions.length - 1 ? "Show Results" : "Next"}
        </button>
      </div>
    </div>
  `;
}

function renderVocabChunkSwitch(chunks, activeChunkIndex){
  if(!chunks.length) return "";

  return `
    <div class="vocab-chunk-switch" role="tablist" aria-label="Vocabulary chunks">
      ${chunks.map(chunk => `
        <button class="vocab-chunk-btn ${chunk.index === activeChunkIndex ? "active" : ""}" type="button" data-chunk-index="${chunk.index}">
          <span>${chunk.start + 1}-${chunk.end}</span>
        </button>
      `).join("")}
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

  document.querySelectorAll(".vocab-chunk-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const chunkIndex = Number(btn.dataset.chunkIndex);
      if(!Number.isInteger(chunkIndex)) return;

      const currentChunkIndex = getActiveVocabChunk().index;
      if(chunkIndex === currentChunkIndex) return;

      stopVocabIdleLearning({ disable: true });
      stopCurrentAudio();
      saveSelectedChunkIndex(activeLesson, chunkIndex);
      resetVocabFlashcard();
      resetVocabQuiz();
      renderVocabPanel();
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
          renderVocabPanel();
          scheduleVocabQuizAutoAdvance(currentQuestion, vocabQuizQuestionIndex);
        }else{
          trackMissedVocabQuestion(currentQuestion);
          renderVocabPanel();
        }
      });
    });

    document.getElementById("vocabQuizNextBtn")?.addEventListener("click", () => {
      advanceVocabQuizQuestion(currentQuestion, vocabQuizQuestionIndex);
    });

    document.getElementById("vocabQuizRestartBtn")?.addEventListener("click", () => {
      resetVocabQuiz();
      renderVocabPanel();
    });

    document.getElementById("vocabQuizReviewBtn")?.addEventListener("click", () => {
      startVocabMissedReview(vocab);
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

function formatSrsInterval(card){
  if(card.state === "learning" && card.intervalDays === 0) return "10m";
  return `${card.intervalDays}d`;
}

function startDailyReview(){
  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  cancelVocabQuizAutoAdvance();
  dailyReviewQueue = SRSCore.buildDailyQueue(
    vocabularyCatalog,
    srsProgress,
    new Date(),
    SRS_NEW_CARD_LIMIT
  );
  dailyReviewIndex = 0;
  dailyReviewRevealed = false;
  dailyReviewCompleted = dailyReviewQueue.length === 0;
  dailyReviewSessionStats = {
    started: dailyReviewQueue.length,
    reviewed: 0,
    ratings: {
      again: 0,
      hard: 0,
      good: 0,
      easy: 0
    }
  };
  appView = "daily";
  renderAppView();
}

function exitDailyReview(){
  stopCurrentAudio();
  appView = "lessons";
  renderAppView();
}

function completeDailyReview(){
  dailyReviewCompleted = true;
  renderDailyReview();

  if(hasValidDriveToken()){
    syncDriveProgress({ quiet: true });
  }
}

function rateCurrentDailyReviewCard(rating){
  const entry = dailyReviewQueue[dailyReviewIndex];
  if(!entry || !dailyReviewRevealed) return;

  const now = new Date();
  const nextCard = SRSCore.rateCard(srsProgress.cards[entry.id], rating, now);
  const nextProgress = {
    ...srsProgress,
    updatedAt: now.toISOString(),
    cards: {
      ...srsProgress.cards,
      [entry.id]: nextCard
    }
  };

  saveSrsProgress(nextProgress);
  dailyReviewSessionStats.reviewed += 1;
  dailyReviewSessionStats.ratings[rating] += 1;
  dailyReviewIndex += 1;
  dailyReviewRevealed = false;
  stopCurrentAudio();

  if(dailyReviewIndex >= dailyReviewQueue.length){
    completeDailyReview();
  }else{
    renderDailyReview();
  }
}

function renderDailyReview(){
  const container = document.getElementById("dailyReviewContent");
  if(!container) return;

  if(dailyReviewCompleted || dailyReviewIndex >= dailyReviewQueue.length){
    const session = dailyReviewSessionStats || {
      reviewed: 0,
      ratings: { again: 0, hard: 0, good: 0, easy: 0 }
    };
    const stats = getSrsStats();
    container.innerHTML = `
      <div class="srs-shell">
        <div class="srs-toolbar">
          <div class="srs-progress">Daily Review</div>
          <div class="srs-toolbar-actions">
            <button class="study-secondary-btn" id="srsBackBtn" type="button">Back to Lessons</button>
          </div>
        </div>
        <div class="srs-summary">
          <div class="srs-card-label">Session complete</div>
          <h2>${session.reviewed} ${session.reviewed === 1 ? "card" : "cards"} reviewed</h2>
          <div class="srs-summary-stats">
            Again ${session.ratings.again} · Hard ${session.ratings.hard} · Good ${session.ratings.good} · Easy ${session.ratings.easy}<br>
            ${stats.due} due now · ${stats.learning} learning · ${stats.mature} mature
          </div>
          <button class="study-primary-btn" id="srsDoneBtn" type="button">Done</button>
        </div>
      </div>
    `;
    bindDailyReviewInteractions();
    return;
  }

  const entry = dailyReviewQueue[dailyReviewIndex];
  const previousCard = srsProgress.cards[entry.id];
  const previewTime = new Date();
  const ratingIntervals = Object.fromEntries(
    ["again", "hard", "good", "easy"].map(rating => [
      rating,
      formatSrsInterval(SRSCore.rateCard(previousCard, rating, previewTime))
    ])
  );

  container.innerHTML = `
    <div class="srs-shell">
      <div class="srs-toolbar">
        <div class="srs-progress">
          ${dailyReviewIndex + 1} / ${dailyReviewQueue.length} · Lesson ${entry.lesson} · ${entry.queueType === "new" ? "New" : "Due"}
        </div>
        <div class="srs-toolbar-actions">
          <button class="study-secondary-btn" id="srsBackBtn" type="button">Back to Lessons</button>
        </div>
      </div>
      <article class="srs-card">
        <div class="srs-card-label">Recall the meaning</div>
        <div class="srs-card-main">
          <span>${escapeHtml(entry.jp)}</span>
          ${renderAudioButton(entry.audio?.word, "Play vocabulary audio")}
        </div>
        ${dailyReviewRevealed ? `
          <div class="srs-card-answer">
            ${entry.reading ? `<div class="srs-card-reading">${escapeHtml(entry.reading)}</div>` : ""}
            ${entry.pos ? `<div class="srs-card-pos">${escapeHtml(entry.pos)}</div>` : ""}
            <div class="srs-card-meaning">${escapeHtml(entry.meaning)}</div>
            ${entry.note ? `<div class="srs-card-note">${escapeHtml(entry.note)}</div>` : ""}
            ${entry.example ? `<div class="srs-card-example"><span>${escapeHtml(entry.example)}</span>${renderAudioButton(entry.audio?.example, "Play example audio")}</div>` : ""}
          </div>
        ` : ""}
      </article>
      ${dailyReviewRevealed ? `
        <div class="srs-ratings" aria-label="Rate recall">
          ${["again", "hard", "good", "easy"].map(rating => `
            <button class="srs-rating-btn" type="button" data-rating="${rating}">
              ${rating[0].toUpperCase()}${rating.slice(1)}
              <small>${ratingIntervals[rating]}</small>
            </button>
          `).join("")}
        </div>
      ` : '<button class="srs-reveal-btn" id="srsRevealBtn" type="button">Show Answer</button>'}
    </div>
  `;
  bindDailyReviewInteractions();
}

function bindDailyReviewInteractions(){
  document.getElementById("srsBackBtn")?.addEventListener("click", exitDailyReview);
  document.getElementById("srsDoneBtn")?.addEventListener("click", exitDailyReview);
  document.getElementById("srsRevealBtn")?.addEventListener("click", () => {
    dailyReviewRevealed = true;
    renderDailyReview();
  });
  document.querySelectorAll(".srs-rating-btn").forEach(button => {
    button.addEventListener("click", () => {
      rateCurrentDailyReviewCard(button.dataset.rating);
    });
  });
  document.querySelectorAll("#dailyReviewContent .audio-btn").forEach(button => {
    button.addEventListener("click", () => {
      playAudioSequence([button.dataset.audioSrc]);
    });
  });
}

function renderAppView(){
  const dashboard = document.getElementById("studyDashboard");
  const lessons = document.getElementById("lessonStudySection");
  const review = document.getElementById("dailyReviewSection");
  const isDailyReview = appView === "daily";

  dashboard.hidden = isDailyReview;
  lessons.hidden = isDailyReview;
  review.hidden = !isDailyReview;

  if(isDailyReview){
    renderDailyReview();
  }else{
    renderSrsDashboard();
    renderDriveStatus();
  }
}

function hasValidDriveToken(){
  return Boolean(driveAccessToken && Date.now() < driveAccessTokenExpiresAt - 30000);
}

function renderDriveStatus(){
  const status = document.getElementById("driveStatus");
  const connectButton = document.getElementById("connectDriveBtn");
  const syncButton = document.getElementById("syncDriveBtn");
  if(!status || !connectButton || !syncButton) return;

  if(!GOOGLE_CLIENT_ID){
    status.textContent = "Local only · add a Google client ID to enable sync";
    status.dataset.state = "disconnected";
    connectButton.textContent = "Drive Setup";
    connectButton.disabled = false;
    syncButton.hidden = true;
    return;
  }

  if(driveAuthorizationPending || driveSyncInFlight){
    status.textContent = driveAuthorizationPending ? "Connecting…" : "Syncing…";
    status.dataset.state = "connecting";
    connectButton.disabled = true;
    syncButton.disabled = true;
    return;
  }

  connectButton.disabled = false;
  syncButton.disabled = false;

  if(driveLastError){
    status.textContent = driveLastError;
    status.dataset.state = "error";
  }else if(hasValidDriveToken() && driveMetadata.dirty){
    status.textContent = "Connected · local changes not synced";
    status.dataset.state = "unsynced";
  }else if(hasValidDriveToken() && driveMetadata.lastSyncedAt){
    status.textContent = `Synced ${new Date(driveMetadata.lastSyncedAt).toLocaleString()}`;
    status.dataset.state = "synced";
  }else{
    status.textContent = driveMetadata.dirty ? "Local changes waiting for Drive" : "Local only";
    status.dataset.state = driveMetadata.dirty ? "unsynced" : "disconnected";
  }

  connectButton.textContent = hasValidDriveToken() ? "Reconnect Drive" : "Connect Drive";
  syncButton.hidden = !hasValidDriveToken();
}

function initializeDriveTokenClient(){
  if(driveTokenClient || !GOOGLE_CLIENT_ID || !globalThis.google?.accounts?.oauth2){
    return Boolean(driveTokenClient);
  }

  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_DRIVE_SCOPE,
    callback: async response => {
      driveAuthorizationPending = false;
      if(response?.error || !response?.access_token){
        driveLastError = "Google Drive authorization failed";
        renderDriveStatus();
        return;
      }

      driveAccessToken = response.access_token;
      driveAccessTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
      driveLastError = "";
      renderDriveStatus();
      await syncDriveProgress();
    },
    error_callback: () => {
      driveAuthorizationPending = false;
      driveLastError = "Google Drive connection was cancelled";
      renderDriveStatus();
    }
  });

  return true;
}

function connectGoogleDrive(){
  if(!GOOGLE_CLIENT_ID){
    showToast("Add your Google OAuth client ID in assets/config.js.");
    return;
  }

  if(!initializeDriveTokenClient()){
    showToast("Google sign-in is still loading. Try again.");
    return;
  }

  driveLastError = "";
  driveAuthorizationPending = true;
  renderDriveStatus();
  try{
    driveTokenClient.requestAccessToken({ prompt: "" });
  }catch(error){
    driveAuthorizationPending = false;
    driveLastError = "Could not open Google Drive authorization";
    renderDriveStatus();
  }
}

async function driveApiFetch(url, options = {}){
  if(!hasValidDriveToken()){
    driveAccessToken = null;
    throw new Error("Google Drive authorization expired. Connect again.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${driveAccessToken}`);
  const response = await fetch(url, {
    ...options,
    headers
  });

  if(response.status === 401){
    driveAccessToken = null;
    driveAccessTokenExpiresAt = 0;
    throw new Error("Google Drive authorization expired. Connect again.");
  }
  if(!response.ok){
    const details = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${details.slice(0, 160)}`);
  }

  return response;
}

function isDriveProgressDocument(value){
  return Boolean(
    value &&
    typeof value === "object" &&
    value.schemaVersion === SRSCore.SCHEMA_VERSION &&
    value.cards &&
    typeof value.cards === "object" &&
    !Array.isArray(value.cards)
  );
}

async function findDriveProgressFile(){
  const query = encodeURIComponent(`name = '${SRS_DRIVE_FILENAME}' and trashed = false`);
  const fields = encodeURIComponent("files(id,name,modifiedTime)");
  const response = await driveApiFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=${fields}&pageSize=10`
  );
  const data = await response.json();
  return Array.isArray(data.files) ? data.files[0] || null : null;
}

async function downloadDriveProgress(fileId){
  const response = await driveApiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  const value = await response.json();

  if(!isDriveProgressDocument(value)){
    throw new Error("The Google Drive progress file is invalid or uses an unsupported version.");
  }

  const normalized = SRSCore.normalizeProgress(value);
  if(Object.keys(normalized.cards).length !== Object.keys(value.cards).length){
    throw new Error("The Google Drive progress file contains invalid card records.");
  }

  return normalized;
}

async function createDriveProgressFile(progress){
  const boundary = `srs-${Date.now()}`;
  const metadata = JSON.stringify({
    name: SRS_DRIVE_FILENAME,
    parents: ["appDataFolder"],
    mimeType: "application/json"
  });
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(progress),
    `--${boundary}--`
  ].join("\r\n");

  const response = await driveApiFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  return response.json();
}

async function uploadDriveProgress(fileId, progress){
  await driveApiFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(progress)
    }
  );
}

async function syncDriveProgress(options = {}){
  if(driveSyncInFlight) return;
  if(!hasValidDriveToken()){
    if(!options.quiet) connectGoogleDrive();
    return;
  }

  driveSyncInFlight = true;
  driveLastError = "";
  renderDriveStatus();

  try{
    let file = await findDriveProgressFile();
    let merged = SRSCore.normalizeProgress(srsProgress);

    if(file){
      const cloud = await downloadDriveProgress(file.id);
      merged = SRSCore.mergeProgress(srsProgress, cloud);
      saveSrsProgress(merged, { markDirty: false });
      await uploadDriveProgress(file.id, merged);
    }else{
      const created = await createDriveProgressFile(merged);
      file = { id: created.id };
    }

    driveMetadata.driveFileId = file.id;
    driveMetadata.lastSyncedAt = new Date().toISOString();
    driveMetadata.dirty = false;
    saveDriveMetadata();
    renderSrsDashboard();
    if(appView === "daily") renderDailyReview();
    if(!options.quiet) showToast("Google Drive sync complete.");
  }catch(error){
    console.error(error);
    driveLastError = error.message || "Google Drive sync failed";
    driveMetadata.dirty = true;
    saveDriveMetadata();
    if(!options.quiet) showToast("Drive sync failed. Progress is safe locally.");
  }finally{
    driveSyncInFlight = false;
    renderDriveStatus();
  }
}

function renderVocabPanel(){
  const panel = document.getElementById("vocabPanel");
  const toggle = document.getElementById("vocabToggle");
  const title = document.getElementById("vocabTitle");
  const meta = document.getElementById("vocabMeta");
  const content = document.getElementById("vocabContent");
  const allVocab = getVocabForSelectedLesson();
  const chunks = getVocabChunks(allVocab);
  const activeChunk = getActiveVocabChunk(allVocab);
  const vocab = activeChunk.items;

  title.textContent = "Vocabulary";
  meta.textContent = allVocab.length
    ? `${allVocab.length} ${allVocab.length === 1 ? "word" : "words"} · studying ${activeChunk.start + 1}-${activeChunk.end}`
    : "0 words";
  toggle.setAttribute("aria-expanded", "true");
  panel.classList.add("open");

  if(!allVocab.length){
    stopVocabIdleLearning({ disable: true });
    content.innerHTML = '<div class="empty" style="padding:18px 8px">No vocabulary is available for this lesson yet.</div>';
    return;
  }

  content.innerHTML = `
    ${renderVocabChunkSwitch(chunks, activeChunk.index)}
    <div class="vocab-mode-switch" role="tablist" aria-label="Vocabulary mode">
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
        Lesson ${lesson}
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

document.getElementById("startDailyReviewBtn").addEventListener("click", startDailyReview);
document.getElementById("connectDriveBtn").addEventListener("click", connectGoogleDrive);
document.getElementById("syncDriveBtn").addEventListener("click", () => syncDriveProgress());

const settingsButton = document.getElementById("settingsBtn");
const settingsPopover = document.getElementById("settingsPopover");
const settingsCloseButton = document.getElementById("settingsCloseBtn");

function setSettingsOpen(isOpen, options = {}){
  settingsPopover.hidden = !isOpen;
  settingsButton.setAttribute("aria-expanded", String(isOpen));
  settingsButton.setAttribute("aria-label", isOpen ? "Close settings" : "Open settings");

  if(isOpen){
    renderDriveStatus();
    settingsCloseButton.focus();
  }else if(options.restoreFocus){
    settingsButton.focus();
  }
}

settingsButton.addEventListener("click", () => {
  setSettingsOpen(settingsPopover.hidden);
});

settingsCloseButton.addEventListener("click", () => {
  setSettingsOpen(false, { restoreFocus: true });
});

document.addEventListener("click", event => {
  if(settingsPopover.hidden) return;
  if(settingsPopover.contains(event.target) || settingsButton.contains(event.target)) return;
  setSettingsOpen(false);
});

document.addEventListener("keydown", event => {
  if(event.key !== "Escape" || settingsPopover.hidden) return;
  event.preventDefault();
  setSettingsOpen(false, { restoreFocus: true });
});

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
    lesson: Number(data.lesson ?? lesson),
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
    await Promise.all(lessonFiles.map(item => loadLessonData(item.lesson)));
    buildVocabularyCatalog();
    renderLessonFilters();
    await loadVocabForSelectedLesson();
    renderAppView();
    renderDriveStatus();
  }catch(error){
    console.error(error);
    showToast("Cannot load the lesson list.");
  }
}

loadVocabData();
