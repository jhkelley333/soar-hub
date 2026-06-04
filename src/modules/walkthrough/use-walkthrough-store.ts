// Walkthrough — offline-first store + sync state machine.
//
// The single source of truth for a GM's in-progress walk. Every mutation
// writes to IndexedDB (Dexie) FIRST, debounced 400ms, then — when a server
// adapter is supplied and the device is online — flushes through an ordered
// outbox. The hook drives the header StatusPill and the offline banner via
// `syncState`, and rehydrates instantly from local storage on resume (GMs
// close the app mid-walk constantly).
//
// State machine (see SyncState in ./types):
//   idle → saving → saved          (online, no server adapter / nothing to push)
//   idle → saving → queued         (offline: persisted locally, awaiting sync)
//   queued → syncing → synced      (reconnect: outbox drained, server agrees)
//   syncing → error → queued       (flush failed: backs off, will retry)
//
// Submit is intentionally NOT wired here — `adapter.flushDraft` / `uploadPhoto`
// are the seams the submit ticket plugs into. Without an adapter the store is
// fully usable offline and never falsely claims "synced".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, type BlobRecord } from "./db";
import { readPhotoTakenAt } from "../reno-scoping/exif";
import { scoreDraft, sectionProgress, type ScoreResult } from "./scoring";
import { effectiveRule, requirementStatus } from "./rules";
import type {
  CheckIn,
  ItemResponse,
  ItemValue,
  LocalDraft,
  OutboxItem,
  PhotoMeta,
  PhotoRecord,
  SyncState,
  WalkthroughAssignment,
  WalkthroughTemplate,
} from "./types";

const DEBOUNCE_MS = 400;
const MAX_UPLOAD_ATTEMPTS = 6;

export interface WalkthroughAdapter {
  /** Push the whole draft to the server. Resolve on success, throw to retry. */
  flushDraft?: (draft: LocalDraft) => Promise<void>;
  /** Upload one photo's bytes; resolve with the remote URL. */
  uploadPhoto?: (record: PhotoRecord, blob: Blob) => Promise<string>;
}

export interface SectionStatus {
  code: string;
  name: string;
  answered: number;
  total: number;
  pct: number;
  /** Required follow-ups missing on at least one item (e.g. Fail w/o photo). */
  incomplete: boolean;
  /** Required item still unanswered (null on a non-N/A item). */
  hasUnanswered: boolean;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Build an empty draft from the template — every item present, value null. */
function seedDraft(
  template: WalkthroughTemplate,
  assignment: WalkthroughAssignment,
): LocalDraft {
  return {
    assignmentId: assignment.id,
    templateId: template.id,
    templateVersion: template.version,
    storeSdi: assignment.storeSdi,
    checkInId: null,
    rev: 0,
    clientUpdatedAt: new Date().toISOString(),
    sections: template.sections.map((s) => ({
      code: s.code,
      note: "",
      items: s.items.map<ItemResponse>((it) => ({
        itemCode: it.code,
        value: null,
        photoIds: [],
      })),
    })),
  };
}

/** Current GPS, best-effort. Never throws — a photo without a fix still
 *  saves, it just carries null coords. */
function currentPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  });
}

