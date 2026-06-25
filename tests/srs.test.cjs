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
  const local = {
    schemaVersion: 1,
    updatedAt: "2026-06-24T10:00:00.000Z",
    cards: {
      shared: dueCard({ updatedAt: "2026-06-24T10:00:00.000Z", intervalDays: 8 }),
      localOnly: dueCard()
    }
  };
  const cloud = {
    schemaVersion: 1,
    updatedAt: "2026-06-24T11:00:00.000Z",
    cards: {
      shared: dueCard({ updatedAt: "2026-06-24T11:00:00.000Z", intervalDays: 20 }),
      cloudOnly: dueCard()
    }
  };
  const merged = SRS.mergeProgress(local, cloud, now);
  assert.equal(merged.cards.shared.intervalDays, 20);
  assert.ok(merged.cards.localOnly);
  assert.ok(merged.cards.cloudOnly);
}

console.log("SRS tests passed.");
