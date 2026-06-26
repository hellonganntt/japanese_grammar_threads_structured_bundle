const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const JLPT_ALL_LEVELS = "all";

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
let selectedJlptLevel = normalizeJlptLevel(localStorage.getItem("selectedJlptLevel"));
let vocabIdleRunId = 0;
let vocabQuizQuestions = [];
let vocabQuizQuestionIndex = 0;
let vocabQuizSelectedChoice = null;
let vocabQuizScore = 0;
let vocabQuizMissedQuestions = [];
let vocabQuizIsReview = false;
let vocabQuizReviewCompleted = false;
let vocabQuizAutoAdvanceTimer = null;
let lastAutoplayedVocabQuizQuestion = null;
let vocabularyCatalog = [];
let appView = "lessons";
let dailyReviewQueue = [];
let dailyReviewIndex = 0;
let dailyReviewRevealed = false;
let dailyReviewCompleted = false;
let dailyReviewSessionStats = null;
let dailyReviewWritePending = false;
let driveTokenClient = null;
let driveAccessToken = null;
let driveAccessTokenExpiresAt = 0;
let driveAuthorizationPending = false;
let driveSyncInFlight = false;
let driveLastError = "";
let startReviewAfterDriveSync = false;
let requestedReviewExtraNewLimit = 0;

const VOCAB_CHUNK_SIZE = 10;
const VOCAB_QUIZ_AUTO_ADVANCE_DELAY = 1500;
const SRS_STORAGE_KEY = "japaneseVocabSrs:v1";
const SRS_DRIVE_META_KEY = "japaneseVocabSrsDrive:v1";
const SRS_DRIVE_SESSION_KEY = "japaneseVocabSrsDriveSession:v1";
const SRS_NEW_CARD_LIMIT = 10;
const SRS_DRIVE_FILENAME = "japanese-vocab-progress.json";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_CLIENT_ID = window.APP_CONFIG?.googleClientId?.trim() || "";
const srsDatabase = new SrsDatabase.Database();
let driveMetadata = {
  driveFileId: "",
  lastSyncedAt: "",
  deviceId: "",
  dirty: false
};
let srsDashboardRenderId = 0;
restoreDriveSession();

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

function saveDriveMetadata(){
  return srsDatabase.setDriveMetadata({ ...driveMetadata }).catch(error => {
    console.warn("Could not save Drive metadata.", error);
    return false;
  });
}

function restoreDriveSession(){
  try{
    const saved = JSON.parse(sessionStorage.getItem(SRS_DRIVE_SESSION_KEY) || "null");
    const expiresAt = Number(saved?.expiresAt) || 0;

    if(typeof saved?.accessToken === "string" && expiresAt > Date.now() + 30000){
      driveAccessToken = saved.accessToken;
      driveAccessTokenExpiresAt = expiresAt;
      return;
    }

    sessionStorage.removeItem(SRS_DRIVE_SESSION_KEY);
  }catch(error){
    console.warn("Could not restore the Drive session.", error);
  }
}

function saveDriveSession(){
  try{
    sessionStorage.setItem(SRS_DRIVE_SESSION_KEY, JSON.stringify({
      accessToken: driveAccessToken,
      expiresAt: driveAccessTokenExpiresAt
    }));
  }catch(error){
    console.warn("Could not save the Drive session.", error);
  }
}

function clearDriveSession(){
  driveAccessToken = null;
  driveAccessTokenExpiresAt = 0;
  try{
    sessionStorage.removeItem(SRS_DRIVE_SESSION_KEY);
  }catch(error){
    console.warn("Could not clear the Drive session.", error);
  }
}

async function getSrsStats(){
  return srsDatabase.getStats(new Date(), SRS_NEW_CARD_LIMIT, {
    newCardLevel: getSelectedNewCardLevel()
  });
}

