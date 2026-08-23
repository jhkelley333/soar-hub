// GM roster reconciliation — client wrappers around the gm-roster function.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/gm-roster";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type ReconcileStatus = "matched" | "no_account" | "mismatch" | "open" | "in_training";

export interface GmRosterRow {
  store_number: string;
  store_name: string | null;
  in_app: boolean;
  roster_name: string | null;
  roster_status: "named" | "open" | "in_training";
  gm_email: string | null;
  gm_cell: string | null;
  gm_birthday: string | null;
  hire_date: string | null;
  placement_date: string | null;
  // Hiring plan for an OPEN store: projected fill date + who, or interviewing.
  projected_gm_name: string | null;
  projected_fill_date: string | null;
  still_interviewing: boolean;
  no_gm_credit: boolean;        // derived from Labor's active No-GM credit tags
  no_gm_reason: "no_gm" | "loa" | "in_training" | null;
  do_name: string | null;
  sdo_name: string | null;
  rvp_name: string | null;
  account: { id: string; name: string | null; email: string | null; phone: string | null; is_active: boolean; cultural_index_trait: string | null } | null;
  reconcile: ReconcileStatus;
}

export interface GmRosterResponse {
  ok: true;
  rows: GmRosterRow[];
  summary: Record<ReconcileStatus, number>;
  can_import: boolean; // bulk paste importer (org-wide roles only)
  can_edit: boolean;   // inline single-name edit (everyone who can see the list)
}

export function fetchGmRoster(): Promise<GmRosterResponse> {
  return req(`${FN}?action=list`);
}

// ── Leadership roster (DO / SDO / RVP) ──────────────────────────────────────
export interface LeaderRow {
  id: string;
  name: string | null;
  role: "do" | "sdo" | "rvp";
  email: string | null;
  phone: string | null;
  birthday: string | null;   // ISO YYYY-MM-DD, null if opted out / unset
  coverage: string[];        // "#code · name" for the markets they lead
  additional?: string[];     // extra (acting) markets, flagged separately
}
export function fetchGmLeaders(): Promise<{ ok: true; rows: LeaderRow[] }> {
  return req(`${FN}?action=leaders`);
}

// ── Full org contacts export (Location Contacts by Level workbook) ───────────
export interface LeaderContact {
  name: string | null;
  first: string;
  last: string;
  phone: string | null;
  email: string | null;
}
export interface ContactsExportStore {
  number: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  area: string | null;
  district: string | null;
  do: LeaderContact;
  sdo: LeaderContact;
  rvp: LeaderContact;
  gm: {
    name: string | null; first: string; last: string;
    cell: string | null; birthday: string | null; email: string | null;
    hire_date: string | null; placement_date: string | null; status: string | null;
  };
}
export interface ContactsExportResponse {
  ok: true;
  stores: ContactsExportStore[];
  leaders: { role: string; name: string | null; first: string; last: string; phone: string | null; email: string | null }[];
  presidents: string[];
}
export function fetchContactsExport(): Promise<ContactsExportResponse> {
  return req(`${FN}?action=contacts-export`);
}

// Edit one store's roster GM name. "Open" / "In Training" (or blank) set the
// matching status, mirroring the importer.
export function setGmRosterName(storeNumber: string, gmName: string): Promise<{ ok: true; store_number: string; gm_name: string | null; status: string }> {
  return req(`${FN}?action=set-name`, { method: "POST", body: JSON.stringify({ store_number: storeNumber, gm_name: gmName }) });
}

// Edit one store's GM detail fields (DO and above, scoped). Only the keys sent
// are updated; blank clears a field. Name / status / email are untouched.
export function setGmRosterDetails(storeNumber: string, fields: {
  gm_cell?: string | null; gm_birthday?: string | null; hire_date?: string | null; placement_date?: string | null;
  projected_gm_name?: string | null; projected_fill_date?: string | null; still_interviewing?: boolean;
}): Promise<{ ok: true; store_number: string }> {
  return req(`${FN}?action=set-details`, { method: "POST", body: JSON.stringify({ store_number: storeNumber, ...fields }) });
}

// ── Edit history (audit log) for one store ──────────────────────────────────
export interface GmRosterHistoryEntry {
  id: string;
  store_number: string;
  store_name: string | null;
  old_gm_name: string | null;
  new_gm_name: string | null;
  old_status: string | null;
  new_status: string | null;
  source: "edit" | "import";
  changed_by_name: string | null;
  changed_at: string;
}
export function fetchGmRosterHistory(storeNumber: string): Promise<{ ok: true; store_number: string; entries: GmRosterHistoryEntry[] }> {
  return req(`${FN}?action=history&store=${encodeURIComponent(storeNumber)}`);
}

export interface GmRosterImportRow {
  store_number: string;
  store_name?: string;
  gm_name?: string;
  gm_email?: string;
  gm_cell?: string;
  gm_birthday?: string;
  hire_date?: string;
  placement_date?: string;
}

export function importGmRoster(rows: GmRosterImportRow[]): Promise<{ ok: true; upserted: number }> {
  return req(`${FN}?action=import`, { method: "POST", body: JSON.stringify({ rows }) });
}

// Parse a paste of the ops roster sheet (tab-separated) into import rows.
// Expected column order (matches the sheet):
//   0 Store# · 1 Store Name · 2 DO · 3 SDO · 4 RVP · 5 GM (Full Name) ·
//   6 Date of Hire · 7 Date of Placement · 8-10 tenure/days · 11 GM Cell ·
//   12 GM Birthday · 13 Birth Month · 14 Store Email
// A header row (non-numeric store #) is skipped.
export function parseRosterPaste(text: string): GmRosterImportRow[] {
  const out: GmRosterImportRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("\t").map((x) => x.trim());
    const num = c[0];
    if (!num || !/^\d+$/.test(num)) continue; // skip header / blank
    out.push({
      store_number: num,
      store_name: c[1] || undefined,
      gm_name: c[5] || undefined,
      hire_date: c[6] || undefined,
      placement_date: c[7] || undefined,
      gm_cell: c[11] || undefined,
      gm_birthday: c[12] || undefined,
      gm_email: c[14] || undefined,
    });
  }
  return out;
}
