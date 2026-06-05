// Walkthrough review / CAPA — DO-side reads + decisions. Direct-to-Supabase:
// RLS (migration 0120) scopes submissions + corrective actions to the caller's
// visible stores, lets DO+ set review status, and lets owner/DO+ work
// corrective actions. No service-role function needed.

import { supabase } from "@/lib/supabase";
import type {
  SectionResponse,
  Tier,
  WalkthroughTemplate,
} from "../types";

const PHOTO_BUCKET = "walkthrough-photos";

// ---- list types ------------------------------------------------------------

/** Server-derived trust signals stamped at submit (migration 0127). */
export interface SubmissionIntegrity {
  durationSeconds: number | null;
  secondsPerItem: number | null;
  itemsAnswered: number;
  rushed: boolean;
  onSite: boolean | null;
  geofenceResult: string | null;
  exceptionReason: string | null;
  photoCount: number;
  photoTimeMismatch: number;
  photoGeoMismatch: number;
}

export interface ReviewQueueRow {
  id: string;
  storeId: string;
  storeNumber: string;
  storeName: string;
  templateVersion: string;
  score: number;
  tier: Tier;
  flagCount: number;
  status: "submitted" | "needs_revision" | "approved" | "draft";
  submittedAt: string | null;
  submitterName: string;
  durationSeconds: number | null;
  integrity: SubmissionIntegrity | null;
}

interface NameRow { full_name: string | null; preferred_name: string | null }
function name(p: NameRow | null | undefined): string {
  return p?.preferred_name || p?.full_name || "—";
}

export interface ReviewFilters {
  status?: ReviewQueueRow["status"] | "all";
}

export async function listReviewQueue(filters: ReviewFilters = {}): Promise<ReviewQueueRow[]> {
  let q = supabase
    .from("walkthrough_submissions")
    .select(
      "id, store_id, template_version, score, tier, flag_count, status, submitted_at, duration_seconds, integrity, " +
        "store:stores!store_id(number, name), submitter:profiles!submitted_by(full_name, preferred_name)",
    )
    .neq("status", "draft")
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const store = r.store as { number?: string; name?: string } | null;
    return {
      id: r.id as string,
      storeId: r.store_id as string,
      storeNumber: store?.number ?? "—",
      storeName: store?.name ?? "—",
      templateVersion: r.template_version as string,
      score: r.score as number,
      tier: r.tier as Tier,
      flagCount: r.flag_count as number,
      status: r.status as ReviewQueueRow["status"],
      submittedAt: (r.submitted_at as string) ?? null,
      submitterName: name(r.submitter as NameRow),
      durationSeconds: (r.duration_seconds as number) ?? null,
      integrity: (r.integrity as SubmissionIntegrity) ?? null,
    };
  });
}

// ---- detail ----------------------------------------------------------------

export interface PhotoView {
  id: string;
  itemCode: string;
  url: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
}

export interface SubmissionDetail {
  id: string;
  storeNumber: string;
  storeName: string;
  score: number;
  tier: Tier;
  flagCount: number;
  status: ReviewQueueRow["status"];
  submittedAt: string | null;
  submitterName: string;
  reviewNotes: string | null;
  template: Pick<WalkthroughTemplate, "name" | "sections">;
  sections: SectionResponse[];
  checkIn: {
    geofenceResult: string;
    exceptionReason: string | null;
    at: string;
  } | null;
  integrity: SubmissionIntegrity | null;
  photosByItem: Record<string, PhotoView[]>;
}

export async function getSubmissionDetail(id: string): Promise<SubmissionDetail> {
  const { data, error } = await supabase
    .from("walkthrough_submissions")
    .select(
      "*, store:stores!store_id(number, name), submitter:profiles!submitted_by(full_name, preferred_name), " +
        "template:walkthrough_templates(name, sections), checkin:walkthrough_checkins(geofence_result, exception_reason, at)",
    )
    .eq("id", id)
    .single();
  if (error) throw error;

  const r = data as unknown as Record<string, unknown>;
  const sections = (r.sections as SectionResponse[]) ?? [];
  const store = r.store as { number?: string; name?: string } | null;
  const tmpl = r.template as { name?: string; sections?: WalkthroughTemplate["sections"] } | null;
  const checkin = r.checkin as
    | { geofence_result: string; exception_reason: string | null; at: string }
    | null;

  // Collect photo ids referenced across all item responses, resolve to signed
  // URLs in one batch.
  const ids = sections.flatMap((s) => s.items.flatMap((i) => i.photoIds ?? []));
  const photosByItem = await loadPhotos(ids);

  return {
    id: r.id as string,
    storeNumber: store?.number ?? "—",
    storeName: store?.name ?? "—",
    score: r.score as number,
    tier: r.tier as Tier,
    flagCount: r.flag_count as number,
    status: r.status as ReviewQueueRow["status"],
    submittedAt: (r.submitted_at as string) ?? null,
    submitterName: name(r.submitter as NameRow),
    reviewNotes: (r.review_notes as string) ?? null,
    template: { name: tmpl?.name ?? "Walkthrough", sections: tmpl?.sections ?? [] },
    sections,
    checkIn: checkin
      ? { geofenceResult: checkin.geofence_result, exceptionReason: checkin.exception_reason, at: checkin.at }
      : null,
    integrity: (r.integrity as SubmissionIntegrity) ?? null,
    photosByItem,
  };
}

