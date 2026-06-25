const assert = require("node:assert/strict");
const SRS = require("../assets/srs.js");

const now = new Date("2026-06-24T10:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

function dueCard(overrides = {}){
  return {
    state: "review",
    due: "2026-06-24T09:00:00.000Z",
    intervalDays: 3,
    ease: 2.5,
    repetitions: 2,
    lapses: 0,
    lastRating: "good",
    lastReviewedAt: "2026-06-21T10:00:00.000Z",
    updatedAt: "2026-06-21T10:00:00.000Z",
    ...overrides
  };
}

{
  const legacy = {
    schemaVersion: 1,
    updatedAt: now.toISOString(),
    cards: { legacy: dueCard() }
  };
  const migrated = SRS.normalizeProgress(legacy, now);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.activity, {});
  assert.ok(migrated.cards.legacy);
}

{
  const card = SRS.rateCard(null, "again", now);
  assert.equal(card.state, "learning");
  assert.equal(card.intervalDays, 0);
  assert.equal(card.lapses, 1);
  assert.equal(Date.parse(card.due), now.getTime() + 10 * 60 * 1000);
}

{
  const firstGood = SRS.rateCard(null, "good", now);
  const secondGood = SRS.rateCard(firstGood, "good", new Date(now.getTime() + day));
  const thirdGood = SRS.rateCard(secondGood, "good", new Date(now.getTime() + 4 * day));
  assert.equal(firstGood.intervalDays, 1);
  assert.equal(secondGood.intervalDays, 3);
  assert.equal(thirdGood.intervalDays, 8);
}

{
  const hard = SRS.rateCard(dueCard(), "hard", now);
  assert.equal(hard.intervalDays, 4);
  assert.equal(hard.ease, 2.35);
}

{
  const easy = SRS.rateCard(null, "easy", now);
  assert.equal(easy.intervalDays, 4);
  assert.equal(easy.ease, 2.65);
}

{
  const catalog = Array.from({ length: 14 }, (_, index) => ({
    id: `l36-v${String(index + 1).padStart(3, "0")}`,
    order: index
  }));
  const progress = SRS.createEmptyProgress(now);
  progress.cards[catalog[2].id] = dueCard({ due: "2026-06-24T08:00:00.000Z" });
  progress.cards[catalog[1].id] = dueCard({ due: "2026-06-24T07:00:00.000Z" });
  progress.cards[catalog[3].id] = dueCard({ due: "2026-06-25T07:00:00.000Z" });

  const queue = SRS.buildDailyQueue(catalog, progress, now, 10);
  assert.deepEqual(queue.slice(0, 2).map(item => item.id), [catalog[1].id, catalog[2].id]);
  assert.equal(queue.filter(item => item.queueType === "new").length, 10);
  assert.equal(queue.some(item => item.id === catalog[3].id), false);
}

{
  const catalog = Array.from({ length: 25 }, (_, index) => ({
    id: `daily-${index + 1}`,
    order: index
  }));
  const progress = SRS.createEmptyProgress(now);

  for(let index = 0; index < 7; index += 1){
    progress.cards[catalog[index].id] = SRS.rateCard(null, "good", now);
  }

  const regularQueue = SRS.buildDailyQueue(catalog, progress, now, 10);
  assert.equal(regularQueue.filter(item => item.queueType === "new").length, 3);
  assert.equal(SRS.getProgressStats(catalog, progress, now, 10).newToday, 3);

  const extraQueue = SRS.buildDailyQueue(catalog, progress, now, 10, 10);
  assert.equal(extraQueue.filter(item => item.queueType === "new").length, 13);

  const nextDay = new Date(now.getTime() + day);
  const nextDayQueue = SRS.buildDailyQueue(catalog, progress, nextDay, 10);
  assert.equal(nextDayQueue.filter(item => item.queueType === "new").length, 10);
}

{
  const introduced = SRS.rateCard(null, "good", now);
  const reviewedAgain = SRS.rateCard(introduced, "good", new Date(now.getTime() + day));
  assert.equal(reviewedAgain.introducedAt, introduced.introducedAt);

  const reviewedLegacyCard = SRS.rateCard(dueCard(), "good", now);
  assert.equal(reviewedLegacyCard.introducedAt, null);
}

