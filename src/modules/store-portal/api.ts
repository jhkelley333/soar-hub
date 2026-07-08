// Store Command Center — client for netlify/functions/store-portal.
// Public calls carry { token, device_id }; the device id is generated once per
// browser and stored locally, which is what binds the link to the store's
// desktop. Admin calls use the normal Bearer session.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/store-portal";
const DEVICE_KEY = "soar_portal_device_id";

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function publicPost<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${FN}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export interface PortalStore { number: string; name: string | null; city: string | null; state: string | null }
export interface PortalSnapshot {
  store: PortalStore;
  sales: { date: string; net_sales: number | null; wow_pct: number | null } | null;
  labor: { date: string; labor_pct: number | null; target_pct: number | null } | null;
  rank: { rank: number; total: number; week: string } | null;
  work_orders: { open_count: number; latest: { title: string; status: string; priority: string | null }[] };
  notes: { title: string; body: string; pinned: boolean; author: string | null; created_at: string }[];
  contacts: { slot: string; name: string | null; phone: string | null; email: string | null }[];
}

export function fetchPortalSnapshot(token: string): Promise<PortalSnapshot> {
  return publicPost("snapshot", { token, device_id: deviceId() });
}
export function sendPortalReport(token: string, input: { kind: string; message: string; reporter_name?: string }): Promise<{ ok: true; notified: number }> {
  return publicPost("report", { token, device_id: deviceId(), ...input });
}

// ── Admin (Bearer) ───────────────────────────────────────────────────────────
async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function adminRequest<T>(action: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${FN}?action=${action}`, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface PortalTokenRow {
  store_id: string; number: string; name: string | null; city: string | null; state: string | null;
  token: { id: string; token: string; bound: boolean; last_used_at: string | null; created_at: string } | null;
}
export function fetchPortalAdminList(): Promise<{ stores: PortalTokenRow[] }> {
  return adminRequest("admin-list");
}
export function mintPortalToken(storeId: string): Promise<{ ok: true; token_id: string; token: string }> {
  return adminRequest("admin-mint", { method: "POST", body: JSON.stringify({ store_id: storeId }) });
}
export function revokePortalToken(tokenId: string): Promise<{ ok: true }> {
  return adminRequest("admin-revoke", { method: "POST", body: JSON.stringify({ token_id: tokenId }) });
}
export function resetPortalDevice(tokenId: string): Promise<{ ok: true }> {
  return adminRequest("admin-reset-device", { method: "POST", body: JSON.stringify({ token_id: tokenId }) });
}
export interface PortalReport { kind: string; message: string; reporter_name: string | null; created_at: string }
export function fetchPortalAdminSnapshot(storeId: string): Promise<PortalSnapshot & { reports: PortalReport[] }> {
  return adminRequest(`admin-snapshot&store_id=${encodeURIComponent(storeId)}`);
}
