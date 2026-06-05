// Walkthrough — client API. Reads/writes that need the service role (submit,
// draft upsert, dev-seed) go through netlify/functions/walkthrough; photo
// bytes go straight to Supabase Storage (RLS lets the assignee write under
// <assignment_id>/). Also builds the WalkthroughAdapter the offline store
// flushes through.

import { supabase } from "@/lib/supabase";
import type { WalkthroughAdapter } from "./use-walkthrough-store";
import type {
  LocalDraft,
  PhotoRecord,
  WalkthroughAssignment,
  WalkthroughTemplate,
} from "./types";
import type { CheckInStore } from "./CheckIn";

const FN = "/.netlify/functions/walkthrough";
export const PHOTO_BUCKET = "walkthrough-photos";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ---- DB row shapes (snake) we map to the app's camelCase types -------------

interface TemplateRow {
  id: string;
  name: string;
  type: WalkthroughTemplate["type"];
  version: string;
  sections: WalkthroughTemplate["sections"];
  scoring: WalkthroughTemplate["scoring"];
  tiers: WalkthroughTemplate["tiers"];
  global_rules: WalkthroughTemplate["globalRules"];
}

interface StoreRow {
  id: string;
  number: string;
  name: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number | null;
}

interface AssignmentRow {
  id: string;
  template_id: string;
  template_version: string;
  store_id: string | null;
  assignee_id: string;
  due_at: string | null;
  status: WalkthroughAssignment["status"];
  template: TemplateRow;
  store: StoreRow;
  revision_notes?: string | null;
}

export interface LoadedAssignment {
  assignment: WalkthroughAssignment;
  template: WalkthroughTemplate;
  store: CheckInStore;
  /** True when the assignment has no store yet — the assignee picks one
   *  before running (leadership / self-pick walks). */
  needsStore: boolean;
  /** Set when the walk was returned for revision — the DO's notes. */
  revisionNotes: string | null;
}

function mapTemplate(row: TemplateRow): WalkthroughTemplate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    version: row.version,
    sections: row.sections ?? [],
    scoring: row.scoring,
    tiers: row.tiers,
    globalRules: row.global_rules ?? {},
  };
}

function mapAssignment(row: AssignmentRow): LoadedAssignment {
  return {
    assignment: {
      id: row.id,
      templateId: row.template_id,
      templateVersion: row.template_version,
      storeSdi: row.store?.number ?? "",
      assigneeUserId: row.assignee_id,
      dueAt: row.due_at ?? "",
      status: row.status,
    },
    template: mapTemplate(row.template),
    store: {
      sdi: row.store?.number ?? "",
      name: row.store?.name ?? [row.store?.city, row.store?.state].filter(Boolean).join(", "),
      lat: row.store?.latitude ?? null,
      lng: row.store?.longitude ?? null,
      radiusM: row.store?.geofence_radius_m ?? undefined,
    },
    needsStore: !row.store_id,
    revisionNotes: row.revision_notes ?? null,
  };
}

// Stores the assignee can pick from when running a store-less walk — their
// own scoped org tree, flattened. Reused for the My Walks store picker.
export interface PickStore {
  id: string;
  number: string;
  name: string;
}

export async function fetchMyPickStores(): Promise<PickStore[]> {
  const { fetchMyTree } = await import("@/modules/my-stores/api");
  const tree = await fetchMyTree();
  const out: PickStore[] = [];
  for (const r of tree.regions ?? []) {
    for (const a of r.areas ?? []) {
      for (const d of a.districts ?? []) {
        for (const s of d.stores ?? []) {
          out.push({ id: s.id, number: s.number, name: s.name ?? "" });
        }
      }
    }
  }
  return out.sort((a, b) => a.number.localeCompare(b.number));
}

// Stamp the chosen store onto a store-less assignment. Allowed by the
// walkthrough_assignments_update_assignee RLS policy (assignee_id = uid).
export async function setAssignmentStore(assignmentId: string, storeId: string): Promise<void> {
  const { error } = await supabase
    .from("walkthrough_assignments")
    .update({ store_id: storeId })
    .eq("id", assignmentId);
  if (error) throw error;
}

// ---- public / self-serve walks ---------------------------------------------

export interface AvailableWalk {
  /** "assignment" = a posted open walk; "template" = a standing self-serve template. */
  kind: "assignment" | "template";
  id: string;
  templateName: string;
  templateVersion: string;
  storeNumber: string | null;
  storeName: string | null;
  dueAt: string | null;
  /** True when the public walk has no store — the picker chooses one. */
  needsStore: boolean;
}