{
  const catalog = Array.from({ length: 12 }, (_, index) => ({
    id: `goal-${index + 1}`,
    order: index
  }));
  const progress = SRS.createEmptyProgress(now);
  progress.cards[catalog[0].id] = dueCard();
  progress.cards[catalog[1].id] = dueCard();
  const queue = SRS.buildDailyQueue(catalog, progress, now, 10);
  const started = SRS.startDailyGoal(progress, queue, now);
  const goal = SRS.getDailyGoal(started, now);
  assert.equal(goal.type, "due");
  assert.equal(goal.target, 2);

  const first = SRS.recordReviewActivity(started, catalog[0].id, false, now);
  assert.equal(SRS.getDailyGoal(first, now).percent, 50);
  const complete = SRS.recordReviewActivity(first, catalog[1].id, false, now);
  assert.equal(SRS.getDailyGoal(complete, now).isComplete, true);
  assert.equal(SRS.getActivitySummary(complete, now).streak, 1);

  const previousDay = new Date(now.getTime() - day);
  let previousProgress = SRS.startDailyGoal(
    SRS.createEmptyProgress(previousDay),
    [{ id: "yesterday", queueType: "new" }],
    previousDay
  );
  previousProgress = SRS.recordReviewActivity(previousProgress, "yesterday", true, previousDay);
  const combined = SRS.mergeProgress(previousProgress, complete, now);
  assert.equal(SRS.getActivitySummary(combined, now).streak, 2);
}

{
  const catalog = Array.from({ length: 4 }, (_, index) => ({
    id: `new-goal-${index + 1}`,
    order: index
  }));
  const progress = SRS.createEmptyProgress(now);
  const queue = SRS.buildDailyQueue(catalog, progress, now, 10);
  const started = SRS.startDailyGoal(progress, queue, now);
  assert.equal(SRS.getDailyGoal(started, now).type, "new");
  assert.equal(SRS.getDailyGoal(started, now).target, 4);

  const unchanged = SRS.startDailyGoal(progress, queue, now, { extraNewLimit: 10 });
  assert.equal(SRS.getDailyGoal(unchanged, now).target, 0);
}

{
  const local = {
    schemaVersion: 2,
    updatedAt: "2026-06-24T10:00:00.000Z",
    cards: {
      shared: dueCard({ updatedAt: "2026-06-24T10:00:00.000Z", intervalDays: 8 }),
      localOnly: dueCard()
    },
    activity: {
      "2026-06-24": {
        reviewedIds: ["one"],
        introducedIds: [],
        goal: {
          type: "due",
          targetIds: ["one", "two"],
          startedAt: "2026-06-24T08:00:00.000Z"
        },
        completedAt: null,
        updatedAt: "2026-06-24T10:00:00.000Z"
      }
    }
  };
  const cloud = {
    schemaVersion: 2,
    updatedAt: "2026-06-24T11:00:00.000Z",
    cards: {
      shared: dueCard({ updatedAt: "2026-06-24T11:00:00.000Z", intervalDays: 20 }),
      cloudOnly: dueCard()
    },
    activity: {
      "2026-06-24": {
        reviewedIds: ["two"],
        introducedIds: ["two"],
        goal: {
          type: "due",
          targetIds: ["one", "two"],
          startedAt: "2026-06-24T09:00:00.000Z"
        },
        completedAt: null,
        updatedAt: "2026-06-24T11:00:00.000Z"
      }
    }
  };
  const merged = SRS.mergeProgress(local, cloud, now);
  assert.equal(merged.cards.shared.intervalDays, 20);
  assert.ok(merged.cards.localOnly);
  assert.ok(merged.cards.cloudOnly);
  assert.deepEqual(merged.activity["2026-06-24"].reviewedIds.sort(), ["one", "two"]);
  assert.deepEqual(merged.activity["2026-06-24"].introducedIds, ["two"]);
  assert.equal(merged.activity["2026-06-24"].goal.startedAt, "2026-06-24T08:00:00.000Z");
  assert.ok(merged.activity["2026-06-24"].completedAt);
}

console.log("SRS tests passed.");
