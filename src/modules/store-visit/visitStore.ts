// Offline persistence for Store Visit — IndexedDB. Two stores:
//   queue — pending walk-save ops (deduped per visit:item), replayed on
//           reconnect so a spotty-wifi walk never loses data.
//   kv    — the in-progress visit snapshot, so a mid-visit reload (or an
//           app kill on bad signal) restores the walk instead of dropping it.
const DB = "store-visit";
const VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs"); // key -> Blob (photos captured offline)
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result: unknown;
    const req = fn(os);
    if (req) req.onsuccess = () => { result = (req as IDBRequest).result; };
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  })).catch(() => undefined as unknown as T); // IDB unavailable (private mode) → no-op
}

export interface QueuedOp { id?: number; target: string; payload: unknown }

// Enqueue, replacing any prior op for the same target (latest state wins).
export async function enqueue(op: { target: string; payload: unknown }): Promise<void> {
  const all = await listQueue();
  const dupes = all.filter((o) => o.target === op.target && o.id != null).map((o) => o.id!) as number[];
  await run("queue", "readwrite", (s) => { for (const id of dupes) s.delete(id); s.add({ target: op.target, payload: op.payload }); });
}

export function listQueue(): Promise<QueuedOp[]> {
  return run<QueuedOp[]>("queue", "readonly", (s) => s.getAll()).then((r) => r ?? []);
}
export function removeQueued(id: number): Promise<void> {
  return run("queue", "readwrite", (s) => s.delete(id));
}
export function clearQueueFor(visitId: string): Promise<void> {
  return listQueue().then((all) => run("queue", "readwrite", (s) => {
    for (const o of all) if (o.id != null && String(o.target).startsWith(`${visitId}:`)) s.delete(o.id);
  }));
}

// Photo blobs captured offline — uploaded on reconnect, then deleted.
export function putBlob(key: string, blob: Blob): Promise<void> { return run("blobs", "readwrite", (s) => s.put(blob, key)); }
export function getBlob(key: string): Promise<Blob | null> { return run<Blob>("blobs", "readonly", (s) => s.get(key)).then((r) => (r ?? null) as Blob | null); }
export function delBlob(key: string): Promise<void> { return run("blobs", "readwrite", (s) => s.delete(key)); }

// In-progress visit snapshot (restore on reload).
const ACTIVE = "active-visit";
export function saveActive(v: unknown): Promise<void> { return run("kv", "readwrite", (s) => s.put(v, ACTIVE)); }
export function loadActive<T>(): Promise<T | null> { return run<T>("kv", "readonly", (s) => s.get(ACTIVE)).then((r) => (r ?? null) as T | null); }
export function clearActive(): Promise<void> { return run("kv", "readwrite", (s) => s.delete(ACTIVE)); }