/** Public walks in the caller's scope they can pick up (server-scoped). */
export async function fetchAvailableWalks(): Promise<AvailableWalk[]> {
  const { walks } = await request<{ walks: AvailableWalk[] }>(
    `${FN}?action=available-walks`,
  );
  return walks ?? [];
}

/** Claim a public walk → server creates a personal assignment; returns its id. */
export async function claimPublicWalk(
  walk: Pick<AvailableWalk, "kind" | "id">,
  storeId: string | null,
): Promise<string> {
  const body = walk.kind === "template"
    ? { templateId: walk.id, storeId }
    : { assignmentId: walk.id, storeId };
  const { id } = await request<{ id: string }>(`${FN}?action=claim-public`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return id;
}

// ---- reads -----------------------------------------------------------------

export async function fetchMyAssignments(): Promise<LoadedAssignment[]> {
  const { assignments } = await request<{ assignments: AssignmentRow[] }>(
    `${FN}?action=my-assignments`,
  );
  return (assignments ?? []).map(mapAssignment);
}

export async function fetchAssignment(id: string): Promise<LoadedAssignment | null> {
  const all = await fetchMyAssignments();
  return all.find((a) => a.assignment.id === id) ?? null;
}

export interface MySubmissionRow {
  id: string;
  templateVersion: string;
  score: number;
  tier: "green" | "yellow" | "red";
  flagCount: number;
  status: "submitted" | "needs_revision" | "approved" | "draft";
  submittedAt: string | null;
}

/** The caller's own recent submissions (for the GM "my walks" landing). */
export async function fetchMyRecentSubmissions(): Promise<MySubmissionRow[]> {
  const { submissions } = await request<{ submissions: Record<string, unknown>[] }>(
    `${FN}?action=list`,
  );
  return (submissions ?? []).map((s) => ({
    id: s.id as string,
    templateVersion: s.template_version as string,
    score: s.score as number,
    tier: s.tier as MySubmissionRow["tier"],
    flagCount: s.flag_count as number,
    status: s.status as MySubmissionRow["status"],
    submittedAt: (s.submitted_at as string) ?? null,
  }));
}

// ---- writes ----------------------------------------------------------------

export async function saveDraft(payload: {
  assignmentId: string;
  sections: LocalDraft["sections"];
  checkInId: string | null;
}): Promise<{ id: string }> {
  return request(`${FN}?action=save-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface SubmitResult {
  submission: { id: string; score: number; tier: string };
  correctiveActions: number;
  notified: boolean;
}

export async function submitWalkthrough(payload: {
  assignmentId: string;
  checkInId: string | null;
  sections: LocalDraft["sections"];
}): Promise<SubmitResult> {
  return request(`${FN}?action=submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function devSeed(): Promise<{ assignmentId: string; storeId: string }> {
  return request(`${FN}?action=dev-seed`, { method: "POST" });
}

// ---- photo upload (direct to Storage) --------------------------------------

export async function uploadWalkthroughPhoto(
  assignmentId: string,
  record: PhotoRecord,
  blob: Blob,
): Promise<string> {
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${assignmentId}/${record.id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  if (upErr) throw upErr;

  const { data: auth } = await supabase.auth.getUser();
  const { error: rowErr } = await supabase.from("walkthrough_photos").upsert({
    id: record.id,
    assignment_id: assignmentId,
    item_code: record.itemCode,
    storage_path: path,
    taken_at: record.meta.at,
    lat: record.meta.lat,
    lng: record.meta.lng,
    upload_status: "uploaded",
    uploaded_by: auth.user?.id ?? null,
    uploaded_at: new Date().toISOString(),
  });
  if (rowErr) throw rowErr;

  // Signed URL for desktop review; the field runner shows the local blob.
  const { data: signed } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return signed?.signedUrl ?? path;
}

// ---- adapter ---------------------------------------------------------------

export function makeWalkthroughAdapter(assignmentId: string): WalkthroughAdapter {
  return {
    flushDraft: async (draft: LocalDraft) => {
      await saveDraft({
        assignmentId,
        sections: draft.sections,
        checkInId: draft.checkInId,
      });
    },
    uploadPhoto: (record: PhotoRecord, blob: Blob) =>
      uploadWalkthroughPhoto(assignmentId, record, blob),
  };
}
