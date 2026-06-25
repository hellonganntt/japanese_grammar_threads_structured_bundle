const assert = require("node:assert/strict");
const { indexedDB, IDBKeyRange } = require("fake-indexeddb");

global.SRSCore = require("../assets/srs.js");
const { Database } = require("../assets/srs-db.js");

const now = new Date("2026-06-24T10:00:00.000Z");

function catalog(count, version = `v-${count}`){
  return {
    version,
    cards: Array.from({ length: count }, (_, index) => ({
      id: `l${36 + Math.floor(index / 100)}-v${String(index + 1).padStart(5, "0")}`,
      lesson: 36 + Math.floor(index / 100),
      lessonIndex: index % 100,
      order: index
    }))
  };
}

async function createDb(name){
  const db = new Database({ indexedDB, IDBKeyRange, name });
  await db.open();
  return db;
}

(async () => {
  const db = await createDb(`test-${Date.now()}`);
  const tenThousand = catalog(10000);
  assert.equal(await db.reconcileCatalog(tenThousand), true);
  assert.equal(await db.reconcileCatalog(tenThousand), false);

  let stats = await db.getStats(now, 10);
  assert.deepEqual(
    { total: stats.total, unseen: stats.unseen, newToday: stats.newToday },
    { total: 10000, unseen: 10000, newToday: 10 }
  );

  const queue = await db.buildDailyQueue(now, 10);
  assert.equal(queue.length, 10);
  assert.ok(queue.every(card => card.queueType === "new"));
  assert.deepEqual(queue.map(card => card.order), Array.from({ length: 10 }, (_, index) => index));

  const firstId = tenThousand.cards[0].id;
  const beforeRevision = await db.getRevision();
  const rated = await db.rateCard(firstId, "good", now);
  assert.equal(rated.state, "review");
  assert.equal(await db.getRevision(), beforeRevision + 1);
  assert.equal((await db.getCard(firstId)).intervalDays, 1);

  stats = await db.getStats(now, 10);
  assert.equal(stats.introducedToday, 1);
  assert.equal(stats.newToday, 9);

  for(let index = 1; index < 10; index += 1){
    await db.rateCard(tenThousand.cards[index].id, "good", now);
  }
  stats = await db.getStats(now, 10);
  assert.equal(stats.newToday, 0);
  assert.equal((await db.buildDailyQueue(now, 10)).length, 0);
  assert.equal((await db.buildDailyQueue(now, 10, 10)).length, 10);

  const nextDay = new Date("2026-06-25T10:00:00.000Z");
  assert.equal((await db.getStats(nextDay, 10)).newToday, 10);

  const changedCatalog = {
    version: "changed",
    cards: tenThousand.cards.slice(1)
  };
  await db.reconcileCatalog(changedCatalog);
  assert.equal((await db.getCard(firstId)).available, false);
  await db.reconcileCatalog({ version: "restored", cards: tenThousand.cards });
  assert.equal((await db.getCard(firstId)).available, true);
  assert.equal((await db.getCard(firstId)).intervalDays, 1);

  const legacyDb = await createDb(`legacy-${Date.now()}`);
  await legacyDb.reconcileCatalog(catalog(2, "legacy-catalog"));
  const legacyId = (await legacyDb.buildDailyQueue(now, 10))[0].id;
  const legacyRaw = JSON.stringify({
    schemaVersion: 2,
    cards: {
      [legacyId]: {
        state: "review",
        due: "2026-06-24T09:00:00.000Z",
        intervalDays: 3,
        ease: 2.5,
        repetitions: 2,
        lapses: 0,
        lastRating: "good",
        introducedAt: "2026-06-20T10:00:00.000Z",
        lastReviewedAt: "2026-06-21T10:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z"
      }
    },
    activity: { "2026-06-24": { reviewedIds: [legacyId] } }
  });
  assert.equal(await legacyDb.migrateLegacy(legacyRaw), true);
  assert.equal(await legacyDb.migrateLegacy(legacyRaw), false);
  assert.equal((await legacyDb.getCard(legacyId)).intervalDays, 3);

  db.db.close();
  legacyDb.db.close();
  console.log("IndexedDB tests passed.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
