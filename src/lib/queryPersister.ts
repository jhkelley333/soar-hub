import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

// Local-first chat (and everything else): the React Query cache is mirrored
// into IndexedDB so a cold app open paints from the last known data
// immediately, then revalidates in the background — instead of blocking on a
// network round-trip and showing an empty list first.
//
// Bump CACHE_BUSTER whenever a persisted query's *shape* changes in a way the
// new code can't read (renamed fields, restructured responses). A mismatch
// throws the whole persisted cache away on next load rather than hydrating
// stale-shaped data into new components.
const CACHE_BUSTER = "soar-rq-v1";

// One key/value row in one IndexedDB store — enough for the single serialized
// cache blob the persister writes. Avoids an extra dependency (idb-keyval) for
// what is effectively one get/set/delete. All ops fail soft: persistence is a
// performance nicety, never a correctness dependency.
const DB_NAME = "soar-query-cache";
const STORE = "kv";

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    };
  });
}

const idbStorage = {
  getItem: (key: string) =>
    withStore<string | undefined>("readonly", (s) => s.get(key))
      .then((v) => v ?? null)
      .catch(() => null),
  setItem: (key: string, value: string) =>
    withStore("readwrite", (s) => s.put(value, key))
      .then(() => undefined)
      .catch(() => undefined),
  removeItem: (key: string) =>
    withStore("readwrite", (s) => s.delete(key))
      .then(() => undefined)
      .catch(() => undefined),
};

export const queryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: "soar-rq-cache",
  // Coalesce rapid cache writes so a burst of query updates doesn't thrash
  // IndexedDB.
  throttleTime: 1000,
});

export const persistOptions = {
  persister: queryPersister,
  // Drop anything older than a day on restore — beyond that, revalidate fresh.
  maxAge: 1000 * 60 * 60 * 24,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    // Only persist settled, successful queries. Never persist in-flight /
    // errored queries or mutations (replaying a paused mutation on next boot
    // would be surprising and unsafe).
    shouldDehydrateQuery: (query: { state: { status: string } }) =>
      query.state.status === "success",
    shouldDehydrateMutation: () => false,
  },
} as const;

// Wipe the on-disk cache. Call on sign-out so a shared device never hydrates
// the previous user's data on the next login.
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await queryPersister.removeClient();
  } catch {
    /* ignore — cache clear is best-effort */
  }
}