export function useWalkthroughStore(
  template: WalkthroughTemplate,
  assignment: WalkthroughAssignment,
  adapter: WalkthroughAdapter = {},
) {
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<LocalDraft | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [checkIn, setCheckInState] = useState<CheckIn | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const saveTimer = useRef<number | null>(null);
  const draftRef = useRef<LocalDraft | null>(null);
  draftRef.current = draft;
  const flushing = useRef(false);
  // Keep the latest adapter without retriggering effects on every render.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  // --- Object-URL bookkeeping for local blobs -----------------------------
  const urlsRef = useRef<Record<string, string>>({});
  const trackUrl = useCallback((id: string, url: string) => {
    urlsRef.current[id] = url;
    setPhotoUrls((m) => ({ ...m, [id]: url }));
  }, []);

  // --- Initial load (rehydrate instantly from Dexie) ----------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const existing = await db.drafts.get(assignment.id);
      const base = existing ?? seedDraft(template, assignment);
      const [phs, ci] = await Promise.all([
        db.photos.where("assignmentId").equals(assignment.id).toArray(),
        db.checkins.where("assignmentId").equals(assignment.id).first(),
      ]);
      if (!alive) return;
      if (!existing) await db.drafts.put(base);
      setDraft(base);
      setPhotos(phs);
      setCheckInState(ci ?? null);

      // Hydrate object URLs for any locally-held blobs.
      for (const p of phs) {
        if (p.remoteUrl) {
          trackUrl(p.id, p.remoteUrl);
          continue;
        }
        const rec = await db.blobs.get(p.id);
        if (rec?.blob && alive) trackUrl(p.id, URL.createObjectURL(rec.blob));
      }
      setReady(true);
      setSyncState(navigator.onLine ? "saved" : "queued");
    })();
    return () => {
      alive = false;
    };
    // Seed once per assignment; template identity is stable per assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  // Revoke object URLs on unmount.
  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  // --- Online / offline wiring --------------------------------------------
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flushOutbox();
    };
    const goOffline = () => {
      setOnline(false);
      setSyncState("queued");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Persistence + flush -------------------------------------------------

  const persist = useCallback((next: LocalDraft) => {
    draftRef.current = next;
    setDraft(next);
    setSyncState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await db.drafts.put(next);
      if (!navigator.onLine) {
        setSyncState("queued");
        return;
      }
      setSavedAt(formatHM(new Date()));
      if (adapterRef.current.flushDraft) {
        await enqueue({
          id: uid(),
          assignmentId: next.assignmentId,
          kind: "draft",
          payload: next,
          createdAt: new Date().toISOString(),
          attempts: 0,
        });
        void flushOutbox();
      } else {
        // No server adapter yet (pre-submit-ticket): locally durable only.
        setSyncState("saved");
      }
    }, DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enqueue = useCallback(async (item: OutboxItem) => {
    // Collapse consecutive draft-saves: only the freshest draft matters.
    if (item.kind === "draft") {
      const stale = await db.outbox
        .where("assignmentId")
        .equals(item.assignmentId)
        .filter((o) => o.kind === "draft")
        .toArray();
      if (stale.length) await db.outbox.bulkDelete(stale.map((s) => s.id));
    }
    await db.outbox.put(item);
  }, []);

  const flushOutbox = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const adp = adapterRef.current;
    if (!adp.flushDraft && !adp.uploadPhoto) return;
    flushing.current = true;
    try {
      setSyncState("syncing");
      const items = await db.outbox.orderBy("createdAt").toArray();
      for (const item of items) {
        try {
          if (item.kind === "draft" && adp.flushDraft) {
            await adp.flushDraft(item.payload as LocalDraft);
          }
          await db.outbox.delete(item.id);
        } catch {
          await db.outbox.update(item.id, { attempts: item.attempts + 1 });
          setSyncState("error");
          flushing.current = false;
          return; // stop at first failure; reconnect/next save retries
        }
      }
      await uploadPendingPhotos();
      setSyncState("synced");
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Photo upload (background, non-blocking) -----------------------------
  const uploadPendingPhotos = useCallback(async () => {
    const adp = adapterRef.current;
    if (!adp.uploadPhoto || !navigator.onLine) return;
    const pending = await db.photos
      .where("assignmentId")
      .equals(assignment.id)
      .filter((p) => p.uploadStatus !== "uploaded" && p.attempts < MAX_UPLOAD_ATTEMPTS)
      .toArray();
    for (const rec of pending) {
      const blob = (await db.blobs.get(rec.id))?.blob;
      if (!blob) continue;
      await db.photos.update(rec.id, { uploadStatus: "uploading" });
      patchPhoto(rec.id, { uploadStatus: "uploading" });
      try {
        const remoteUrl = await adp.uploadPhoto(rec, blob);
        await db.photos.update(rec.id, { uploadStatus: "uploaded", remoteUrl });
        patchPhoto(rec.id, { uploadStatus: "uploaded", remoteUrl });
      } catch {
        await db.photos.update(rec.id, { uploadStatus: "error", attempts: rec.attempts + 1 });
        patchPhoto(rec.id, { uploadStatus: "error", attempts: rec.attempts + 1 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  const patchPhoto = useCallback((id: string, patch: Partial<PhotoRecord>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // --- Mutations -----------------------------------------------------------

  const mutateItem = useCallback(
    (sectionCode: string, itemCode: string, patch: Partial<ItemResponse>) => {
      const cur = draftRef.current;
      if (!cur) return;
      const next: LocalDraft = {
        ...cur,
        rev: cur.rev + 1,
        clientUpdatedAt: new Date().toISOString(),
        sections: cur.sections.map((s) =>
          s.code !== sectionCode
            ? s
            : {
                ...s,
                items: s.items.map((it) =>
                  it.itemCode !== itemCode
                    ? it
                    : { ...it, ...patch, answeredAt: new Date().toISOString() },
                ),
              },
        ),
      };
      persist(next);
    },
    [persist],
  );

  const setItemValue = useCallback(
    (sectionCode: string, itemCode: string, value: ItemValue) => {
      // Collapsing a triggered follow-up (e.g. Fail→Pass) clears its reason
      // so a stale fail-reason never rides along on a passing item.
      const tmplItem = template.sections
        .find((s) => s.code === sectionCode)
        ?.items.find((i) => i.code === itemCode);
      const stillTriggers =
        tmplItem && effectiveRule(tmplItem, value, template.globalRules);
      mutateItem(sectionCode, itemCode, {
        value,
        ...(stillTriggers ? {} : { reason: undefined }),
      });
    },
    [mutateItem, template],
  );

  const setItemReason = useCallback(
    (s: string, i: string, reason: string) => mutateItem(s, i, { reason }),
    [mutateItem],
  );
  const setItemNote = useCallback(
    (s: string, i: string, note: string) => mutateItem(s, i, { note }),
    [mutateItem],
  );

  const setSectionNote = useCallback(
    (sectionCode: string, note: string) => {
      const cur = draftRef.current;
      if (!cur) return;
      persist({
        ...cur,
        rev: cur.rev + 1,
        clientUpdatedAt: new Date().toISOString(),
        sections: cur.sections.map((s) =>
          s.code === sectionCode ? { ...s, note } : s,
        ),
      });
    },
    [persist],
  );

  const setCheckIn = useCallback(
    async (ci: CheckIn) => {
      await db.checkins.put(ci);
      setCheckInState(ci);
      const cur = draftRef.current;
      if (cur) persist({ ...cur, checkInId: ci.id });
    },
    [persist],
  );

  // --- Photos --------------------------------------------------------------

  const addPhoto = useCallback(
    async (sectionCode: string, itemCode: string, file: Blob): Promise<PhotoRecord> => {
      const id = uid();
      const [takenAt, pos] = await Promise.all([
        readPhotoTakenAt(file),
        currentPosition(),
      ]);
      const meta: PhotoMeta = {
        at: takenAt ?? new Date().toISOString(),
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
      };
      const record: PhotoRecord = {
        id,
        assignmentId: assignment.id,
        itemCode,
        meta,
        uploadStatus: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      const blobRec: BlobRecord = { id, blob: file };
      await db.transaction("rw", db.photos, db.blobs, async () => {
        await db.photos.put(record);
        await db.blobs.put(blobRec);
      });
      trackUrl(id, URL.createObjectURL(file));
      setPhotos((prev) => [...prev, record]);
      // Attach to the response.
      const cur = draftRef.current;
      const existing =
        cur?.sections
          .find((s) => s.code === sectionCode)
          ?.items.find((i) => i.itemCode === itemCode)?.photoIds ?? [];
      mutateItem(sectionCode, itemCode, { photoIds: [...existing, id] });
      void uploadPendingPhotos();
      return record;
    },
    [assignment.id, mutateItem, trackUrl, uploadPendingPhotos],
  );

  const removePhoto = useCallback(
    async (sectionCode: string, itemCode: string, photoId: string) => {
      await db.transaction("rw", db.photos, db.blobs, async () => {
        await db.photos.delete(photoId);
        await db.blobs.delete(photoId);
      });
      const url = urlsRef.current[photoId];
      if (url) {
        URL.revokeObjectURL(url);
        delete urlsRef.current[photoId];
        setPhotoUrls((m) => {
          const { [photoId]: _drop, ...rest } = m;
          return rest;
        });
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      const cur = draftRef.current;
      const existing =
        cur?.sections
          .find((s) => s.code === sectionCode)
          ?.items.find((i) => i.itemCode === itemCode)?.photoIds ?? [];
      mutateItem(sectionCode, itemCode, {
        photoIds: existing.filter((p) => p !== photoId),
      });
    },
    [mutateItem],
  );

  const retryPhoto = useCallback(
    async (photoId: string) => {
      await db.photos.update(photoId, { uploadStatus: "pending", attempts: 0 });
      patchPhoto(photoId, { uploadStatus: "pending", attempts: 0 });
      void uploadPendingPhotos();
    },
    [patchPhoto, uploadPendingPhotos],
  );

  // --- Derived -------------------------------------------------------------

  const score: ScoreResult | null = useMemo(
    () => (draft ? scoreDraft(draft, template) : null),
    [draft, template],
  );

  const sectionStatuses: SectionStatus[] = useMemo(() => {
    if (!draft) return [];
    return draft.sections.map((section) => {
      const tmpl = template.sections.find((s) => s.code === section.code);
      const prog = sectionProgress(section);
      let incomplete = false;
      let hasUnanswered = false;
      for (const resp of section.items) {
        const item = tmpl?.items.find((i) => i.code === resp.itemCode);
        if (!item) continue;
        const canNa = template.globalRules.allowNa && item.allowNa !== false;
        if (resp.value == null && !canNa) hasUnanswered = true;
        const rule = effectiveRule(item, resp.value, template.globalRules);
        if (rule && !requirementStatus(rule, resp).satisfied) incomplete = true;
      }
      return {
        code: section.code,
        name: tmpl?.name ?? section.code,
        ...prog,
        incomplete,
        hasUnanswered,
      };
    });
  }, [draft, template]);

  const flushNow = useCallback(() => flushOutbox(), [flushOutbox]);

  return {
    ready,
    draft,
    photos,
    checkIn,
    syncState,
    savedAt,
    online,
    photoUrls,
    activeSectionIndex,
    setActiveSectionIndex,
    score,
    sectionStatuses,
    setItemValue,
    setItemReason,
    setItemNote,
    setSectionNote,
    setCheckIn,
    addPhoto,
    removePhoto,
    retryPhoto,
    flushNow,
  };
}

export type WalkthroughStore = ReturnType<typeof useWalkthroughStore>;

function formatHM(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m}`;
}
