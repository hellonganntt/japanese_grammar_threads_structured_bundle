let grammarSections = [];
let lessonFiles = [];
const lessonCache = new Map();
let activeLesson = "";
let vocabPanelOpen = false;
let vocabMode = "list";
let vocabCardIndex = 0;
let vocabCardFlipped = false;
let vocabShuffleEnabled = false;
let vocabCardOrder = [];
let kanjiPanelOpen = false;

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderInlineMarkdown(text){
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function renderSections(sections = []){
  return sections.map(section => {
    switch(section.type){
      case "text":
        return `<p>${renderInlineMarkdown(section.text)}</p>`;
      case "pattern":
        return `<div class="pattern">${escapeHtml(section.text).replace(/\n/g, "<br>")}</div>`;
      case "example_jp":
        return `<p class="jp">${escapeHtml(section.text)}</p>`;
      case "translation":
        return `<p class="translation">${escapeHtml(section.text)}</p>`;
      case "tip":
        return `<div class="tip">${renderInlineMarkdown(section.text).replace(/\n/g, "<br>")}</div>`;
      default:
        return section.text ? `<p>${escapeHtml(section.text)}</p>` : "";
    }
  }).join("");
}

function normalizeNote(note){
  if(Array.isArray(note)){
    return {
      text: note[1]
    };
  }

  return note || {};
}

function renderSupportingBlock(note){
  const item = normalizeNote(note);
  const nestedNotes = Array.isArray(item.notes) && item.notes.length
    ? `<div class="supporting-nested">${item.notes.map(renderSupportingBlock).join("")}</div>`
    : "";
  const title = item.title ? `<div class="supporting-title">${escapeHtml(item.title)}</div>` : "";
  const tag = item.tag ? `<div class="supporting-tag">${escapeHtml(item.tag)}</div>` : "";
  const body = item.sections
    ? `<div class="supporting-body">${renderSections(item.sections)}</div>`
    : escapeHtml(item.text || "");

  return `
    <div class="supporting-block">
      ${title}
      ${tag}
      ${body}
      ${nestedNotes}
    </div>
  `;
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

function clampVocabCardIndex(vocab){
  if(!vocab.length){
    vocabCardIndex = 0;
    return;
  }

  vocabCardIndex = Math.max(0, Math.min(vocabCardIndex, vocab.length - 1));
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
          <button class="flashcard-option-btn ${vocabShuffleEnabled ? "active" : ""}" id="vocabShuffleBtn" type="button">${vocabShuffleEnabled ? "Trộn: Bật" : "Trộn: Tắt"}</button>
          ${vocabShuffleEnabled ? '<button class="flashcard-option-btn" id="vocabReshuffleBtn" type="button">Trộn lại</button>' : ""}
        </div>
      </div>
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
        <button class="flashcard-nav" id="vocabNextBtn" type="button" ${vocabCardIndex === flashcardItems.length - 1 ? "disabled" : ""}>Tiếp</button>
      </div>
    </div>
  `;
}

function bindVocabInteractions(vocab){
  document.querySelectorAll(".vocab-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if(vocabMode === btn.dataset.mode) return;
      vocabMode = btn.dataset.mode;
      resetVocabFlashcard();
      renderVocabPanel();
    });
  });

  if(vocabMode !== "flashcard" || !vocab.length) return;

  const flipCard = () => {
    vocabCardFlipped = !vocabCardFlipped;
    renderVocabPanel();
  };

  document.getElementById("vocabFlashcard")?.addEventListener("click", flipCard);
  document.getElementById("vocabFlipBtn")?.addEventListener("click", flipCard);
  document.getElementById("vocabShuffleBtn")?.addEventListener("click", () => {
    vocabShuffleEnabled = !vocabShuffleEnabled;
    resetVocabFlashcard();
    renderVocabPanel();
  });
  document.getElementById("vocabReshuffleBtn")?.addEventListener("click", () => {
    vocabCardOrder = createShuffledOrder(vocab.length);
    vocabCardIndex = 0;
    vocabCardFlipped = false;
    renderVocabPanel();
  });
  document.getElementById("vocabPrevBtn")?.addEventListener("click", () => {
    if(vocabCardIndex === 0) return;
    vocabCardIndex -= 1;
    vocabCardFlipped = false;
    renderVocabPanel();
  });
  document.getElementById("vocabNextBtn")?.addEventListener("click", () => {
    if(vocabCardIndex >= vocab.length - 1) return;
    vocabCardIndex += 1;
    vocabCardFlipped = false;
    renderVocabPanel();
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
  meta.textContent = `${vocab.length} từ ${vocabPanelOpen ? "▴" : "▾"}`;
  toggle.setAttribute("aria-expanded", String(vocabPanelOpen));
  panel.classList.toggle("open", vocabPanelOpen);

  if(!vocab.length){
    content.innerHTML = '<div class="empty" style="padding:18px 8px">Chưa có từ vựng cho bài này.</div>';
    return;
  }

  content.innerHTML = `
    <div class="vocab-mode-switch" role="tablist" aria-label="Chế độ từ vựng">
      <button class="vocab-mode-btn ${vocabMode === "list" ? "active" : ""}" type="button" data-mode="list">List</button>
      <button class="vocab-mode-btn ${vocabMode === "flashcard" ? "active" : ""}" type="button" data-mode="flashcard">Flashcard</button>
    </div>
    ${vocabMode === "flashcard" ? renderVocabFlashcard(vocab) : renderVocabList(vocab)}
  `;
  bindVocabInteractions(vocab);
}

function getKanjiForSelectedLesson(){
  return lessonCache.get(String(activeLesson))?.kanji || [];
}

function renderKanjiExamples(examples = []){
  if(!Array.isArray(examples) || !examples.length) return "";

  return `
    <div class="kanji-examples">
      ${examples.map(example => `
        <div>
          <span class="kanji-example-word">${escapeHtml(example.word)}</span>
          ${example.reading ? `<span class="vocab-reading">${escapeHtml(example.reading)}</span>` : ""}
          ${example.meaning ? ` - ${escapeHtml(example.meaning)}` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderKanjiPanel(){
  const panel = document.getElementById("kanjiPanel");
  const toggle = document.getElementById("kanjiToggle");
  const title = document.getElementById("kanjiTitle");
  const meta = document.getElementById("kanjiMeta");
  const content = document.getElementById("kanjiContent");
  const kanji = getKanjiForSelectedLesson();

  title.textContent = "漢字";
  meta.textContent = `${kanji.length} chữ ${kanjiPanelOpen ? "▴" : "▾"}`;
  toggle.setAttribute("aria-expanded", String(kanjiPanelOpen));
  panel.classList.toggle("open", kanjiPanelOpen);

  if(!kanji.length){
    content.innerHTML = '<div class="empty" style="padding:18px 8px">Chưa có kanji cho bài này.</div>';
    return;
  }

  content.innerHTML = `
    <div class="kanji-list">
      ${kanji.map(item => `
        <article class="kanji-card">
          <div class="kanji-char">${escapeHtml(item.kanji)}</div>
          <div>
            <div class="kanji-meaning">${escapeHtml(item.meaning)}</div>
            <div class="kanji-readings">
              ${Array.isArray(item.onyomi) && item.onyomi.length ? `<div><span class="kanji-reading-label">On</span>${escapeHtml(item.onyomi.join("、"))}</div>` : ""}
              ${Array.isArray(item.kunyomi) && item.kunyomi.length ? `<div><span class="kanji-reading-label">Kun</span>${escapeHtml(item.kunyomi.join("、"))}</div>` : ""}
            </div>
            ${renderKanjiExamples(item.examples)}
            ${item.note ? `<div class="kanji-note">${escapeHtml(item.note)}</div>` : ""}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function render(){
  const outline = document.getElementById("grammarOutline");
  if(!grammarSections.length){
    outline.innerHTML = '<div class="empty">Không có ngữ pháp cho bài này.</div>';
    return;
  }

  outline.innerHTML = grammarSections.map((section, sectionIndex) => `
    <section class="grammar-section">
      <button class="grammar-section-toggle" type="button" aria-expanded="${section.open !== false}">
        <span>${escapeHtml(section.title || `Ngữ pháp ${sectionIndex + 1}`)}</span>
        <span class="grammar-count">${Array.isArray(section.points) ? section.points.length : 0} mục ▾</span>
      </button>
      <div class="grammar-section-content">
        ${(section.points || []).map((point, pointIndex) => `
          <article class="grammar-point">
            <button class="grammar-point-toggle" type="button" aria-expanded="false">
              <span>
                ${point.tag ? `<span class="tag">${escapeHtml(point.tag)}</span>` : ""}
                <span class="grammar-title">${escapeHtml(point.title || `Mục ${pointIndex + 1}`)}</span>
              </span>
              <span class="toggle-mark">▾</span>
            </button>
            <div class="grammar-point-content">
              ${point.sections && point.sections.length ? `<div class="grammar-body">${renderSections(point.sections)}</div>` : ""}
              ${point.notes && point.notes.length ? `
                <div class="supporting-material">
                  ${point.notes.map(renderSupportingBlock).join("")}
                </div>
              ` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
  bindInteractions();
}

function bindCollapsible(selector){
  document.querySelectorAll(selector).forEach(toggle => {
    const setOpen = isOpen => {
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.parentElement.classList.toggle("open", isOpen);
    };
    setOpen(toggle.getAttribute("aria-expanded") === "true");
    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
  });
}

function bindInteractions(){
  bindCollapsible(".grammar-section-toggle");
  bindCollapsible(".grammar-point-toggle");
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
      activeLesson = chip.dataset.lesson;
      resetVocabFlashcard();
      renderLessonFilters();
      await loadGrammarForSelectedLesson();
    });
  });
}

document.getElementById("vocabToggle").addEventListener("click", () => {
  vocabPanelOpen = !vocabPanelOpen;
  renderVocabPanel();
});

document.getElementById("kanjiToggle").addEventListener("click", () => {
  kanjiPanelOpen = !kanjiPanelOpen;
  renderKanjiPanel();
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
  if(!data || !Array.isArray(data.grammarSections)){
    throw new Error(`${lessonFile.file} must contain a grammarSections array.`);
  }

  const lessonData = {
    grammarSections: data.grammarSections,
    vocab: data.vocab || [],
    kanji: data.kanji || []
  };

  lessonCache.set(lessonKey, lessonData);
  return lessonData;
}

async function loadGrammarForSelectedLesson(){
  const outline = document.getElementById("grammarOutline");
  outline.innerHTML = '<div class="empty">Loading grammar data...</div>';

  try{
    grammarSections = (await loadLessonData(activeLesson)).grammarSections;

    renderVocabPanel();
    renderKanjiPanel();
    render();
  }catch(error){
    console.error(error);
    outline.innerHTML = `
      <div class="empty">
        <p><b>Cannot load the selected lesson JSON file.</b></p>
        <p>Check data/lessons.json and the per-lesson files in the data folder.</p>
        <p>Browsers usually block fetch from file://, so run:</p>
        <div class="pattern" style="text-align:left">py -m http.server 8000</div>
        <p>Then open:</p>
        <div class="pattern" style="text-align:left">http://localhost:8000/japanese_grammar_threads_structured.html</div>
      </div>
    `;
  }
}

async function loadGrammarData(){
  const outline = document.getElementById("grammarOutline");
  outline.innerHTML = '<div class="empty">Loading lesson list...</div>';

  try{
    await loadLessonManifest();
    renderLessonFilters();
    await loadGrammarForSelectedLesson();
  }catch(error){
    console.error(error);
    outline.innerHTML = `
      <div class="empty">
        <p><b>Cannot load data/lessons.json.</b></p>
        <p>The lesson manifest must point to each lesson JSON file.</p>
        <p>Browsers usually block fetch from file://, so run:</p>
        <div class="pattern" style="text-align:left">py -m http.server 8000</div>
        <p>Then open:</p>
        <div class="pattern" style="text-align:left">http://localhost:8000/japanese_grammar_threads_structured.html</div>
      </div>
    `;
  }
}

loadGrammarData();
