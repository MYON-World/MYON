// MYON shared index, v1. This file manages only cross-world routing metadata.
// The existing v0.13 world, funds, vehicles, missions and profiles retain their original keys.
// No legacy migration, financial transfer or world switch takes place on initialization.
export const MYON_INDEX_KEY = 'myon-index-v1';
export const LEGACY_WORLD_ID = 'legacy';

const DB_NAME = 'myon-v00804-progress';
const STORE_NAME = 'game';
const SCHEMA = 1;
const WORLD_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export function validMyonIndex(value) {
  return Boolean(
    value && value.schema === SCHEMA &&
    typeof value.activeWorld === 'string' &&
    WORLD_ID_PATTERN.test(value.activeWorld)
  );
}

function openGameDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('MYON index: IndexedDB unavailable'));
      return;
    }
    // Keep the original database name, version and store: no existing save migration.
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('MYON index: database open failed'));
  });
}

function transact(db, mode, perform) {
  return new Promise((resolve, reject) => {
    let result;
    let issue = null;
    const transaction = db.transaction(STORE_NAME, mode);
    transaction.oncomplete = () => {
      db.close();
      if (issue) reject(issue);
      else resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('MYON index: transaction failed'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('MYON index: transaction aborted'));
    };
    try {
      perform(transaction.objectStore(STORE_NAME),
        value => { result = value; },
        error => { issue = error; });
    } catch (error) {
      issue = error;
      transaction.abort();
    }
  });
}

// First entry into MYON: set only a routing pointer to the untouched legacy world.
// Existing valid data are returned verbatim. Unknown schema are never overwritten.
export async function initializeMyonIndex() {
  const db = await openGameDb();
  return transact(db, 'readwrite', (store, resolve, fail) => {
    const request = store.get(MYON_INDEX_KEY);
    request.onsuccess = () => {
      if (request.result === undefined) {
        const initial = { schema: SCHEMA, activeWorld: LEGACY_WORLD_ID };
        store.add(initial, MYON_INDEX_KEY);
        resolve(initial);
      } else if (validMyonIndex(request.result)) {
        resolve(request.result);
      } else {
        fail(new Error('MYON index: unsupported existing index record'));
      }
    };
  });
}

// Used by a future world-selector commit; changing this key alone never performs a migration.
export async function saveMyonIndex(next) {
  if (!validMyonIndex(next)) throw new Error('MYON index: invalid record');
  const db = await openGameDb();
  return transact(db, 'readwrite', (store, resolve) => {
    store.put({ schema: SCHEMA, activeWorld: next.activeWorld }, MYON_INDEX_KEY);
    resolve({ schema: SCHEMA, activeWorld: next.activeWorld });
  });
}