async function renderSrsDashboard(){
  const renderId = ++srsDashboardRenderId;
  const statsElement = document.getElementById("srsDashboardStats");
  const startButton = document.getElementById("startDailyReviewBtn");
  if(!statsElement || !startButton) return;

  if(!vocabularyCatalog.length){
    document.getElementById("todayMessage").textContent = "No vocabulary is available yet.";
    startButton.disabled = true;
    return;
  }

  const stats = await getSrsStats();
  if(renderId !== srsDashboardRenderId) return;
  const hasRegularReview = stats.due + stats.newToday > 0;
  const canLearnMore = !hasRegularReview && stats.unseen > 0;

  document.getElementById("dueCount").textContent = stats.due;
  document.getElementById("newCount").textContent = stats.newToday;
  document.getElementById("learningCount").textContent = stats.learning;
  document.getElementById("matureCount").textContent = stats.mature;

  const todayMessage = document.getElementById("todayMessage");
  if(stats.due){
    todayMessage.textContent = `${stats.due} ${stats.due === 1 ? "word is" : "words are"} ready to come back to you.`;
  }else{
    todayMessage.textContent = stats.newToday
      ? `Meet up to ${stats.newToday} new ${stats.newToday === 1 ? "word" : "words"} today.`
      : "You are fully caught up.";
  }

  startButton.disabled = !hasRegularReview && !canLearnMore;
  startButton.dataset.extraNewLimit = canLearnMore ? String(SRS_NEW_CARD_LIMIT) : "0";
  startButton.textContent = hasRegularReview
    ? "Start Today’s Study"
    : canLearnMore
      ? `Learn ${Math.min(SRS_NEW_CARD_LIMIT, stats.unseen)} More`
      : "All Caught Up";
}

function renderAudioButton(paths, label){
  const audioPaths = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if(!audioPaths.length) return "";

  const encodedPaths = encodeURIComponent(JSON.stringify(audioPaths));
  return `<button class="audio-btn" type="button" data-audio-paths="${escapeHtml(encodedPaths)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></button>`;
}

function getAudioButtonPaths(button){
  try{
    const paths = JSON.parse(decodeURIComponent(button.dataset.audioPaths || "%5B%5D"));
    return Array.isArray(paths) ? paths.filter(Boolean) : [];
  }catch(error){
    return [];
  }
}

function normalizeJlptLevel(value){
  return JLPT_LEVELS.includes(value) ? value : JLPT_ALL_LEVELS;
}

function getSelectedNewCardLevel(){
  return selectedJlptLevel === JLPT_ALL_LEVELS ? "" : selectedJlptLevel;
}

function lessonMatchesSelectedLevel(lessonEntry){
  return selectedJlptLevel === JLPT_ALL_LEVELS || lessonEntry.level === selectedJlptLevel;
}

