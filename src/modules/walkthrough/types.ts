// Walkthrough — shared data model for the GM in-field inspection flow.
//
// These shapes are the contract between the offline store (Dexie), the
// fill-in components, and (later) the submit transaction + Netlify
// function. The public-facing records (Assignment / ItemResponse /
// Submission) mirror the design brief's DATA SHAPES; the local-only
// records (LocalDraft / PhotoRecord / CheckIn / OutboxItem) are what the
// device persists so a mid-walk refresh or a dead cooler signal never
// loses work.

// ---------------------------------------------------------------------------
// Answer + tier vocabulary
// ---------------------------------------------------------------------------

export type ItemValue = "pass" | "watch" | "fail" | "na" | null;
export type Tier = "green" | "yellow" | "red";
export type FollowupTrigger = "fail" | "watch";
export type ItemSeverity = "low" | "med" | "high";

// ---------------------------------------------------------------------------
// Template (comes from the admin builder — the Sections / Scoring / Rules
// the wizard produces). Versioned: a submission stamps templateVersion so
// in-flight walks finish on the version they started.
// ---------------------------------------------------------------------------

/** A conditional rule on an item. When the selected value matches `trigger`,
 *  the listed follow-ups are revealed inline and (where `require`d) gate
 *  submit. `raiseCorrectiveAction` defaults on for fails. */
export interface FollowupRule {
  trigger: FollowupTrigger;
  require: {
    /** Minimum photo count. 0 / undefined = optional. */
    photo?: number;
    reason?: boolean;
    note?: boolean;
  };
  /** Chip options for the required reason; empty → free-text only. */
  reasonOptions?: string[];
  raiseCorrectiveAction?: boolean;
}

export interface TemplateItem {
  code: string;
  label: string;
  /** Relative weight in the section score. Defaults to 1. */
  weight: number;
  severity?: ItemSeverity;
  /** Per-item override; the template's global rule can force photo-on-fail. */
  allowNa?: boolean;
  rules?: FollowupRule[];
}

export interface TemplateSection {
  code: string;
  name: string;
  items: TemplateItem[];
}

export interface ScoringMap {
  /** Fraction of item weight earned, 0–1. Defaults Pass 1 / Watch .6 / Fail 0. */
  pass: number;
  watch: number;
  fail: number;
}

export interface WalkthroughTemplate {
  id: string;
  version: string;
  name: string;
  type: "walkthrough" | "audit" | "safety";
  sections: TemplateSection[];
  scoring: ScoringMap;
  /** Lower bound of each band. green = top, anything below `yellow` is red. */
  tiers: { green: number; yellow: number };
  globalRules: {
    /** Forces a photo on every Fail regardless of per-item rule. */
    photoOnEveryFail?: boolean;
    /** Whether GMs may mark items N/A. */
    allowNa?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Assignment — the unit of work handed to a GM.
// ---------------------------------------------------------------------------

export interface WalkthroughAssignment {
  id: string;
  templateId: string;
  templateVersion: string;
  storeSdi: string;
  assigneeUserId: string;
  dueAt: string; // ISO
  status: "not_started" | "in_progress" | "submitted";
}

// ---------------------------------------------------------------------------
// GPS check-in — stamps the whole session.
// ---------------------------------------------------------------------------

export type GeofenceResult = "on_site" | "nearby" | "off_site";

export interface CheckIn {
  id: string;
  assignmentId: string;
  at: string; // ISO
  lat: number;
  lng: number;
  accuracy: number;
  geofenceResult: GeofenceResult;
  /** Present only when an off-site exception was requested + justified. */
  exceptionReason?: string;
}

// ---------------------------------------------------------------------------
// Photos — captured locally first, uploaded async. Every photo carries
// time + GPS metadata at capture (overlay metadata, never burned pixels).
// ---------------------------------------------------------------------------

export type PhotoUploadStatus = "pending" | "uploading" | "uploaded" | "error";

export interface PhotoMeta {
  /** Capture time — EXIF DateTimeOriginal when available, else wall clock. */
  at: string; // ISO
  lat: number | null;
  lng: number | null;
}

export interface PhotoRecord {
  id: string; // local uuid, stable across upload
  assignmentId: string;
  itemCode: string;
  meta: PhotoMeta;
  uploadStatus: PhotoUploadStatus;
  /** Remote URL once the presigned upload completes. */
  remoteUrl?: string;
  /** How many upload attempts have failed (drives the retry chip). */
  attempts: number;
  createdAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Responses + the local draft that the device owns.
// ---------------------------------------------------------------------------

export interface ItemResponse {
  itemCode: string;
  value: ItemValue;
  reason?: string;
  note?: string;
  photoIds: string[];
  raisedCorrectiveActionId?: string;
  /** When the GM last touched this item — for conflict reconciliation. */
  answeredAt?: string;
}

export interface SectionResponse {
  code: string;
  note?: string;
  items: ItemResponse[];
}

/** The full local working copy, persisted to Dexie and rehydrated on resume.
 *  This is read first; the server is reconciled in the background. */
export interface LocalDraft {
  assignmentId: string;
  templateId: string;
  templateVersion: string;
  storeSdi: string;
  checkInId: string | null;
  sections: SectionResponse[];
  /** Bumped on every local mutation; the basis for last-write-wins merges. */
  rev: number;
  clientUpdatedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Submission — immutable once submitted (built by submit.ts, later ticket).
// ---------------------------------------------------------------------------

export interface Submission {
  id: string;
  assignmentId: string;
  storeSdi: string;
  templateId: string;
  templateVersion: string;
  checkInId: string;
  sections: SectionResponse[];
  score: number;
  tier: Tier;
  flagCount: number;
  status: "draft" | "submitted" | "needs_revision" | "approved";
  submittedAt?: string;
}

// ---------------------------------------------------------------------------
// Corrective action — emitted on submit for each qualifying Fail. Build the
// create side here; the dashboard/verify flow is a separate ticket.
// ---------------------------------------------------------------------------

export interface CorrectiveAction {
  id: string;
  sourceSubmissionId: string;
  sourceItemCode: string;
  storeSdi: string;
  title: string;
  ownerUserId: string;
  dueAt: string;
  priority: ItemSeverity;
  originPhotoIds: string[];
  status: "open";
}

// ---------------------------------------------------------------------------
// Outbox — pending server mutations, flushed oldest-first on reconnect.
// Kept generic so draft-saves and (later) the submit call share one queue.
// ---------------------------------------------------------------------------

export type OutboxKind = "draft" | "checkin" | "submit";

export interface OutboxItem {
  id: string; // uuid
  assignmentId: string;
  kind: OutboxKind;
  payload: unknown;
  createdAt: string; // ISO
  attempts: number;
}

// ---------------------------------------------------------------------------
// Sync state machine — drives the header pill + offline banner.
//   idle    nothing pending
//   saving  a local write is being persisted (debounced)
//   saved   persisted locally, online, nothing queued
//   queued  persisted locally, offline → waiting to sync
//   syncing flushing the outbox to the server
//   synced  outbox drained, server agrees
//   error   a flush failed; will retry
// ---------------------------------------------------------------------------

export type SyncState =
  | "idle"
  | "saving"
  | "saved"
  | "queued"
  | "syncing"
  | "synced"
  | "error";
