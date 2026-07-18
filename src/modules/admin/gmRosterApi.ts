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
  do_name: string | null;
  sdo_name: string | null;
  rvp_name: string | null;
  account: { name: string | null; email: string | null } | null;
  reconcile: ReconcileStatus;
}

export interface GmRosterResponse {
  ok: true;
  rows: GmRosterRow[];
  summary: Record<ReconcileStatus, number>;
}

export function fetchGmRoster(): Promise<GmRosterResponse> {
  return req(`${FN}?action=list`);
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
