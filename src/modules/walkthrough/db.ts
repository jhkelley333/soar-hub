// Walkthrough — local-first persistence layer (Dexie / IndexedDB).
//
// Why IndexedDB and not the localStorage pattern used by reno-scoping:
// this flow stores photo *blobs* offline (walk-in coolers kill signal mid
// capture), which localStorage can't hold and would blow its ~5MB cap.
// Dexie gives us a typed schema, blob storage, and an ordered outbox for
// the sync queue.
//
// Tables:
//   drafts   — one LocalDraft per assignment (the working copy)
//   photos   — PhotoRecord metadata, keyed by local id
//   blobs    — the raw image bytes, split from `photos` so metadata reads
//              stay cheap and the blob is only pulled when uploading/showing
//   checkins — CheckIn records (GPS stamp for the session)
//   outbox   — pending server mutations, flushed oldest-first by createdAt

import Dexie, { type Table } from "dexie";
import type {
  CheckIn,
  LocalDraft,
  OutboxItem,
  PhotoRecord,
} from "./types";

export interface BlobRecord {
  /** Same id as the owning PhotoRecord. */
  id: string;
  blob: Blob;
}

export class WalkthroughDB extends Dexie {
  drafts!: Table<LocalDraft, string>;
  photos!: Table<PhotoRecord, string>;
  blobs!: Table<BlobRecord, string>;
  checkins!: Table<CheckIn, string>;
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super("soar-walkthrough");
    this.version(1).stores({
      // Primary keys first; remaining entries are secondary indexes.
      drafts: "assignmentId, storeSdi, clientUpdatedAt",
      photos: "id, assignmentId, itemCode, uploadStatus",
      blobs: "id",
      checkins: "id, assignmentId",
      outbox: "id, assignmentId, createdAt, kind",
    });
  }
}

// Singleton — one connection per tab. Guard against HMR re-instantiating it
// in dev (Vite re-evaluates the module, which would open a second connection).
const g = globalThis as unknown as { __soarWalkthroughDB?: WalkthroughDB };
export const db: WalkthroughDB = g.__soarWalkthroughDB ?? new WalkthroughDB();
if (import.meta.env.DEV) g.__soarWalkthroughDB = db;
