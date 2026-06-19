// Dashboard weather — reads the latest recorded observation for a store's city
// (weather-sync writes the data on a schedule; this never calls Google).
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/weather";

async function authGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface WeatherForecastDay {
  date: string | null;
  hi_f: number | null;
  lo_f: number | null;
  condition: string | null;
  icon: string | null;
  precip_prob: number | null;
}
export interface WeatherCurrent {
  observed_at?: string;
  temp_f: number | null;
  feels_like_f: number | null;
  condition: string | null;
  condition_type: string | null;
  icon_uri: string | null;
  humidity_pct: number | null;
  wind_mph: number | null;
  precip_prob_pct: number | null;
}
export interface WeatherForStore {
  location: { id: string; city: string; state: string; label: string | null } | null;
  current: WeatherCurrent | null;
  forecast: WeatherForecastDay[];
  observed_at: string | null;
}

export function fetchWeatherForStore(storeId: string): Promise<WeatherForStore> {
  return authGet<WeatherForStore>(`${FN}?action=for-store&store_id=${encodeURIComponent(storeId)}`);
}

export interface WeatherHistoryPoint {
  date: string;
  temp_f: number | null;
  hi_f: number | null;
  lo_f: number | null;
}
export interface WeatherHistory {
  location: { id: string; city: string; state: string; label: string | null } | null;
  points: WeatherHistoryPoint[];
}
export function fetchWeatherHistory(storeId: string, days: number): Promise<WeatherHistory> {
  return authGet<WeatherHistory>(`${FN}?action=history&store_id=${encodeURIComponent(storeId)}&days=${days}`);
}

export interface WeatherRangePoint {
  date: string;
  temp_f: number | null;
  hi_f: number | null;
  lo_f: number | null;
  precip_in: number | null;
}
export interface WeatherRange {
  location: { id: string; city: string; state: string; label: string | null } | null;
  points: WeatherRangePoint[];
  error?: string;
}
// Daily weather across an explicit date range (reaches past the 365-day
// history cap — used for "this week, last year").
export function fetchWeatherRange(storeId: string, start: string, end: string): Promise<WeatherRange> {
  return authGet<WeatherRange>(
    `${FN}?action=range&store_id=${encodeURIComponent(storeId)}&start=${start}&end=${end}`
  );
}

async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// Admin-only: run a manual pull now (same core as the schedule).
export function triggerWeatherSync(): Promise<{ ok: boolean; locations: number; recorded: number; failed: number; error?: string | null; reason?: string }> {
  return authPost(`${FN}?action=sync`);
}

// Admin-only: backfill historical daily weather (Open-Meteo archive) one slice
// of cities per call — the caller loops until `done`.
export function backfillWeatherHistory(input: { start_date: string; end_date: string; offset: number; limit?: number }): Promise<{
  ok: boolean; total: number; processed: number; inserted: number; failed: number; done: boolean; error?: string | null;
}> {
  return authPost(`${FN}?action=backfill`, input);
}
