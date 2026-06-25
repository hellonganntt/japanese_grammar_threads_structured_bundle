(function(root, factory){
  const api = factory();

  if(typeof module === "object" && module.exports){
    module.exports = api;
  }else{
    root.SRSCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  const SCHEMA_VERSION = 1;
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

  function isSameLocalDay(leftValue, rightValue){
    const left = leftValue instanceof Date ? leftValue : new Date(leftValue);
    const right = rightValue instanceof Date ? rightValue : new Date(rightValue);
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  function createEmptyProgress(now = new Date()){
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: toIso(now),
      cards: {}
    };
  }

  function normalizeCard(card){
    if(!card || typeof card !== "object") return null;

    const due = isValidDate(card.due) ? card.due : null;
    const updatedAt = isValidDate(card.updatedAt) ? card.updatedAt : null;
    if(!due || !updatedAt) return null;

    const state = card.state === "learning" ? "learning" : "review";
    const intervalDays = Math.max(0, Math.round(Number(card.intervalDays) || 0));
    const ease = Math.max(MINIMUM_EASE, Number(card.ease) || INITIAL_EASE);
    const repetitions = Math.max(0, Math.floor(Number(card.repetitions) || 0));
    const lapses = Math.max(0, Math.floor(Number(card.lapses) || 0));
    const lastRating = RATINGS.has(card.lastRating) ? card.lastRating : null;

    return {
      state,
      due,
      intervalDays,
      ease,
      repetitions,
      lapses,
      lastRating,
      introducedAt: isValidDate(card.introducedAt) ? card.introducedAt : null,
      lastReviewedAt: isValidDate(card.lastReviewedAt) ? card.lastReviewedAt : updatedAt,
      updatedAt
    };
  }

  function normalizeProgress(value, now = new Date()){
    const progress = createEmptyProgress(now);
    if(!value || typeof value !== "object") return progress;

    const cards = value.cards && typeof value.cards === "object" ? value.cards : {};
    Object.entries(cards).forEach(([id, card]) => {
      const normalized = normalizeCard(card);
      if(id && normalized){
        progress.cards[id] = normalized;
      }
    });

    if(isValidDate(value.updatedAt)){
      progress.updatedAt = value.updatedAt;
    }

    return progress;
  }

  function rateCard(previousCard, rating, now = new Date()){
    if(!RATINGS.has(rating)){
      throw new Error(`Unsupported SRS rating: ${rating}`);
    }

    const reviewedAt = now instanceof Date ? now : new Date(now);
    const normalizedPrevious = normalizeCard(previousCard);
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

  function countIntroducedOnLocalDay(catalog, progress, now){
    return catalog.reduce((count, entry) => {
      const introducedAt = progress.cards[entry.id]?.introducedAt;
      return count + (introducedAt && isSameLocalDay(introducedAt, now) ? 1 : 0);
    }, 0);
  }

  function buildDailyQueue(catalog, progressValue, now = new Date(), newLimit = 10, extraNewLimit = 0){
    const progress = normalizeProgress(progressValue, now);
    const currentDate = now instanceof Date ? now : new Date(now);
    const timestamp = currentDate.getTime();
    const due = [];
    const unseen = [];

    catalog.forEach(entry => {
      const card = progress.cards[entry.id];
      if(!card){
        unseen.push(entry);
      }else if(Date.parse(card.due) <= timestamp){
        due.push(entry);
      }
    });

    due.sort((left, right) => {
      const dueDifference = Date.parse(progress.cards[left.id].due) - Date.parse(progress.cards[right.id].due);
      return dueDifference || left.order - right.order;
    });
    unseen.sort((left, right) => left.order - right.order);
    const introducedToday = countIntroducedOnLocalDay(catalog, progress, currentDate);
    const remainingDailyNew = Math.max(0, newLimit - introducedToday);
    const availableNew = remainingDailyNew + Math.max(0, extraNewLimit);

    return [
      ...due.map(entry => ({ ...entry, queueType: "due" })),
      ...unseen.slice(0, availableNew).map(entry => ({ ...entry, queueType: "new" }))
    ];
  }

  function getProgressStats(catalog, progressValue, now = new Date(), newLimit = 10){
    const progress = normalizeProgress(progressValue, now);
    const catalogIds = new Set(catalog.map(entry => entry.id));
    const currentDate = now instanceof Date ? now : new Date(now);
    const timestamp = currentDate.getTime();
    let due = 0;
    let unseen = 0;
    let learning = 0;
    let mature = 0;

    catalog.forEach(entry => {
      const card = progress.cards[entry.id];
      if(!card){
        unseen += 1;
        return;
      }

      if(Date.parse(card.due) <= timestamp) due += 1;
      if(card.state === "learning") learning += 1;
      if(card.intervalDays >= MATURE_INTERVAL_DAYS) mature += 1;
    });
    const introducedToday = countIntroducedOnLocalDay(catalog, progress, currentDate);
    const remainingDailyNew = Math.max(0, newLimit - introducedToday);

    return {
      total: catalog.length,
      tracked: Object.keys(progress.cards).filter(id => catalogIds.has(id)).length,
      due,
      newToday: Math.min(unseen, remainingDailyNew),
      introducedToday,
      unseen,
      learning,
      mature
    };
  }

  function mergeProgress(localValue, cloudValue, now = new Date()){
    const local = normalizeProgress(localValue, now);
    const cloud = normalizeProgress(cloudValue, now);
    const cards = {};
    const ids = new Set([...Object.keys(local.cards), ...Object.keys(cloud.cards)]);

    ids.forEach(id => {
      const localCard = local.cards[id];
      const cloudCard = cloud.cards[id];

      if(!localCard){
        cards[id] = cloudCard;
      }else if(!cloudCard){
        cards[id] = localCard;
      }else{
        cards[id] = Date.parse(localCard.updatedAt) >= Date.parse(cloudCard.updatedAt)
          ? localCard
          : cloudCard;
      }
    });

    const updatedAt = [local.updatedAt, cloud.updatedAt]
      .filter(isValidDate)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || toIso(now);

    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt,
      cards
    };
  }

  return {
    SCHEMA_VERSION,
    INITIAL_EASE,
    MINIMUM_EASE,
    MATURE_INTERVAL_DAYS,
    createEmptyProgress,
    normalizeProgress,
    rateCard,
    buildDailyQueue,
    getProgressStats,
    mergeProgress
  };
});
