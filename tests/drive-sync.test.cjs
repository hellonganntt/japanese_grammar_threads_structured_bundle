const assert = require("node:assert/strict");
const { indexedDB, IDBKeyRange } = require("fake-indexeddb");

global.SRSCore = require("../assets/srs.js");
const { Database } = require("../assets/srs-db.js");

(async () => {
  const db = new Database({ indexedDB, IDBKeyRange, name: `drive-${Date.now()}` });
  await db.open();
  await db.reconcileCatalog({
    version: "drive-test",
    cards: [{
      id: "n4-l36-v001",
      legacyIds: ["l36-v001"],
      lesson: 36,
      level: "N4",
      lessonIndex: 0,
      order: 0
    }]
  });
  await db.rateCard("n4-l36-v001", "good", new Date("2026-06-24T10:00:00.000Z"));

  const exported = await db.exportSnapshot("device-a");
  assert.equal(exported.schemaVersion, 3);
  assert.equal(exported.deviceId, "device-a");
  assert.deepEqual(Object.keys(exported.cards), ["n4-l36-v001"]);
  assert.equal("activity" in exported, false);

  const cloudLegacy = {
    schemaVersion: 1,
    cards: {
      "l36-v001": {
        ...exported.cards["n4-l36-v001"],
        intervalDays: 20,
        updatedAt: "2026-06-25T10:00:00.000Z"
      }
    }
  };
  assert.equal(await db.mergeSnapshot(cloudLegacy), true);
  assert.equal((await db.getCard("n4-l36-v001")).intervalDays, 20);
  assert.equal(await db.getCard("l36-v001"), null);
  assert.deepEqual(Object.keys((await db.exportSnapshot("device-a")).cards), ["n4-l36-v001"]);

  const cloudWithDuplicateIds = {
    schemaVersion: 3,
    cards: {
      "l36-v001": {
        ...exported.cards["n4-l36-v001"],
        intervalDays: 7,
        updatedAt: "2026-06-24T12:00:00.000Z"
      },
      "n4-l36-v001": {
        ...exported.cards["n4-l36-v001"],
        intervalDays: 30,
        updatedAt: "2026-06-25T12:00:00.000Z"
      }
    }
  };
  assert.equal(await db.mergeSnapshot(cloudWithDuplicateIds), true);
  assert.equal((await db.getCard("n4-l36-v001")).intervalDays, 30);

  await assert.rejects(
    db.mergeSnapshot({ schemaVersion: 3, cards: { broken: { due: "invalid" } } }),
    /invalid card records/
  );
  await assert.rejects(
    db.mergeSnapshot({ schemaVersion: 99, cards: {} }),
    /invalid or uses an unsupported version/
  );

  const uploadRevision = await db.getRevision();
  await db.rateCard("n4-l36-v001", "hard", new Date("2026-06-26T10:00:00.000Z"));
  assert.notEqual(await db.getRevision(), uploadRevision);

  db.db.close();
  console.log("Drive snapshot tests passed.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