async function loadPhotos(ids: string[]): Promise<Record<string, PhotoView[]>> {
  const byItem: Record<string, PhotoView[]> = {};
  if (ids.length === 0) return byItem;
  const { data, error } = await supabase
    .from("walkthrough_photos")
    .select("id, item_code, storage_path, taken_at, lat, lng")
    .in("id", ids);
  if (error) throw error;
  const rows = data ?? [];
  const paths = rows.map((p) => p.storage_path).filter(Boolean) as string[];
  const signed = paths.length
    ? (await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60))?.data ?? []
    : [];
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  for (const p of rows) {
    const view: PhotoView = {
      id: p.id,
      itemCode: p.item_code,
      url: p.storage_path ? urlByPath.get(p.storage_path) ?? null : null,
      takenAt: p.taken_at,
      lat: p.lat,
      lng: p.lng,
    };
    (byItem[p.item_code] ??= []).push(view);
  }
  return byItem;
}

// ---- review decision -------------------------------------------------------
// Goes through the walkthrough function (service role) so the decision also
// writes the audit log, reopens the assignment on return, and emails the GM —
// none of which a client-side update can do. The function still enforces the
// reviewer's store visibility via an RLS-scoped update under the hood.

export async function decideReview(
  submissionId: string,
  decision: "approve" | "needs_revision",
  notes: string,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/.netlify/functions/walkthrough?action=review", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId, decision, notes }),
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
}

// ---- corrective actions ----------------------------------------------------

export type CapaStatus = "open" | "in_progress" | "verified" | "closed";

export interface CapaRow {
  id: string;
  title: string;
  storeNumber: string;
  storeName: string;
  ownerName: string;
  dueAt: string | null;
  priority: "low" | "med" | "high";
  status: CapaStatus;
  sourceItemCode: string;
  originPhotoIds: string[];
  resolutionNotes: string | null;
  /** Linked Work Order spawned from this action, if any. */
  workOrderTicketId: string | null;
  workOrderNumber: string | null;
}

function mapCapa(r: Record<string, unknown>): CapaRow {
  const store = r.store as { number?: string; name?: string } | null;
  const wo = r.work_order as { id?: string; wo_number?: string } | null;
  return {
    id: r.id as string,
    title: r.title as string,
    storeNumber: store?.number ?? "—",
    storeName: store?.name ?? "—",
    ownerName: name(r.owner as NameRow),
    dueAt: (r.due_at as string) ?? null,
    priority: r.priority as CapaRow["priority"],
    status: r.status as CapaStatus,
    sourceItemCode: r.source_item_code as string,
    originPhotoIds: (r.origin_photo_ids as string[]) ?? [],
    resolutionNotes: (r.resolution_notes as string) ?? null,
    workOrderTicketId: (wo?.id as string) ?? null,
    workOrderNumber: (wo?.wo_number as string) ?? null,
  };
}

export async function listCorrectiveActions(
  filters: { status?: CapaStatus | "all" | "open_only" } = {},
): Promise<CapaRow[]> {
  let q = supabase
    .from("corrective_actions")
    .select(
      "id, title, due_at, priority, status, source_item_code, origin_photo_ids, resolution_notes, " +
        "store:stores!store_id(number, name), owner:profiles!owner_id(full_name, preferred_name), " +
        "work_order:tickets!work_order_ticket_id(id, wo_number)",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (filters.status === "open_only") q = q.in("status", ["open", "in_progress"]);
  else if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => mapCapa(r));
}

export async function getCapaPhotos(ids: string[]): Promise<PhotoView[]> {
  const byItem = await loadPhotos(ids);
  return Object.values(byItem).flat();
}

export async function updateCorrectiveAction(
  id: string,
  patch: { status?: CapaStatus; resolutionNotes?: string },
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {};
  if (patch.status) {
    row.status = patch.status;
    if (patch.status === "verified" || patch.status === "closed") {
      row.verified_by = auth.user?.id ?? null;
      row.verified_at = new Date().toISOString();
    }
  }
  if (patch.resolutionNotes !== undefined) row.resolution_notes = patch.resolutionNotes.trim() || null;
  const { error } = await supabase.from("corrective_actions").update(row).eq("id", id);
  if (error) throw error;
}

// Spawn a Work Order from a corrective action (server-side: WO number,
// pre-filled fields, photos carried over, two-way link). Returns the new WO.
export async function createWorkOrderFromCapa(
  correctiveActionId: string,
): Promise<{ ticketId: string; woNumber: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/.netlify/functions/facilities-v2?action=createTicketFromCapa", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ correctiveActionId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || `Request failed (${res.status})`);
  return { ticketId: body.ticket.id, woNumber: body.woNumber };
}
