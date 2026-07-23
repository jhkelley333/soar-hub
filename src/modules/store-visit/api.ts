// Store Visit — client wrappers around the store-visit function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/store-visit";

export interface VisitStore { id: string; number: string; name: string; city: string | null; state: string | null }
export interface Gap {
  metric: string; label: string; unit: "pct" | "time" | "number";
  value: string; valueRaw: number | null; target: string; targetRaw: number | null;
  severity: number; dir: "up" | "down" | "flat"; delta: string | null;
}
export interface ReviewRequest { id: string; text: string; by_role: string | null; item_id: string | null; created_at: string }
export interface TodayResponse {
  store: { id: string; number: string; name: string; city: string | null; state: string | null; address: string | null };
  gaps: Gap[];
  reviews: ReviewRequest[];
  open_actions: number;
  funds_reviewed: boolean;
  last_visit_at: string | null;
}
export interface ChecklistItem { id: string; category: string; label: string; sort: number; required_by_role: string | null }
export interface StartVisitResponse { visit_id: string; template: { id: string; name: string } | null; items: ChecklistItem[] }
export type WalkStatus = "pass" | "gap" | "na";
export interface PhotoRec { path: string; at?: string; lat?: number | null; lng?: number | null; url?: string | null; previewUrl?: string }
const PHOTO_BUCKET = "store-visit-photos";
export interface ActionItem {
  id: string; text: string; owner: string | null; priority: "high" | "med" | "low";
  due: string | null; status: string; work_order_id: string | null; created_at: string;
}

async function tok(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Not signed in");
  return t;
}
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = await tok();
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface HistoryVisit {
  id: string;
  visitor: string | null;
  role: string | null;
  submitted_at: string;
  walk_score: number | null;
  trend: "up" | "down" | "flat" | null;
  delta: number | null;
  summary: string | null;
  has_private_note: boolean;
  private_note: string | null;
  actions: number;
}

export const fetchVisitStores = () => req<{ stores: VisitStore[] }>(`${FN}?action=stores`);
export const fetchVisitHistory = (storeId: string) => req<{ visits: HistoryVisit[] }>(`${FN}?action=history&store_id=${encodeURIComponent(storeId)}`);
export const fetchToday = (storeId: string) => req<TodayResponse>(`${FN}?action=today&store_id=${encodeURIComponent(storeId)}`);
export const fetchActions = (storeId: string) => req<{ actions: ActionItem[] }>(`${FN}?action=actions&store_id=${encodeURIComponent(storeId)}`);
export const startVisit = (storeId: string) => req<StartVisitResponse>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "visit-start", store_id: storeId }) });
export const saveWalk = (input: { visit_id: string; item_id: string; category: string; label: string; status: WalkStatus; note?: string; photos?: PhotoRec[] }) =>
  req<{ ok: true }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "walk-save", ...input, photos: stripPreview(input.photos) }) });
export const submitVisit = (input: { visit_id: string; summary?: string; private_note?: string; funds_reviewed?: boolean; summary_photos?: PhotoRec[]; actions?: { text: string; priority?: string }[] }) =>
  req<{ ok: true; walk_score: number | null }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "visit-submit", ...input, summary_photos: stripPreview(input.summary_photos) }) });
export const createReview = (input: { store_id: string; text: string; item_id?: string }) =>
  req<{ ok: true; id: string }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "review-create", ...input }) });
export const createAction = (input: { store_id: string; text: string; priority?: string; owner?: string; due?: string }) =>
  req<{ ok: true; id: string }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "action-create", ...input }) });
export const updateAction = (input: { id: string; status?: "open" | "improved" | "worse" | "resolved"; note?: string; priority?: string; text?: string }) =>
  req<{ ok: true }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "action-update", ...input }) });

// ── photo capture ────────────────────────────────────────────────────
// Drop the local object-URL before persisting; the server re-signs on read.
const stripPreview = (photos?: PhotoRec[]) =>
  (photos ?? []).map(({ previewUrl, url, ...keep }) => keep); // eslint-disable-line @typescript-eslint/no-unused-vars

function captureGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000 }
    );
  });
}

// Upload one photo for a visit and return the record to keep in state (with a
// local preview URL for instant display). EXIF rides inside the file itself.
export async function uploadVisitPhoto(visitId: string, kind: "walk" | "summary", file: File): Promise<PhotoRec> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const { upload_url, token, path } = await req<{ upload_url: string; token: string; path: string }>(
    `${FN}`, { method: "POST", body: JSON.stringify({ action: "photo-upload-url", visit_id: visitId, kind, ext }) }
  );
  void upload_url;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).uploadToSignedUrl(path, token, file);
  if (error) throw new Error(error.message);
  const geo = await captureGeo();
  return { path, at: new Date().toISOString(), lat: geo?.lat ?? null, lng: geo?.lng ?? null, previewUrl: URL.createObjectURL(file) };
}
