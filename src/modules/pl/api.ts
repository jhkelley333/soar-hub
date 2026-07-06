// P&L — typed wrappers around netlify/functions/pl.

import { supabase } from "@/lib/supabase";
import type { ParsedPlStore, PlOverviewRow, PlPeriod, PlStatement } from "./types";

const FN = "/.netlify/functions/pl";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
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

export function fetchPlPeriods(): Promise<{ periods: PlPeriod[] }> {
  return request(`${FN}?action=periods`);
}

export function fetchPlOverview(period: string): Promise<{ period: string; rows: PlOverviewRow[] }> {
  return request(`${FN}?action=overview&period=${encodeURIComponent(period)}`);
}

export function fetchPlStatement(store: string, period: string): Promise<{ statement: PlStatement }> {
  return request(
    `${FN}?action=statement&store=${encodeURIComponent(store)}&period=${encodeURIComponent(period)}`,
  );
}

export function uploadPl(input: {
  period_end: string;
  period_label: string;
  is_final: boolean;
  statements: ParsedPlStore[];
}): Promise<{ ok: true; upserted: number; unmatched: string[] }> {
  return request(`${FN}?action=upload`, { method: "POST", body: JSON.stringify(input) });
}

// ── Walkthrough flags (Google Sheet) + notes write-back ─────────────

const FLAGS_FN = "/.netlify/functions/pl-flags";

export interface PlFlag {
  sheet_row: number;
  category: string;
  item: string | null;
  value: string | null;
  rule: string | null;
  prior_1: string | null;
  prior_2: string | null;
  sheet_note: string | null;
  note?: string;
  noted_by?: string;
  noted_at?: string;
}

export interface PlFlagStore {
  store_number: string;
  store_name: string | null;
  gm: string | null;
  flags: PlFlag[];
}

export function fetchPlFlags(store?: string): Promise<{ period_end: string | null; stores: PlFlagStore[] }> {
  return request(`${FLAGS_FN}?action=flags${store ? `&store=${encodeURIComponent(store)}` : ""}`);
}

export function savePlFlagNote(input: {
  period_end: string;
  store_number: string;
  category: string;
  item: string;
  sheet_row: number;
  note: string;
}): Promise<{ ok: true; sheet_written: boolean; sheet_reason: string | null }> {
  return request(`${FLAGS_FN}?action=note`, { method: "POST", body: JSON.stringify(input) });
}
