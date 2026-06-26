(function(root, factory){
  const api = factory(root.SRSCore);

  if(typeof module === "object" && module.exports){
    module.exports = api;
  }else{
    root.SrsDatabase = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function(SRSCore){
  const DB_NAME = "japanese-vocab-srs";
  const DB_VERSION = 2;
  const CARDS_STORE = "cards";
  const SETTINGS_STORE = "settings";
  const MIGRATION_KEY = "legacyLocalStorageMigrated";
  const CATALOG_VERSION_KEY = "catalogVersion";
  const ID_MIGRATION_MAP_KEY = "idMigrationMap";
  const REVISION_KEY = "revision";
  const DRIVE_METADATA_KEY = "driveMetadata";

  function requestResult(request){
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(transaction){
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    });
  }

  function cursorEach(request, callback){
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed."));
      request.onsuccess = () => {
        const cursor = request.result;
        if(!cursor){
          resolve();
          return;
        }
        callback(cursor);
        cursor.continue();
      };
    });
  }

  function createDeviceId(){
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildCatalogIdMigrationMap(catalog){
    const map = {};
    (catalog.cards || []).forEach(entry => {
      (entry.legacyIds || []).forEach(legacyId => {
        if(typeof legacyId === "string" && legacyId && legacyId !== entry.id){
          map[legacyId] = String(entry.id);
        }
      });
    });
    return map;
  }

  function cardMetadata(entry){
    return {
      lesson: Number(entry.lesson),
      level: typeof entry.level === "string" ? entry.level : "",
      lessonIndex: Number(entry.lessonIndex),
      order: Number(entry.order),
      available: true
    };
  }

  function hasCatalogMetadataChanged(card, metadata){
    return (
      card.lesson !== metadata.lesson ||
      card.level !== metadata.level ||
      card.lessonIndex !== metadata.lessonIndex ||
      card.order !== metadata.order ||
      card.available === false
    );
  }

  function remapSnapshot(snapshot, idMigrationMap = {}){
    if(!snapshot) return snapshot;
    const cards = {};
    Object.entries(snapshot.cards).forEach(([id, schedule]) => {
      const targetId = idMigrationMap[id] || id;
      cards[targetId] = SRSCore.mergeSchedules(cards[targetId], schedule);
    });
    return { ...snapshot, cards };
  }

  function mapsAreEqual(left = {}, right = {}){
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if(leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
  }

  class Database {
    constructor(options = {}){
      this.indexedDB = options.indexedDB || globalThis.indexedDB;
      this.IDBKeyRange = options.IDBKeyRange || globalThis.IDBKeyRange;
      this.name = options.name || DB_NAME;
      this.db = null;
      this.writeChain = Promise.resolve();
    }

    async open(){
      if(this.db) return this;
      if(!this.indexedDB) throw new Error("IndexedDB is not available in this browser.");

      const request = this.indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const cards = db.objectStoreNames.contains(CARDS_STORE)
          ? request.transaction.objectStore(CARDS_STORE)
          : db.createObjectStore(CARDS_STORE, { keyPath: "id" });
        [
          ["due", "due"],
          ["state", "state"],
          ["intervalDays", "intervalDays"],
          ["introducedAt", "introducedAt"],
          ["level", "level"],
          ["order", "order"],
          ["updatedAt", "updatedAt"]
        ].forEach(([name, keyPath]) => {
          if(!cards.indexNames.contains(name)) cards.createIndex(name, keyPath, { unique: false });
        });
        if(!db.objectStoreNames.contains(SETTINGS_STORE)){
          db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      };
      this.db = await requestResult(request);
      this.db.onversionchange = () => {
        this.db.close();
        this.db = null;
      };
      return this;
    }

    enqueueWrite(operation){
      const next = this.writeChain.then(operation, operation);
      this.writeChain = next.catch(() => {});
      return next;
    }

    async getSetting(key, fallback = null){
      await this.open();
      const tx = this.db.transaction(SETTINGS_STORE, "readonly");
      const done = transactionDone(tx);
      const record = await requestResult(tx.objectStore(SETTINGS_STORE).get(key));
      await done;
      return record ? record.value : fallback;
    }

    async setSetting(key, value){
      return this.enqueueWrite(async () => {
        await this.open();
        const tx = this.db.transaction(SETTINGS_STORE, "readwrite");
        const done = transactionDone(tx);
        tx.objectStore(SETTINGS_STORE).put({ key, value });
        await done;
        return value;
      });
    }

    async getRevision(){
      return Number(await this.getSetting(REVISION_KEY, 0)) || 0;
    }

    async getDriveMetadata(){
      const saved = await this.getSetting(DRIVE_METADATA_KEY, null);
      return {
        driveFileId: typeof saved?.driveFileId === "string" ? saved.driveFileId : "",
        lastSyncedAt: typeof saved?.lastSyncedAt === "string" ? saved.lastSyncedAt : "",
        deviceId: typeof saved?.deviceId === "string" ? saved.deviceId : createDeviceId(),
        dirty: saved?.dirty === true
      };
    }

    async setDriveMetadata(metadata){
      return this.setSetting(DRIVE_METADATA_KEY, metadata);
    }

    normalizeLevelFilter(options = {}){
      if(typeof options === "string") return options;
      return typeof options.newCardLevel === "string" ? options.newCardLevel : "";
    }

    async reconcileCatalog(catalog){
      const currentVersion = await this.getSetting(CATALOG_VERSION_KEY, "");
      const idMigrationMap = buildCatalogIdMigrationMap(catalog);
      const currentIdMigrationMap = await this.getSetting(ID_MIGRATION_MAP_KEY, {});
      if(currentVersion === catalog.version && mapsAreEqual(currentIdMigrationMap, idMigrationMap)) return false;

      return this.enqueueWrite(async () => {
        await this.open();
        const tx = this.db.transaction([CARDS_STORE, SETTINGS_STORE], "readwrite");
        const done = transactionDone(tx);
        const cards = tx.objectStore(CARDS_STORE);
        const settings = tx.objectStore(SETTINGS_STORE);
        const incoming = new Map(catalog.cards.map(entry => [entry.id, entry]));
        const allEntries = new Map(catalog.cards.map(entry => [entry.id, entry]));
        const existingCards = [];
        const handledIds = new Set();

        await cursorEach(cards.openCursor(), cursor => {
          existingCards.push(cursor.value);
        });
        const existingById = new Map(existingCards.map(card => [card.id, card]));

        for(const existing of existingCards){
          if(handledIds.has(existing.id)) continue;
          const entry = incoming.get(existing.id);
          if(entry){
            const metadata = cardMetadata(entry);
            if(hasCatalogMetadataChanged(existing, metadata)) cards.put({ ...existing, ...metadata });
            incoming.delete(existing.id);
            continue;
          }

          const targetId = idMigrationMap[existing.id];
          const targetEntry = targetId ? allEntries.get(targetId) : null;
          if(targetEntry){
            const targetExisting = existingById.get(targetId);
            const targetBase = targetExisting || SRSCore.createCatalogCard(targetEntry);
            const localSchedule = targetExisting?.state === "new" ? null : targetExisting;
            const legacySchedule = existing.state === "new" ? null : existing;
            const mergedSchedule = SRSCore.mergeSchedules(localSchedule, legacySchedule);
            let migrated = { ...targetBase, ...cardMetadata(targetEntry) };
            if(mergedSchedule) migrated = SRSCore.applySchedule(migrated, mergedSchedule);
            cards.put(migrated);
            cards.delete(existing.id);
            incoming.delete(targetId);
            handledIds.add(existing.id);
            handledIds.add(targetId);
          }else if(existing.available !== false){
            cards.put({ ...existing, available: false });
          }
        }

        incoming.forEach(entry => cards.put(SRSCore.createCatalogCard(entry)));
        settings.put({ key: CATALOG_VERSION_KEY, value: catalog.version });
        settings.put({ key: ID_MIGRATION_MAP_KEY, value: idMigrationMap });
        await done;
        return true;
      });
    }

    async migrateLegacy(rawValue){
      if(await this.getSetting(MIGRATION_KEY, false)) return false;
      let parsed = null;
      try{
        parsed = typeof rawValue === "string" && rawValue ? JSON.parse(rawValue) : null;
      }catch(error){
        console.warn("Could not parse legacy SRS progress.", error);
      }
      const snapshot = remapSnapshot(SRSCore.normalizeSnapshot(parsed), await this.getSetting(ID_MIGRATION_MAP_KEY, {}));

      return this.enqueueWrite(async () => {
        await this.open();
        const tx = this.db.transaction([CARDS_STORE, SETTINGS_STORE], "readwrite");
        const done = transactionDone(tx);
        const cards = tx.objectStore(CARDS_STORE);
        if(snapshot){
          for(const [id, schedule] of Object.entries(snapshot.cards)){
            const existing = await requestResult(cards.get(id));
            cards.put(SRSCore.applySchedule(existing || { id, available: false }, schedule));
          }
        }
        tx.objectStore(SETTINGS_STORE).put({ key: MIGRATION_KEY, value: true });
        await done;
        return Boolean(snapshot && Object.keys(snapshot.cards).length);
      });
    }

    async getCard(id){
      await this.open();
      const tx = this.db.transaction(CARDS_STORE, "readonly");
      const done = transactionDone(tx);
      const card = await requestResult(tx.objectStore(CARDS_STORE).get(id));
      await done;
      return card || null;
    }

    async rateCard(id, rating, now = new Date()){
      return this.enqueueWrite(async () => {
        await this.open();
        const tx = this.db.transaction([CARDS_STORE, SETTINGS_STORE], "readwrite");
        const done = transactionDone(tx);
        const cards = tx.objectStore(CARDS_STORE);
        const settings = tx.objectStore(SETTINGS_STORE);
        const existing = await requestResult(cards.get(id));
        if(!existing || existing.available === false) throw new Error(`Cannot rate unavailable card ${id}.`);
        const schedule = SRSCore.rateCard(existing.state === "new" ? null : existing, rating, now);
        const updated = { ...existing, ...schedule };
        cards.put(updated);
        const revisionRecord = await requestResult(settings.get(REVISION_KEY));
        settings.put({ key: REVISION_KEY, value: (Number(revisionRecord?.value) || 0) + 1 });
        await done;
        return updated;
      });
    }

    async getStats(now = new Date(), newLimit = 10, options = {}){
      await this.open();
      const newCardLevel = this.normalizeLevelFilter(options);
      const bounds = SRSCore.getLocalDayBounds(now);
      const tx = this.db.transaction(CARDS_STORE, "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore(CARDS_STORE);
      const stats = { total: 0, tracked: 0, due: 0, newToday: 0, introducedToday: 0, unseen: 0, learning: 0, mature: 0 };
      const timestamp = now.toISOString();

      const countCards = cursorEach(store.openCursor(), cursor => {
        const card = cursor.value;
        if(card.available === false) return;
        stats.total += 1;
        if(card.state === "new"){
          if(!newCardLevel || card.level === newCardLevel){
            stats.unseen += 1;
          }
          return;
        }
        stats.tracked += 1;
        if(card.due <= timestamp) stats.due += 1;
        if(card.state === "learning") stats.learning += 1;
        if(card.intervalDays >= SRSCore.MATURE_INTERVAL_DAYS) stats.mature += 1;
      });
      const countIntroduced = cursorEach(
        store.index("introducedAt").openCursor(this.IDBKeyRange.bound(bounds.start, bounds.end, false, true)),
        cursor => {
          if(cursor.value.available !== false) stats.introducedToday += 1;
        }
      );
      await Promise.all([countCards, countIntroduced]);
      await done;
      stats.newToday = Math.min(stats.unseen, Math.max(0, newLimit - stats.introducedToday));
      return stats;
    }

    async buildDailyQueue(now = new Date(), newLimit = 10, extraNewLimit = 0, options = {}){
      await this.open();
      const newCardLevel = this.normalizeLevelFilter(options);
      const stats = await this.getStats(now, newLimit, { newCardLevel });
      const tx = this.db.transaction(CARDS_STORE, "readonly");
      const done = transactionDone(tx);
      const store = tx.objectStore(CARDS_STORE);
      const due = [];
      const unseen = [];

      await cursorEach(store.index("due").openCursor(this.IDBKeyRange.upperBound(now.toISOString())), cursor => {
        const card = cursor.value;
        if(card.available !== false && card.state !== "new") due.push({ ...card, queueType: "due" });
      });
      await cursorEach(store.index("order").openCursor(), cursor => {
        const card = cursor.value;
        if(
          card.available !== false &&
          card.state === "new" &&
          (!newCardLevel || card.level === newCardLevel)
        ){
          unseen.push({ ...card, queueType: "new" });
        }
      });
      await done;

      const availableNew = stats.newToday + Math.max(0, extraNewLimit);
      return [...due, ...unseen.slice(0, availableNew)];
    }

    async exportSnapshot(deviceId = ""){
      await this.open();
      const tx = this.db.transaction(CARDS_STORE, "readonly");
      const done = transactionDone(tx);
      const cards = {};
      await cursorEach(tx.objectStore(CARDS_STORE).openCursor(), cursor => {
        const card = cursor.value;
        if(card.state === "new") return;
        const schedule = SRSCore.normalizeScheduledCard(card);
        if(schedule) cards[card.id] = schedule;
      });
      await done;
      return {
        schemaVersion: SRSCore.SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        deviceId,
        cards
      };
    }

    async mergeSnapshot(value){
      const normalizedSnapshot = SRSCore.normalizeSnapshot(value);
      if(!normalizedSnapshot) throw new Error("The Google Drive progress file is invalid or uses an unsupported version.");
      if(Object.keys(normalizedSnapshot.cards).length !== Object.keys(value.cards).length){
        throw new Error("The Google Drive progress file contains invalid card records.");
      }
      const snapshot = remapSnapshot(normalizedSnapshot, await this.getSetting(ID_MIGRATION_MAP_KEY, {}));

      return this.enqueueWrite(async () => {
        await this.open();
        const tx = this.db.transaction([CARDS_STORE, SETTINGS_STORE], "readwrite");
        const done = transactionDone(tx);
        const cards = tx.objectStore(CARDS_STORE);
        let changed = false;
        for(const [id, cloudSchedule] of Object.entries(snapshot.cards)){
          const existing = await requestResult(cards.get(id));
          const localSchedule = existing?.state === "new" ? null : existing;
          const merged = SRSCore.mergeSchedules(localSchedule, cloudSchedule);
          if(!localSchedule || merged.updatedAt !== localSchedule.updatedAt){
            cards.put(SRSCore.applySchedule(existing || { id, available: false }, merged));
            changed = true;
          }
        }
        if(changed){
          const settings = tx.objectStore(SETTINGS_STORE);
          const revisionRecord = await requestResult(settings.get(REVISION_KEY));
          settings.put({ key: REVISION_KEY, value: (Number(revisionRecord?.value) || 0) + 1 });
        }
        await done;
        return changed;
      });
    }
  }

  return {
    DB_NAME,
    DB_VERSION,
    Database
  };
});
