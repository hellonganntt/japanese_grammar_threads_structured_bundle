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
    introducedAt: "2026-06-20T10:00:00.000Z",
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
  assert.equal(secondGood.introducedAt, firstGood.introducedAt);
}

{
  const hard = SRS.rateCard(dueCard(), "hard", now);
  assert.equal(hard.intervalDays, 4);
  assert.equal(hard.ease, 2.35);

  const easy = SRS.rateCard(null, "easy", now);
  assert.equal(easy.intervalDays, 4);
  assert.equal(easy.ease, 2.65);
}

{
  const catalogCard = SRS.createCatalogCard({
    id: "n4-l36-v001",
    lesson: 36,
    level: "N4",
    lessonIndex: 0,
    order: 0
  });
  assert.equal(catalogCard.state, "new");
  assert.equal(catalogCard.available, true);
  assert.equal(catalogCard.due, null);
  assert.equal(catalogCard.level, "N4");
}

{
  const legacy = {
    schemaVersion: 2,
    updatedAt: now.toISOString(),
    cards: {
      valid: dueCard(),
      invalid: { due: "not-a-date" }
    },
    activity: {
      "2026-06-24": { reviewedIds: ["valid"] }
    }
  };
  const snapshot = SRS.normalizeSnapshot(legacy);
  assert.equal(snapshot.schemaVersion, 3);
  assert.deepEqual(Object.keys(snapshot.cards), ["valid"]);
  assert.equal("activity" in snapshot, false);
}

{
  const local = dueCard({ updatedAt: "2026-06-24T10:00:00.000Z", intervalDays: 8 });
  const cloud = dueCard({ updatedAt: "2026-06-24T11:00:00.000Z", intervalDays: 20 });
  assert.equal(SRS.mergeSchedules(local, cloud).intervalDays, 20);
  assert.equal(SRS.mergeSchedules(cloud, local).intervalDays, 20);
}

{
  const bounds = SRS.getLocalDayBounds(new Date(2026, 5, 24, 23, 30));
  assert.equal(new Date(bounds.start).getDate(), 24);
  assert.equal(new Date(bounds.end).getDate(), 25);
}

console.log("SRS tests passed.");