function getFilteredLessonFiles(){
  return lessonFiles.filter(lessonMatchesSelectedLevel);
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

function maybeAutoplayVocabQuizWord(question){
  if(!vocabAudioAutoplayEnabled || vocabQuizSelectedChoice !== null || !question?.item?.audio?.word) return;
  if(lastAutoplayedVocabQuizQuestion === question) return;

  lastAutoplayedVocabQuizQuestion = question;
  playAudioSequence([question.item.audio.word], {
    deferOnBlocked: true
  });
}

function maybeAutoplayDailyReviewWord(item){
  if(dailyReviewRevealed || !item?.audio?.word) return;

  playAudioSequence([item.audio.word], {
    deferOnBlocked: true
  });
}

function playPendingAudioAfterInteraction(event){
  if(!pendingAudioSequence) return;

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
  lastAutoplayedVocabQuizQuestion = null;
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
            ${item.reading ? `<span class="vocab-reading">${escapeHtml(item.reading)}</span>` : ""}
            ${item.pos ? `<span class="vocab-pos">${escapeHtml(item.pos)}</span>` : ""}
          </div>
          <div class="vocab-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="vocab-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="vocab-example">${escapeHtml(item.example)}</div>` : ""}
          ${renderAudioButton(getVocabAudioPaths(item), "Play word and example audio")}
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
        <div class="learning-progress">
          <div class="flashcard-status">${vocabCardIndex + 1} / ${flashcardItems.length}</div>
          <div class="progress-track" aria-hidden="true"><span style="width:${Math.round(((vocabCardIndex + 1) / flashcardItems.length) * 100)}%"></span></div>
        </div>
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
          </div>
          ${item.reading ? `<div class="flashcard-reading">${escapeHtml(item.reading)}</div>` : ""}
          ${item.pos ? `<div class="flashcard-pos">${escapeHtml(item.pos)}</div>` : ""}
          ${renderAudioButton(item.audio?.word, "Play vocabulary audio")}
        </div>
        <div class="flashcard-face flashcard-back">
          <div class="flashcard-face-label">Back</div>
          <div class="flashcard-meaning">${escapeHtml(item.meaning)}</div>
          ${item.note ? `<div class="flashcard-note">${escapeHtml(item.note)}</div>` : ""}
          ${item.example ? `<div class="flashcard-example">${escapeHtml(item.example)}</div>` : ""}
          ${renderAudioButton(item.audio?.example, "Play example audio")}
        </div>
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
  lastAutoplayedVocabQuizQuestion = null;
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
        <div class="learning-progress">
          <div class="quiz-status">Question ${vocabQuizQuestionIndex + 1} / ${vocabQuizQuestions.length}</div>
          <div class="progress-track" aria-hidden="true"><span style="width:${Math.round(((vocabQuizQuestionIndex + 1) / vocabQuizQuestions.length) * 100)}%"></span></div>
        </div>
        <div class="quiz-score">Score: ${vocabQuizScore}</div>
      </div>
      <div class="quiz-card">
        <div class="quiz-prompt-label">Choose the correct meaning</div>
        <div class="quiz-prompt">${escapeHtml(question.item.jp)}</div>
        ${question.item.reading ? `<div class="quiz-reading">${escapeHtml(question.item.reading)}</div>` : ""}
        ${renderAudioButton(question.item.audio?.word, "Play vocabulary audio")}
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
          <strong>${selectedIsCorrect ? "That’s right." : `Answer: ${escapeHtml(correctChoice)}`}</strong>
          ${question.item.example ? `<span>${escapeHtml(question.item.example)}</span>` : ""}
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

function bindVocabInteractions(vocab){
  document.querySelectorAll(".audio-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      stopVocabIdleLearning({ disable: true });
      playAudioSequence(getAudioButtonPaths(btn));
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
}

function formatSrsInterval(card){
  if(card.state === "learning" && card.intervalDays === 0) return "10m";
  return `${card.intervalDays}d`;
}

function scrollToDailyReview(){
  requestAnimationFrame(() => {
    const reviewSection = document.getElementById("dailyReviewSection");
    if(!reviewSection || reviewSection.hidden) return;

    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    reviewSection.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start"
    });
  });
}

async function hydrateReviewQueue(queue){
  const lessons = [...new Set(queue.map(entry => String(entry.lesson)))];
  await Promise.all(lessons.map(lesson => loadLessonData(lesson)));
  const vocabById = new Map();
  lessons.forEach(lesson => {
    const vocab = lessonCache.get(lesson)?.vocab || [];
    vocab.forEach(item => vocabById.set(item.id, item));
  });
  return queue.map(entry => ({ ...entry, ...(vocabById.get(entry.id) || {}) }));
}

async function startDailyReview(options = {}){
  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  cancelVocabQuizAutoAdvance();
  const queue = await srsDatabase.buildDailyQueue(
    new Date(),
    SRS_NEW_CARD_LIMIT,
    options.extraNewLimit || 0,
    { newCardLevel: getSelectedNewCardLevel() }
  );
  dailyReviewQueue = await hydrateReviewQueue(queue);
  dailyReviewIndex = 0;
  dailyReviewRevealed = false;
  dailyReviewCompleted = dailyReviewQueue.length === 0;
  dailyReviewSessionStats = {
    started: dailyReviewQueue.length,
    reviewed: 0,
    extraBatch: (options.extraNewLimit || 0) > 0,
    ratings: {
      again: 0,
      hard: 0,
      good: 0,
      easy: 0
    }
  };
  appView = "daily";
  renderAppView();
  scrollToDailyReview();
}

async function requestDailyReviewStart(){
  const startButton = document.getElementById("startDailyReviewBtn");
  requestedReviewExtraNewLimit = Number(startButton.dataset.extraNewLimit) || 0;

  if(hasValidDriveToken()){
    startButton.disabled = true;
    startButton.textContent = "Syncing…";
    const synced = await syncDriveProgress({ quiet: true });
    renderSrsDashboard();

    if(synced){
      startDailyReview({ extraNewLimit: requestedReviewExtraNewLimit });
      requestedReviewExtraNewLimit = 0;
    }else{
      document.getElementById("syncReminderDialog").showModal();
    }
    return;
  }

  if(GOOGLE_CLIENT_ID){
    document.getElementById("syncReminderDialog").showModal();
    return;
  }

  startDailyReview({ extraNewLimit: requestedReviewExtraNewLimit });
  requestedReviewExtraNewLimit = 0;
}

function exitDailyReview(){
  stopCurrentAudio();
  appView = "lessons";
  renderAppView();
}

async function completeDailyReview(){
  dailyReviewCompleted = true;
  renderDailyReview();

  if(hasValidDriveToken()){
    syncDriveProgress({ quiet: true });
  }
}

function renderDailyReviewSyncStatus(reviewedCount){
  if(!reviewedCount) return "";

  if(driveSyncInFlight){
    return `
      <div class="srs-sync-status" data-state="syncing" role="status">
        Syncing with Google Drive&hellip;
      </div>
    `;
  }

  if(driveLastError && driveMetadata.dirty){
    return `
      <div class="srs-sync-status" data-state="error" role="status">
        <span>Progress saved locally &middot; Drive sync failed</span>
        <button class="study-secondary-btn" id="srsRetrySyncBtn" type="button">Retry Sync</button>
      </div>
    `;
  }

  if(driveMetadata.dirty && !hasValidDriveToken()){
    return `
      <div class="srs-sync-status" data-state="pending" role="status">
        <span>Progress saved locally &middot; Sync pending</span>
        <button class="study-secondary-btn" id="srsOpenSettingsBtn" type="button">Open Settings</button>
      </div>
    `;
  }

  if(!driveMetadata.dirty && driveMetadata.lastSyncedAt){
    return `
      <div class="srs-sync-status" data-state="synced" role="status">
        Synced
      </div>
    `;
  }

  return "";
}

async function rateCurrentDailyReviewCard(rating){
  const entry = dailyReviewQueue[dailyReviewIndex];
  if(!entry || !dailyReviewRevealed || dailyReviewWritePending) return;

  dailyReviewWritePending = true;
  renderDailyReview();
  try{
    const updated = await srsDatabase.rateCard(entry.id, rating, new Date());
    dailyReviewQueue[dailyReviewIndex] = { ...entry, ...updated };
    driveMetadata.dirty = true;
    await saveDriveMetadata();
    dailyReviewSessionStats.reviewed += 1;
    dailyReviewSessionStats.ratings[rating] += 1;
    dailyReviewIndex += 1;
    dailyReviewRevealed = false;
    stopCurrentAudio();

    if(dailyReviewIndex >= dailyReviewQueue.length){
      await completeDailyReview();
    }else{
      renderDailyReview();
    }
    renderSrsDashboard();
    renderDriveStatus();
  }catch(error){
    console.error(error);
    showToast("Progress was not saved. Please try again.");
  }finally{
    dailyReviewWritePending = false;
    renderDailyReview();
  }
}

async function renderDailyReview(){
  const container = document.getElementById("dailyReviewContent");
  if(!container) return;

  if(dailyReviewCompleted || dailyReviewIndex >= dailyReviewQueue.length){
    const session = dailyReviewSessionStats || {
      reviewed: 0,
      ratings: { again: 0, hard: 0, good: 0, easy: 0 }
    };
    const stats = await getSrsStats();
    const canLearnMore = stats.unseen > 0;
    container.innerHTML = `
      <div class="srs-shell">
        <div class="srs-toolbar">
          <div class="srs-progress">Daily Review</div>
          <div class="srs-toolbar-actions">
            <button class="study-secondary-btn" id="srsBackBtn" type="button">Back to Lessons</button>
          </div>
        </div>
        <div class="srs-summary">
          <div class="completion-mark" aria-hidden="true">✓</div>
          <div class="srs-card-label">Session complete</div>
          <h2>${session.reviewed} ${session.reviewed === 1 ? "card" : "cards"} reviewed</h2>
          <p class="completion-message">Good session. Your progress is safely saved.</p>
          <div class="srs-summary-stats">
            Again ${session.ratings.again} · Hard ${session.ratings.hard} · Good ${session.ratings.good} · Easy ${session.ratings.easy}<br>
            ${stats.due} due now · ${stats.learning} learning · ${stats.mature} mature
          </div>
          ${renderDailyReviewSyncStatus(session.reviewed)}
          ${canLearnMore ? `<button class="study-secondary-btn" id="srsLearnMoreBtn" type="button">Learn ${Math.min(SRS_NEW_CARD_LIMIT, stats.unseen)} More</button>` : ""}
          <button class="study-primary-btn" id="srsDoneBtn" type="button">Done</button>
        </div>
      </div>
    `;
    bindDailyReviewInteractions();
    return;
  }

  const entry = dailyReviewQueue[dailyReviewIndex];
  const previousCard = entry.state === "new" ? null : entry;
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
        <div class="srs-progress-group">
          <div class="srs-progress">
            ${dailyReviewIndex + 1} / ${dailyReviewQueue.length} · Lesson ${entry.lesson} · ${entry.queueType === "new" ? "New" : "Due"}
          </div>
          <div class="progress-track" aria-hidden="true"><span style="width:${Math.round((dailyReviewIndex / dailyReviewQueue.length) * 100)}%"></span></div>
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
            <button class="srs-rating-btn" type="button" data-rating="${rating}" ${dailyReviewWritePending ? "disabled" : ""}>
              ${rating[0].toUpperCase()}${rating.slice(1)}
              <small>${ratingIntervals[rating]}</small>
            </button>
          `).join("")}
        </div>
      ` : '<button class="srs-reveal-btn" id="srsRevealBtn" type="button">Show Answer</button>'}
    </div>
  `;
  bindDailyReviewInteractions();
  maybeAutoplayDailyReviewWord(entry);
}

