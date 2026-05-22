// Direct Supabase access for the Reno Scoping module. RLS enforces
// visibility / write rules (see 0066). No netlify function in front of
// this for v1 — the audit log is the one thing that needs a service-role
// path and will be added in PR 3 alongside the review workflow.

import { supabase } from "@/lib/supabase";
import type {
  BuildingType,
  RenoScope,
  RenoScopeItem,
  RenoScopeNote,
  RenoScopePhoto,
  RenoScopeRow,
  RenoScopeTour,
  ScopeItemStatus,
  ScopePhotoSlot,
  ScopeStatus,
  ScopeTemplate,
  ScopeTemplateItem,
} from "./types";

const ACTIVE_TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";
export const PHOTO_BUCKET = "reno-scope-photos";
export const TOUR_BUCKET = "reno-scope-tours";

// ---- template + slot lookups (read-mostly) ---------------------------

export async function fetchActiveTemplate(): Promise<ScopeTemplate> {
  const { data, error } = await supabase
    .from("scope_templates")
    .select("*")
    .eq("id", ACTIVE_TEMPLATE_ID)
    .single();
  if (error) throw error;
  return data as ScopeTemplate;
}

export async function fetchTemplateItems(templateId: string): Promise<ScopeTemplateItem[]> {
  const { data, error } = await supabase
    .from("scope_template_items")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as ScopeTemplateItem[];
}

export async function fetchPhotoSlots(templateId: string): Promise<ScopePhotoSlot[]> {
  const { data, error } = await supabase
    .from("scope_photo_slots")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as ScopePhotoSlot[];
}

// ---- scopes (list + detail) ------------------------------------------

