// Ranker — client-side fetch wrappers. Each call injects the caller's
// Supabase access token in the Authorization header so the netlify
// function can verify the JWT and look up the profile + scope.

import { supabase } from "@/lib/supabase";
import type {
  AISummaryResponse,
  InitResponse,
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

export function fetchWarRoom(week: string, scopeFilter: "all" | "mine" = "mine"): Promise<WarRoomResponse> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getWarRoom");
  u.searchParams.set("week", week);
  u.searchParams.set("scopeFilter", scopeFilter);
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

export async function downloadRankerCsv(week: string, scopeFilter: "all" | "mine" = "mine"): Promise<void> {
  const u = new URL("/.netlify/functions/ranker", window.location.origin);
  u.searchParams.set("action", "getWarRoom");
  u.searchParams.set("week", week);
  u.searchParams.set("scopeFilter", scopeFilter);
  const data = await fetchJson<import("./types").WarRoomResponse>(u.pathname + u.search);

  const rows = data.portfolioRows ?? [];
  const header = [
    "Rank", "Store #", "Store Name", "GM", "Weekly Sales", "vs LY %",
    "Labor %", "VOG Week", "VOG Count", "Complaints", "Calls/10k",
    "Var to Chart", "Rank Change", "Ann. FC Miss",
  ];
  const toRow = (r: import("./types").PortfolioRow) => [
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

export async function downloadStoreExcel(args: {
  week: string;
  store: string;
  peerStore?: string;
}): Promise<void> {
  const [XLSX, data] = await Promise.all([
    import("xlsx"),
    fetchStoreDashboard({ week: args.week, store: args.store, peerStore: args.peerStore, trendWeeks: 8 }),
  ]);

  const wb = XLSX.utils.book_new();
  const m = (data.metrics ?? {}) as Record<string, unknown>;
  const pm = (data.priorMetrics ?? {}) as Record<string, unknown>;
  const fmt = (v: unknown) =>
    v == null ? "" : typeof v === "number" ? Number(v.toFixed(4)) : String(v);

  const scorecard: unknown[][] = [
    ["Store", data.store, "", "GM", m.gmName ?? ""],
    ["Week", data.week, "", "Rank", m.storeRank ?? ""],
    [],
    ["Metric", "Current Week", "Prior Week"],
    ["Weekly Sales ($)", fmt(m.weeklySales), fmt(pm.weeklySales)],
    ["vs Last Year (%)", fmt(m.vsLastYear), fmt(pm.vsLastYear)],
    ["COGS Eff (%)", fmt(m.cogsEff), fmt(pm.cogsEff)],
    ["Labor (%)", fmt(m.laborPct), fmt(pm.laborPct)],
    ["Var to Chart", fmt(m.varToChart), fmt(pm.varToChart)],
    ["Annualized FC Miss ($)", fmt(m.annualizedFcMiss), fmt(pm.annualizedFcMiss)],
    ["BSC Training (%)", fmt(m.bscTraining), fmt(pm.bscTraining)],
    ["On-Time Tickets (%)", fmt(m.onTimeTickets), fmt(pm.onTimeTickets)],
    ["VOG Week", fmt(m.vogWeek), fmt(pm.vogWeek)],
    ["VOG Count", fmt(m.vogCount), fmt(pm.vogCount)],
    ["Complaints", fmt(m.complaints), fmt(pm.complaints)],
    ["Calls /10k", fmt(m.callsPer10k), fmt(pm.callsPer10k)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scorecard), "Scorecard");

  if (data.trends?.weeks && data.trends.seriesByMetric) {
    const { weeks, seriesByMetric } = data.trends;
    const trendRows: unknown[][] = [["Metric", ...weeks]];
    for (const [key, vals] of Object.entries(seriesByMetric)) {
      trendRows.push([key, ...(vals ?? []).map(fmt)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trendRows), "Trends");
  }

  XLSX.writeFile(wb, `ranker-${data.store}-week-${data.week}.xlsx`);
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