function bindDailyReviewInteractions(){
  document.getElementById("srsBackBtn")?.addEventListener("click", exitDailyReview);
  document.getElementById("srsDoneBtn")?.addEventListener("click", exitDailyReview);
  document.getElementById("srsLearnMoreBtn")?.addEventListener("click", () => {
    startDailyReview({ extraNewLimit: SRS_NEW_CARD_LIMIT });
  });
  document.getElementById("srsOpenSettingsBtn")?.addEventListener("click", () => {
    setSettingsOpen(true);
  });
  document.getElementById("srsRetrySyncBtn")?.addEventListener("click", () => {
    syncDriveProgress();
  });
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
    button.addEventListener("click", event => {
      event.stopPropagation();
      playAudioSequence(getAudioButtonPaths(button));
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
  const valid = Boolean(driveAccessToken && Date.now() < driveAccessTokenExpiresAt - 30000);
  if(!valid && driveAccessToken){
    clearDriveSession();
  }
  return valid;
}

function renderDriveStatus(){
  const status = document.getElementById("driveStatus");
  const connectButton = document.getElementById("connectDriveBtn");
  const syncButton = document.getElementById("syncDriveBtn");
  updateSettingsButtonState();
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
        startReviewAfterDriveSync = false;
        requestedReviewExtraNewLimit = 0;
        driveLastError = "Google Drive authorization failed";
        renderDriveStatus();
        return;
      }

      driveAccessToken = response.access_token;
      driveAccessTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
      saveDriveSession();
      driveLastError = "";
      renderDriveStatus();
      const synced = await syncDriveProgress();
      if(startReviewAfterDriveSync && synced){
        startReviewAfterDriveSync = false;
        startDailyReview({ extraNewLimit: requestedReviewExtraNewLimit });
        requestedReviewExtraNewLimit = 0;
      }else if(!synced){
        startReviewAfterDriveSync = false;
        requestedReviewExtraNewLimit = 0;
      }
    },
    error_callback: () => {
      startReviewAfterDriveSync = false;
      requestedReviewExtraNewLimit = 0;
      driveAuthorizationPending = false;
      driveLastError = "Google Drive connection was cancelled";
      renderDriveStatus();
    }
  });

  return true;
}

