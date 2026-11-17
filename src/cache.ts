/**
 * A copy of each score field the plugin has fetched, in its own origin's IndexedDB, keyed by scope, venue and field
 * and stamped with the statistics' `computedAt`. The list of fields (`scope.scores(scope)`, small) says each field's
 * `computedAt`; when the copy has the same stamp, the values (up to ~40k numbers at an ICLR-sized venue) are not
 * fetched again, so moving between papers at one venue costs one small call. Where IndexedDB is unavailable, a copy
 * lives in memory for the frame's life.
 */

const DB = 'score-standing';
const STORE = 'fields';
const VERSION = 1;
/** Fields kept; the oldest written go first. */
const MAX_ENTRIES = 50;

export interface Entry<T> {
  key: string;
  computedAt: string;
  value: T;
  savedAt: number;
}

export interface Store<T> {
  get(key: string): Promise<Entry<T> | undefined>;
  put(entry: Entry<T>): Promise<void>;
}

export function memoryStore<T>(): Store<T> & { entries: Map<string, Entry<T>> } {
  const entries = new Map<string, Entry<T>>();
  return {
    entries,
    async get(key) {
      return entries.get(key);
    },
    async put(entry) {
      entries.set(entry.key, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].sort((a, b) => a.savedAt - b.savedAt)[0];
        entries.delete(oldest.key);
      }
    },
  };
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function indexedDbStore<T>(): Store<T> | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const store = r.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return opened;
  };
  return {
    async get(key) {
      const db = await open();
      return request<Entry<T> | undefined>(db.transaction(STORE).objectStore(STORE).get(key));
    },
    async put(entry) {
      const db = await open();
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await request(store.put(entry));
      const total = await request(store.count());
      if (total > MAX_ENTRIES) {
        const cursor = await request(store.index('savedAt').openCursor());
        if (cursor) await request(cursor.delete());
      }
    },
  };
}

/** The store to use: IndexedDB when the frame may, memory otherwise. */
export function defaultStore<T>(): Store<T> {
  const memory = memoryStore<T>();
  const idb = indexedDbStore<T>();
  if (!idb) return memory;
  return {
    async get(key) {
      try {
        return (await memory.get(key)) ?? (await idb.get(key));
      } catch {
        return memory.get(key);
      }
    },
    async put(entry) {
      await memory.put(entry);
      try {
        await idb.put(entry);
      } catch {
        // Private browsing or storage full: memory will do.
      }
    },
  };
}

/** The value for `key` at `computedAt`, from the store when its copy has that stamp, else fetched and stored. */
export async function cached<T>(
  store: Store<T>,
  key: string,
  computedAt: string,
  fetch: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const hit = await store.get(key);
  if (hit && hit.computedAt === computedAt) return hit.value;
  const value = await fetch();
  await store.put({ key, computedAt, value, savedAt: now });
  return value;
}