export async function fetchScopes(): Promise<RenoScopeRow[]> {
  const { data, error } = await supabase
    .from("reno_scopes")
    .select(`
      *,
      store:stores ( id, number, name, state ),
      scoper:profiles!reno_scopes_scoped_by_fkey ( id, full_name, email )
    `)
    .order("scope_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RenoScopeRow[];
}

export async function fetchScope(id: string): Promise<RenoScopeRow> {
  const { data, error } = await supabase
    .from("reno_scopes")
    .select(`
      *,
      store:stores ( id, number, name, state ),
      scoper:profiles!reno_scopes_scoped_by_fkey ( id, full_name, email )
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as RenoScopeRow;
}

export interface CreateScopeInput {
  store_id: string;
  building_type: BuildingType;
  scope_date?: string;
  preferred_signage_vendor?: string | null;
  preferred_canopy_vendor?: string | null;
  preferred_gc?: string | null;
  preferred_paint_contractor?: string | null;
}

export async function createScope(input: CreateScopeInput): Promise<RenoScope> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const template = await fetchActiveTemplate();

  const { data, error } = await supabase
    .from("reno_scopes")
    .insert({
      ...input,
      scope_date: input.scope_date ?? new Date().toISOString().slice(0, 10),
      scoped_by: user.id,
      template_id: template.id,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RenoScope;
}

export async function updateScope(
  id: string,
  patch: Partial<Pick<RenoScope,
    | "preferred_signage_vendor"
    | "preferred_canopy_vendor"
    | "preferred_gc"
    | "preferred_paint_contractor"
    | "building_type"
    | "scope_date"
  >>
): Promise<RenoScope> {
  const { data, error } = await supabase
    .from("reno_scopes")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as RenoScope;
}

export async function deleteScope(id: string): Promise<void> {
  const { error } = await supabase.from("reno_scopes").delete().eq("id", id);
  if (error) throw error;
}

// Status transitions go through the service-role netlify function so
// each one can also write a reno_scope_audit_log row atomically. The
// audit-log table has no INSERT policy — only the function can write
// to it.
export async function transitionScopeStatus(
  id: string,
  toStatus: ScopeStatus,
  reviewNotes?: string | null
): Promise<RenoScope> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/.netlify/functions/reno-scoping?action=transition", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope_id: id,
      to_status: toStatus,
      review_notes: reviewNotes,
    }),
  });
  if (!res.ok) {
    let message = `Transition failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { scope: RenoScope };
  return body.scope;
}

// ---- audit log read --------------------------------------------------

export interface RenoScopeAuditEntry {
  id: string;
  scope_id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  from_status: ScopeStatus | null;
  to_status: ScopeStatus | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchScopeAuditLog(scopeId: string): Promise<RenoScopeAuditEntry[]> {
  const { data, error } = await supabase
    .from("reno_scope_audit_log")
    .select("*")
    .eq("scope_id", scopeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RenoScopeAuditEntry[];
}

// ---- scope items -----------------------------------------------------

export async function fetchScopeItems(scopeId: string): Promise<RenoScopeItem[]> {
  const { data, error } = await supabase
    .from("reno_scope_items")
    .select("*")
    .eq("scope_id", scopeId);
  if (error) throw error;
  return (data ?? []) as RenoScopeItem[];
}

export interface UpsertScopeItemInput {
  scope_id: string;
  template_item_id: string;
  status?: ScopeItemStatus | null;
  notes?: string | null;
  estimated_cost?: number | null;
  recommend_for_plus_up?: boolean | null;
}

export async function upsertScopeItem(input: UpsertScopeItemInput): Promise<RenoScopeItem> {
  const { data, error } = await supabase
    .from("reno_scope_items")
    .upsert(input, { onConflict: "scope_id,template_item_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as RenoScopeItem;
}

// ---- photos ----------------------------------------------------------

export async function fetchScopePhotos(scopeId: string): Promise<RenoScopePhoto[]> {
  const { data, error } = await supabase
    .from("reno_scope_photos")
    .select("*")
    .eq("scope_id", scopeId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RenoScopePhoto[];
}

export interface UploadPhotoInput {
  scope_id: string;
  scope_item_id?: string | null;
  photo_slot_id?: string | null;
  caption?: string | null;
  taken_at?: string | null;
  file: Blob;
  filename: string;
  contentType?: string;
}

export async function uploadScopePhoto(input: UploadPhotoInput): Promise<RenoScopePhoto> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const storagePath = `${input.scope_id}/${Date.now()}-${input.filename}`;
  const { error: uploadErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.contentType ?? "image/jpeg",
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("reno_scope_photos")
    .insert({
      scope_id: input.scope_id,
      scope_item_id: input.scope_item_id ?? null,
      photo_slot_id: input.photo_slot_id ?? null,
      storage_path: storagePath,
      caption: input.caption ?? null,
      taken_at: input.taken_at ?? null,
      uploaded_by: user.id,
    })
    .select("*")
    .single();
  if (error) {
    // best-effort cleanup of the orphan blob
    await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
    throw error;
  }
  return data as RenoScopePhoto;
}

export async function deleteScopePhoto(photo: RenoScopePhoto): Promise<void> {
  const { error: dbErr } = await supabase
    .from("reno_scope_photos")
    .delete()
    .eq("id", photo.id);
  if (dbErr) throw dbErr;
  // Orphan the blob rather than fail the user-facing delete if storage
  // remove errors (e.g. policy quirks). The bucket has a lifecycle rule
  // we can add later to clean up.
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]).catch(() => {});
}

export async function getPhotoSignedUrl(storagePath: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}

// ---- 360 tours -------------------------------------------------------

export async function fetchScopeTours(scopeId: string): Promise<RenoScopeTour[]> {
  const { data, error } = await supabase
    .from("reno_scope_tours")
    .select("*")
    .eq("scope_id", scopeId)
    .order("sort_order")
    .order("uploaded_at");
  if (error) throw error;
  return (data ?? []) as RenoScopeTour[];
}

export interface UploadTourInput {
  scope_id: string;
  capture_position: string;
  file: Blob;
  filename: string;
  contentType?: string;
  sort_order?: number;
}

export async function uploadScopeTour(input: UploadTourInput): Promise<RenoScopeTour> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const storagePath = `${input.scope_id}/${Date.now()}-${input.filename}`;
  const { error: uploadErr } = await supabase.storage
    .from(TOUR_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.contentType ?? "image/jpeg",
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("reno_scope_tours")
    .insert({
      scope_id: input.scope_id,
      storage_path: storagePath,
      capture_position: input.capture_position,
      sort_order: input.sort_order ?? 0,
      uploaded_by: user.id,
    })
    .select("*")
    .single();
  if (error) {
    await supabase.storage.from(TOUR_BUCKET).remove([storagePath]);
    throw error;
  }
  return data as RenoScopeTour;
}

export async function deleteScopeTour(tour: RenoScopeTour): Promise<void> {
  const { error: dbErr } = await supabase
    .from("reno_scope_tours")
    .delete()
    .eq("id", tour.id);
  if (dbErr) throw dbErr;
  await supabase.storage.from(TOUR_BUCKET).remove([tour.storage_path]).catch(() => {});
}

export async function getTourSignedUrl(storagePath: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(TOUR_BUCKET)
    .createSignedUrl(storagePath, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}

// ---- notes -----------------------------------------------------------

export async function fetchScopeNotes(scopeId: string): Promise<RenoScopeNote[]> {
  const { data, error } = await supabase
    .from("reno_scope_notes")
    .select("*")
    .eq("scope_id", scopeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RenoScopeNote[];
}

export async function addScopeNote(scopeId: string, text: string): Promise<RenoScopeNote> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("reno_scope_notes")
    .insert({ scope_id: scopeId, note_text: text, created_by: user.id })
    .select("*")
    .single();
  if (error) throw error;
  return data as RenoScopeNote;
}

// ---- stores I can scope ----------------------------------------------
// Returns stores the caller can see (RLS-filtered) — used by the New
// Scope picker. Restricted to active stores.

export interface StoreOption {
  id: string;
  number: string;
  name: string;
  state: string | null;
}

export async function fetchScopableStores(): Promise<StoreOption[]> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, number, name, state")
    .eq("is_active", true)
    .order("number");
  if (error) throw error;
  return (data ?? []) as StoreOption[];
}

// ---- sidebar badge ---------------------------------------------------
// Count of scopes that are submitted but not yet reviewed, scoped by
// RLS — DOs only see scopes in their district, RVPs in their region,
// etc. Drives the pending badge next to the Reno Scoping nav item.

export async function countPendingScopes(): Promise<number> {
  const { count, error } = await supabase
    .from("reno_scopes")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted");
  if (error) throw error;
  return count ?? 0;
}