function connectGoogleDrive(){
  if(!GOOGLE_CLIENT_ID){
    startReviewAfterDriveSync = false;
    requestedReviewExtraNewLimit = 0;
    showToast("Add your Google OAuth client ID in assets/config.js.");
    return;
  }

  if(!initializeDriveTokenClient()){
    startReviewAfterDriveSync = false;
    requestedReviewExtraNewLimit = 0;
    showToast("Google sign-in is still loading. Try again.");
    return;
  }

  driveLastError = "";
  driveAuthorizationPending = true;
  renderDriveStatus();
  try{
    driveTokenClient.requestAccessToken({ prompt: "" });
  }catch(error){
    startReviewAfterDriveSync = false;
    requestedReviewExtraNewLimit = 0;
    driveAuthorizationPending = false;
    driveLastError = "Could not open Google Drive authorization";
    renderDriveStatus();
  }
}

async function driveApiFetch(url, options = {}){
  if(!hasValidDriveToken()){
    clearDriveSession();
    throw new Error("Google Drive authorization expired. Connect again.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${driveAccessToken}`);
  const response = await fetch(url, {
    ...options,
    headers
  });

  if(response.status === 401){
    clearDriveSession();
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
    [1, 2, SRSCore.SCHEMA_VERSION].includes(value.schemaVersion) &&
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

  const normalized = SRSCore.normalizeSnapshot(value);
  if(!normalized){
    throw new Error("The Google Drive progress file is invalid or uses an unsupported version.");
  }
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
  if(driveSyncInFlight) return false;
  if(!hasValidDriveToken()){
    if(!options.quiet) connectGoogleDrive();
    return false;
  }

  driveSyncInFlight = true;
  driveLastError = "";
  renderDriveStatus();
  if(appView === "daily") renderDailyReview();

  try{
    let file = await findDriveProgressFile();

    if(file){
      const cloud = await downloadDriveProgress(file.id);
      await srsDatabase.mergeSnapshot(cloud);
      const uploadRevision = await srsDatabase.getRevision();
      const snapshot = await srsDatabase.exportSnapshot(driveMetadata.deviceId);
      await uploadDriveProgress(file.id, snapshot);
      driveMetadata.dirty = (await srsDatabase.getRevision()) !== uploadRevision;
    }else{
      const uploadRevision = await srsDatabase.getRevision();
      const snapshot = await srsDatabase.exportSnapshot(driveMetadata.deviceId);
      const created = await createDriveProgressFile(snapshot);
      file = { id: created.id };
      driveMetadata.dirty = (await srsDatabase.getRevision()) !== uploadRevision;
    }

    driveMetadata.driveFileId = file.id;
    driveMetadata.lastSyncedAt = new Date().toISOString();
    await saveDriveMetadata();
    renderSrsDashboard();
    if(!options.quiet) showToast("Google Drive sync complete.");
    return true;
  }catch(error){
    console.error(error);
    driveLastError = error.message || "Google Drive sync failed";
    driveMetadata.dirty = true;
    await saveDriveMetadata();
    if(!options.quiet) showToast("Drive sync failed. Progress is safe locally.");
    return false;
  }finally{
    driveSyncInFlight = false;
    renderDriveStatus();
    if(appView === "daily") renderDailyReview();
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

  renderVocabSetSelect(chunks, activeChunk.index);
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
  }else if(vocabMode === "quiz"){
    suppressNextVocabAutoplay = false;
    suppressNextVocabIdleStart = false;
    maybeAutoplayVocabQuizWord(vocabQuizQuestions[vocabQuizQuestionIndex]);
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

function renderVocabSetSelect(chunks, activeChunkIndex){
  const select = document.getElementById("vocabSetSelect");
  select.disabled = chunks.length === 0;
  select.innerHTML = chunks.length
    ? chunks.map(chunk => `
        <option value="${chunk.index}" ${chunk.index === activeChunkIndex ? "selected" : ""}>
          Words ${chunk.start + 1}-${chunk.end}
        </option>
      `).join("")
    : "<option>None</option>";
}

function renderLessonFilters(){
  const select = document.getElementById("lessonSelect");
  const filteredLessons = getFilteredLessonFiles()
    .filter(item => item.lesson)
    .sort((a, b) => Number(a.lesson) - Number(b.lesson));

  if(!filteredLessons.some(item => String(item.lesson) === String(activeLesson))){
    activeLesson = filteredLessons.length ? String(filteredLessons[0].lesson) : "";
  }

  if(!filteredLessons.length){
    select.innerHTML = "<option>No lessons for this level</option>";
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = filteredLessons.map(item => `
    <option value="${item.lesson}" ${String(activeLesson) === String(item.lesson) ? "selected" : ""}>
      Lesson ${item.lesson} · ${item.level}
    </option>
  `).join("");
}

document.getElementById("startDailyReviewBtn").addEventListener("click", requestDailyReviewStart);
document.getElementById("browseLessonsBtn").addEventListener("click", () => {
  document.getElementById("lessonStudySection").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("connectDriveBtn").addEventListener("click", connectGoogleDrive);
document.getElementById("syncDriveBtn").addEventListener("click", () => syncDriveProgress());
document.getElementById("continueOfflineBtn").addEventListener("click", () => {
  startReviewAfterDriveSync = false;
  startDailyReview({ extraNewLimit: requestedReviewExtraNewLimit });
  requestedReviewExtraNewLimit = 0;
});
document.getElementById("syncBeforeReviewBtn").addEventListener("click", () => {
  document.getElementById("syncReminderDialog").close();
  startReviewAfterDriveSync = true;
  connectGoogleDrive();
});
document.getElementById("lessonSelect").addEventListener("change", async event => {
  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  activeLesson = event.target.value;
  resetVocabFlashcard();
  resetVocabQuiz();
  await loadVocabForSelectedLesson();
});
document.getElementById("vocabSetSelect").addEventListener("change", event => {
  const chunkIndex = Number(event.target.value);
  if(!Number.isInteger(chunkIndex) || chunkIndex === getActiveVocabChunk().index) return;

  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  saveSelectedChunkIndex(activeLesson, chunkIndex);
  resetVocabFlashcard();
  resetVocabQuiz();
  renderVocabPanel();
});

const settingsButton = document.getElementById("settingsBtn");
const settingsPopover = document.getElementById("settingsPopover");
const settingsCloseButton = document.getElementById("settingsCloseBtn");
const jlptLevelSelect = document.getElementById("jlptLevelSelect");

function syncJlptLevelSelect(){
  if(jlptLevelSelect) jlptLevelSelect.value = selectedJlptLevel;
}

function updateSettingsButtonState(){
  const isOpen = !settingsPopover.hidden;
  const hasPendingSync = Boolean(driveMetadata.dirty);
  settingsButton.classList.toggle("has-unsynced", hasPendingSync);
  settingsButton.setAttribute(
    "aria-label",
    `${isOpen ? "Close" : "Open"} settings${hasPendingSync ? " - sync pending" : ""}`
  );
}

function setSettingsOpen(isOpen, options = {}){
  settingsPopover.hidden = !isOpen;
  settingsButton.setAttribute("aria-expanded", String(isOpen));
  updateSettingsButtonState();

  if(isOpen){
    renderDriveStatus();
    syncJlptLevelSelect();
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

jlptLevelSelect?.addEventListener("change", async event => {
  selectedJlptLevel = normalizeJlptLevel(event.target.value);
  localStorage.setItem("selectedJlptLevel", selectedJlptLevel);
  stopVocabIdleLearning({ disable: true });
  stopCurrentAudio();
  cancelVocabQuizAutoAdvance();
  resetVocabFlashcard();
  resetVocabQuiz();
  renderLessonFilters();
  if(activeLesson){
    await loadVocabForSelectedLesson();
  }else{
    renderVocabPanel();
  }
  renderSrsDashboard();
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

const themeButton = document.getElementById("themeBtn");
let dark = localStorage.getItem("studyTheme") === "dark"
  || (!localStorage.getItem("studyTheme") && globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches);

function applyTheme(){
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeButton.textContent = dark ? "☀" : "◐";
  themeButton.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
}

applyTheme();
themeButton.addEventListener("click", () => {
  dark = !dark;
  localStorage.setItem("studyTheme", dark ? "dark" : "light");
  applyTheme();
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

  data.lessons.forEach(entry => {
    if(!JLPT_LEVELS.includes(entry.level)){
      throw new Error(`Lesson ${entry.lesson} must include a valid JLPT level.`);
    }
  });

  lessonFiles = data.lessons;
  if(!activeLesson){
    const filteredLessons = getFilteredLessonFiles();
    if(filteredLessons.length){
      activeLesson = String(filteredLessons[0].lesson);
    }
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

async function loadVocabularyCatalog(){
  const data = await fetchJson("./data/vocab-catalog.json");
  if(!data || typeof data.version !== "string" || !Array.isArray(data.cards)){
    throw new Error("data/vocab-catalog.json must contain a version and cards array.");
  }
  vocabularyCatalog = data.cards;
  return data;
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
    const [, catalog] = await Promise.all([
      loadLessonManifest(),
      loadVocabularyCatalog(),
      srsDatabase.open()
    ]);
    await srsDatabase.reconcileCatalog(catalog);
    const migrated = await srsDatabase.migrateLegacy(localStorage.getItem(SRS_STORAGE_KEY));
    driveMetadata = await srsDatabase.getDriveMetadata();
    try{
      const legacyDriveMetadata = JSON.parse(localStorage.getItem(SRS_DRIVE_META_KEY) || "null");
      if(legacyDriveMetadata && !driveMetadata.lastSyncedAt){
        driveMetadata = {
          ...driveMetadata,
          driveFileId: typeof legacyDriveMetadata.driveFileId === "string" ? legacyDriveMetadata.driveFileId : "",
          lastSyncedAt: typeof legacyDriveMetadata.lastSyncedAt === "string" ? legacyDriveMetadata.lastSyncedAt : "",
          deviceId: typeof legacyDriveMetadata.deviceId === "string" ? legacyDriveMetadata.deviceId : driveMetadata.deviceId,
          dirty: migrated || legacyDriveMetadata.dirty === true
        };
      }else if(migrated){
        driveMetadata.dirty = true;
      }
    }catch(error){
      console.warn("Could not migrate legacy Drive metadata.", error);
    }
    await saveDriveMetadata();
    globalThis.navigator?.storage?.persist?.().catch(() => false);
    syncJlptLevelSelect();
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
