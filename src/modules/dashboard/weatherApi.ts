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

// Admin-only: run a manual pull now (same core as the schedule).
export async function triggerWeatherSync(): Promise<{ ok: boolean; locations: number; recorded: number; failed: number; error?: string | null; reason?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${FN}?action=sync`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}
