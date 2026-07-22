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

export const fetchVisitStores = () => req<{ stores: VisitStore[] }>(`${FN}?action=stores`);
export const fetchToday = (storeId: string) => req<TodayResponse>(`${FN}?action=today&store_id=${encodeURIComponent(storeId)}`);
export const fetchActions = (storeId: string) => req<{ actions: ActionItem[] }>(`${FN}?action=actions&store_id=${encodeURIComponent(storeId)}`);
export const startVisit = (storeId: string) => req<StartVisitResponse>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "visit-start", store_id: storeId }) });
export const saveWalk = (input: { visit_id: string; item_id: string; category: string; label: string; status: WalkStatus; note?: string }) =>
  req<{ ok: true }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "walk-save", ...input }) });
export const submitVisit = (input: { visit_id: string; summary?: string; private_note?: string; funds_reviewed?: boolean; actions?: { text: string; priority?: string }[] }) =>
  req<{ ok: true; walk_score: number | null }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "visit-submit", ...input }) });
export const createReview = (input: { store_id: string; text: string; item_id?: string }) =>
  req<{ ok: true; id: string }>(`${FN}`, { method: "POST", body: JSON.stringify({ action: "review-create", ...input }) });
