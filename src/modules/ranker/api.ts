// Ranker — client-side fetch wrappers. Each call injects the caller's
// Supabase access token in the Authorization header so the netlify
// function can verify the JWT and look up the profile + scope.

import { supabase } from "@/lib/supabase";
import type {
  AISummaryResponse,
  InitResponse,
  PortfolioRow,
  StoreDashboardResponse,
  WarRoomResponse,
} from "./types";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated.");
  return { Authorization: `Bearer ${token}` };
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  let body: { ok?: boolean; message?: string } & Partial<T>;
  try {
    body = (await res.json()) as never;
  } catch {
    throw new Error(`Ranker API ${res.status} (non-JSON response)`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || `Ranker API ${res.status}`);
  }
  return body as T;
}

export function fetchInit(): Promise<InitResponse> {
  return fetchJson<InitResponse>(
    "/.netlify/functions/ranker?action=getInit",
  );
}

export function fetchWarRoom(week: string): Promise<WarRoomResponse> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getWarRoom");
  u.searchParams.set("week", week);
  return fetchJson<WarRoomResponse>(u.pathname + u.search);
}

export function fetchStoreDashboard(args: {
  week: string;
  store: string;
  peerStore?: string;
  trendWeeks: number;
}): Promise<StoreDashboardResponse> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getStoreDashboard");
  u.searchParams.set("week", args.week);
  u.searchParams.set("store", args.store);
  if (args.peerStore) u.searchParams.set("peerStore", args.peerStore);
  u.searchParams.set("trendWeeks", String(args.trendWeeks));
  return fetchJson<StoreDashboardResponse>(u.pathname + u.search);
}

export async function downloadRankerCsv(week: string): Promise<void> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getWarRoom");
  u.searchParams.set("week", week);
  const data = await fetchJson<WarRoomResponse>(u.pathname + u.search);

  const rows = data.portfolioRows ?? [];
  const header = [
    "Rank", "Store #", "Store Name", "GM", "Weekly Sales", "vs LY %",
    "Labor %", "VOG Week", "VOG Count", "Complaints", "Calls/10k",
    "Var to Chart", "Rank Change", "Ann. FC Miss",
  ];
  const toRow = (r: PortfolioRow) => [
    r.storeRank ?? "",
    r.store,
    r.storeName ?? "",
    r.gmName ?? "",
    r.weeklySales != null ? (r.weeklySales / 100).toFixed(2) : "",
    r.vsLastYear != null ? r.vsLastYear.toFixed(2) : "",
    r.laborPct != null ? r.laborPct.toFixed(2) : "",
    r.vogWeek ?? "",
    r.vogCount ?? "",
    r.complaints ?? "",
    r.callsPer10k != null ? r.callsPer10k.toFixed(2) : "",
    r.varToChart != null ? r.varToChart.toFixed(2) : "",
    r.rankChange ?? "",
    r.annualizedFcMiss != null ? r.annualizedFcMiss.toFixed(2) : "",
  ];

  const csv = [header, ...rows.map(toRow)]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ranker-week-${week}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

export function generateAISummary(args: {
  store: string;
  week: number;
  force?: boolean;
}): Promise<AISummaryResponse> {
  return fetchJson<AISummaryResponse>(
    "/.netlify/functions/ranker-summary",
    {
      method: "POST",
      body: JSON.stringify({
        store: args.store,
        week: args.week,
        force: !!args.force,
      }),
    },
  );
}
