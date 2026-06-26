(function(root, factory){
  const api = factory();

  if(typeof module === "object" && module.exports){
    module.exports = api;
  }else{
    root.SRSCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  const SCHEMA_VERSION = 3;
  const INITIAL_EASE = 2.5;
  const MINIMUM_EASE = 1.3;
  const MATURE_INTERVAL_DAYS = 21;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const RATINGS = new Set(["again", "hard", "good", "easy"]);

  function toIso(value){
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  function isValidDate(value){
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }

  function getLocalDayBounds(value = new Date()){
    const date = value instanceof Date ? value : new Date(value);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function createCatalogCard(entry){
    return {
      id: String(entry.id),
      lesson: Number(entry.lesson) || 0,
      level: typeof entry.level === "string" ? entry.level : "",
      lessonIndex: Math.max(0, Number(entry.lessonIndex) || 0),
      order: Math.max(0, Number(entry.order) || 0),
      available: entry.available !== false,
      state: "new",
      due: null,
      intervalDays: 0,
      ease: INITIAL_EASE,
      repetitions: 0,
      lapses: 0,
      lastRating: null,
      introducedAt: null,
      lastReviewedAt: null,
      updatedAt: null
    };
  }

  function normalizeScheduledCard(card){
    if(!card || typeof card !== "object") return null;
    const due = isValidDate(card.due) ? card.due : null;
    const updatedAt = isValidDate(card.updatedAt) ? card.updatedAt : null;
    if(!due || !updatedAt) return null;

    return {
      state: card.state === "learning" ? "learning" : "review",
      due,
      intervalDays: Math.max(0, Math.round(Number(card.intervalDays) || 0)),
      ease: Math.max(MINIMUM_EASE, Number(card.ease) || INITIAL_EASE),
      repetitions: Math.max(0, Math.floor(Number(card.repetitions) || 0)),
      lapses: Math.max(0, Math.floor(Number(card.lapses) || 0)),
      lastRating: RATINGS.has(card.lastRating) ? card.lastRating : null,
      introducedAt: isValidDate(card.introducedAt) ? card.introducedAt : updatedAt,
      lastReviewedAt: isValidDate(card.lastReviewedAt) ? card.lastReviewedAt : updatedAt,
      updatedAt
    };
  }

  function applySchedule(card, schedule){
    const base = card?.id ? card : createCatalogCard(card || {});
    const normalized = normalizeScheduledCard(schedule);
    return normalized ? { ...base, ...normalized } : base;
  }

  function rateCard(previousCard, rating, now = new Date()){
    if(!RATINGS.has(rating)){
      throw new Error(`Unsupported SRS rating: ${rating}`);
    }

    const reviewedAt = now instanceof Date ? now : new Date(now);
    const normalizedPrevious = normalizeScheduledCard(previousCard);
    const previous = normalizedPrevious || {
      state: "learning",
      due: toIso(reviewedAt),
      intervalDays: 0,
      ease: INITIAL_EASE,
      repetitions: 0,
      lapses: 0,
      lastRating: null,
      introducedAt: toIso(reviewedAt),
      lastReviewedAt: toIso(reviewedAt),
      updatedAt: toIso(reviewedAt)
    };

    let state = "review";
    let intervalDays = previous.intervalDays;
    let ease = previous.ease;
    let repetitions = previous.repetitions;
    let lapses = previous.lapses;
    let dueAt;

    if(rating === "again"){
      state = "learning";
      intervalDays = 0;
      repetitions = 0;
      lapses += 1;
      ease = Math.max(MINIMUM_EASE, ease - 0.2);
      dueAt = new Date(reviewedAt.getTime() + TEN_MINUTES_MS);
    }else if(rating === "hard"){
      intervalDays = repetitions === 0
        ? 1
        : Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2));
      repetitions += 1;
      ease = Math.max(MINIMUM_EASE, ease - 0.15);
      dueAt = new Date(reviewedAt.getTime() + intervalDays * DAY_MS);
    }else if(rating === "good"){
      if(repetitions === 0){
        intervalDays = 1;
      }else if(repetitions === 1){
        intervalDays = 3;
      }else{
        intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * ease));
      }
      repetitions += 1;
      dueAt = new Date(reviewedAt.getTime() + intervalDays * DAY_MS);
    }else{
      intervalDays = repetitions === 0
        ? 4
        : Math.max(1, Math.round(Math.max(1, intervalDays) * ease * 1.3));
      repetitions += 1;
      ease += 0.15;
      dueAt = new Date(reviewedAt.getTime() + intervalDays * DAY_MS);
    }

    const timestamp = toIso(reviewedAt);
    return {
      state,
      due: toIso(dueAt),
      intervalDays,
      ease: Number(ease.toFixed(2)),
      repetitions,
      lapses,
      lastRating: rating,
      introducedAt: normalizedPrevious ? previous.introducedAt : timestamp,
      lastReviewedAt: timestamp,
      updatedAt: timestamp
    };
  }

  function normalizeSnapshot(value){
    if(!value || typeof value !== "object") return null;
    if(![1, 2, SCHEMA_VERSION].includes(value.schemaVersion)) return null;
    if(!value.cards || typeof value.cards !== "object" || Array.isArray(value.cards)) return null;

    const cards = {};
    Object.entries(value.cards).forEach(([id, card]) => {
      const normalized = normalizeScheduledCard(card);
      if(id && normalized) cards[id] = normalized;
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isValidDate(value.exportedAt) ? value.exportedAt : toIso(new Date()),
      deviceId: typeof value.deviceId === "string" ? value.deviceId : "",
      cards
    };
  }

  function mergeSchedules(localCard, cloudCard){
    const local = normalizeScheduledCard(localCard);
    const cloud = normalizeScheduledCard(cloudCard);
    if(!local) return cloud;
    if(!cloud) return local;
    return Date.parse(local.updatedAt) >= Date.parse(cloud.updatedAt) ? local : cloud;
  }

  return {
    SCHEMA_VERSION,
    INITIAL_EASE,
    MINIMUM_EASE,
    MATURE_INTERVAL_DAYS,
    getLocalDayBounds,
    createCatalogCard,
    normalizeScheduledCard,
    applySchedule,
    rateCard,
    normalizeSnapshot,
    mergeSchedules
  };
});
