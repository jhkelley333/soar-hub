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
export function sendPortalReport(access: PortalAccess, input: { kind: string; message: string; reporter_name?: string }): Promise<{ ok: true; notified: number }> {
  return portalPost("report", access, { ...input });
}
export function messagePortalLeader(token: string, input: { slot: string; message: string; reporter_name?: string }): Promise<{ ok: true; leader: string | null }> {
  return publicPost("chat-leader", { token, device_id: deviceId(), ...input });
}

// Store-scoped calls work for two callers: the store screen (token + device)
// and an admin session (Bearer + store_id) — the admin live view is fully
// interactive without touching the screen's device binding.
export type PortalAccess = { token: string } | { store_id: string };
function portalPost<T>(action: string, access: PortalAccess, body: Record<string, unknown> = {}): Promise<T> {
  if ("token" in access) return publicPost<T>(action, { token: access.token, device_id: deviceId(), ...body });
  return adminRequest<T>(action, { method: "POST", body: JSON.stringify({ store_id: access.store_id, ...body }) });
}

// ── Work orders from the screen ───────────────────────────────────────────────
export interface PortalTicket {
  id: string;
  wo_number: string;
  category: string | null;
  issue_description: string;
  status: string;
  priority: string | null;
  date_submitted: string;
  vendor_name: string | null;
}
export interface PortalTicketDetail {
  ticket: PortalTicket;
  messages: { user_name: string | null; user_role: string | null; message: string; created_at: string }[];
  photos: { file_url: string; file_name: string; created_at: string }[];
  activity: { update_type: string | null; event_type: string | null; user_name: string | null; created_at: string }[];
}
export function fetchPortalTickets(access: PortalAccess): Promise<{ open: PortalTicket[]; recent_closed: PortalTicket[] }> {
  return portalPost("tickets", access);
}
export function fetchPortalTicket(access: PortalAccess, ticketId: string): Promise<PortalTicketDetail> {
  return portalPost("ticket", access, { ticket_id: ticketId });
}
export interface NewPortalTicket {
  submitter_name: string;
  submitter_email?: string;
  submitter_phone?: string;
  issue_description: string;
  category?: string;
  asset_type?: string;
  model_number?: string;
  priority?: string;
  is_business_critical?: boolean;
  troubleshooting_checked?: boolean;
  vendor_id?: string | null;
  needs_vendor_help?: boolean;
}
export function createPortalTicket(access: PortalAccess, input: NewPortalTicket): Promise<{ ok: true; ticket_id: string; wo_number: string }> {
  return portalPost("create-ticket", access, { ...input });
}

// ── Issue library + store-scoped vendors ─────────────────────────────────────
// These ride the existing PUBLIC work-order endpoints (the same ones the
// public submit form uses), so the screen mirrors the real intake exactly.
const PUBLIC_WO_FN = "/.netlify/functions/public-submit";
export interface IssueLibraryItem { id: string; category: string | null; asset_type: string | null; display_name: string; troubleshooting_tips: string | null }
export async function searchIssueLibrary(q: string): Promise<IssueLibraryItem[]> {
  const res = await fetch(`${PUBLIC_WO_FN}?action=searchIssueLibrary&q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const b = await res.json().catch(() => null);
  return b?.items ?? [];
}
export interface StoreVendor { id: string; name: string; category: string | null }
export async function listStoreVendors(storeNumber: string, category?: string, assetType?: string): Promise<StoreVendor[]> {
  const params = new URLSearchParams({ store_number: storeNumber });
  if (category) params.set("category", category);
  if (assetType) params.set("asset_type", assetType);
  const res = await fetch(`${PUBLIC_WO_FN}?action=listVendors&${params.toString()}`);
  if (!res.ok) return [];
  const b = await res.json().catch(() => null);
  return b?.vendors ?? [];
}
export function commentPortalTicket(access: PortalAccess, input: { ticket_id: string; message: string; name?: string }): Promise<{ ok: true }> {
  return portalPost("comment-ticket", access, { ...input });
}
export function fetchPhotoQr(access: PortalAccess, ticketId: string): Promise<{ ok: true; token: string; expires_in_minutes: number; wo_number: string }> {
  return portalPost("photo-qr", access, { ticket_id: ticketId });
}

// ── Phone side (signed token from the QR; no device binding) ─────────────────
export interface PhoneInfo {
  wo_number: string; store_number: string; store_name: string | null;
  issue_description: string; photo_count: number; max_photos: number;
}
export async function fetchPhoneInfo(phoneToken: string): Promise<PhoneInfo> {
  const res = await fetch(`${FN}?action=phone-info&token=${encodeURIComponent(phoneToken)}`);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<PhoneInfo>;
}
export async function uploadPhonePhoto(phoneToken: string, file: File): Promise<{ ok: true }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the photo."));
    r.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  return publicPost("phone-upload", {
    token: phoneToken, photo_data: base64, photo_name: file.name, photo_type: file.type || "image/jpeg",
  });
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
