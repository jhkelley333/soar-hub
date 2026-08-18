// Shared Labor explorer modals — the "Table view" and "Week Trend" popups used
// by both the public shared sheet (/labor/:token) and the authenticated hub Team
// view. Parameterized by a week fetcher so the Team view can drive them off the
// caller's visible stores while the share link drives them off its token.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShareBand, ShareNode, SharedLaborWeekResponse, WeekDay, WeekNode } from "./api";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtVar = (v: number | null) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtAvs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}h`);
const fmtOverUsd = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtHrsOver = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);

const CHAIN = ["region", "area", "district", "store"] as const;
export type Chain = (typeof CHAIN)[number];
const LEVEL_LABEL: Record<Chain, string> = { region: "RVP · Region", area: "SDO · Market", district: "DO · District", store: "Store" };

// A fetcher matching fetchSharedLaborWeek / fetchLaborFileWeek — the modal stays
// source-agnostic (token link vs. authenticated visible-stores scope).
export type WeekFetcher = (opts: {
  level: string; region?: string | null; area?: string | null; district?: string | null; weekOf?: string | null;
}) => Promise<SharedLaborWeekResponse>;

// ── Table view ───────────────────────────────────────────────────────
// Filterable table over the store rows for the current scope: set a minimum
// hours-over, pick a window to filter on, toggle which windows' columns show.
type Win = "daily" | "wtd" | "ptd";
const WIN_LABEL: Record<Win, string> = { daily: "Daily", wtd: "WTD", ptd: "PTD" };
const TABLE_METRICS: { key: keyof ShareBand; label: string; fmt: (v: number | null) => string }[] = [
  { key: "labor_pct", label: "Labor %", fmt: fmtPct },
  { key: "variance_pts", label: "Var", fmt: fmtVar },
  { key: "dollars_over", label: "$ Over", fmt: fmtOverUsd },
  { key: "hours_over", label: "Hrs Over", fmt: fmtHrsOver },
  { key: "act_vs_sched", label: "AvS", fmt: fmtAvs },
];

export function LaborTableModal({ stores, onClose }: { stores: ShareNode[]; onClose: () => void }) {
  // String-backed so mobile can clear + retype freely (a numeric state coerced
  // the empty field to 0 and blocked typing). Defaults to a 2-hour minimum.
  const [minInput, setMinInput] = useState("2");
  const minHrs = (() => { const n = Number.parseFloat(minInput); return Number.isFinite(n) ? n : 0; })();
  const [basis, setBasis] = useState<Win>("wtd");
  const [cols, setCols] = useState<Record<Win, boolean>>({ daily: true, wtd: true, ptd: true });
  const wins = (["daily", "wtd", "ptd"] as Win[]).filter((w) => cols[w]);
  // Sort: null falls back to the basis Hrs Over (worst first). Explicit sort is
  // "store" or "<win>:<metric>". Click a header to sort, click again to flip.
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const effSort = sort ?? { col: `${basis}:hours_over`, dir: -1 as 1 | -1 };
  const toggleSort = (col: string, defaultDir: 1 | -1 = -1) =>
    setSort((s) => {
      const cur = s ?? { col: `${basis}:hours_over`, dir: -1 as 1 | -1 };
      return cur.col === col ? { col, dir: cur.dir === 1 ? -1 : 1 } : { col, dir: defaultDir };
    });
  const sortMark = (col: string) => (effSort.col === col ? (effSort.dir === 1 ? " ▲" : " ▾") : "");

  const rows = useMemo(() => {
    const filtered = stores.filter((s) => (s[basis].hours_over ?? 0) >= minHrs).slice();
    if (effSort.col === "store") {
      return filtered.sort((a, b) => String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }) * effSort.dir);
    }
    const [win, key] = effSort.col.split(":") as [Win, keyof ShareBand];
    return filtered.sort((a, b) => {
      const av = a[win]?.[key], bv = b[win]?.[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // no-data rows sink to the bottom either way
      if (bv == null) return -1;
      return ((av as number) - (bv as number)) * effSort.dir;
    });
  }, [stores, basis, minHrs, effSort.col, effSort.dir]);

  const cellTone = (m: keyof ShareBand, b: ShareBand): string => {
    const v = m === "labor_pct" ? b.variance_pts : b[m];
    return (v ?? 0) > 0 ? "text-red-600" : "text-emerald-600";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-screen w-full flex-col bg-white shadow-xl sm:max-h-[90vh] sm:max-w-5xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 p-3">
          <div className="text-sm font-bold text-midnight">Labor table · {rows.length} store{rows.length === 1 ? "" : "s"} <span className="font-normal text-[11px] text-zinc-400">· tap a column to sort</span></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 p-3 text-xs">
          <label className="flex items-center gap-1.5 font-semibold text-zinc-600">
            Min hrs over
            <input type="text" inputMode="decimal" value={minInput} onChange={(e) => setMinInput(e.target.value)}
              className="w-16 rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-accent focus:outline-none" />
            <span className="font-normal text-zinc-400">on</span>
            <span className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-zinc-200">
              {(["daily", "wtd", "ptd"] as Win[]).map((w) => (
                <button key={w} type="button" onClick={() => setBasis(w)}
                  className={cn("px-2 py-1 font-semibold", basis === w ? "bg-accent text-white" : "bg-white text-zinc-500 hover:bg-zinc-50")}>
                  {WIN_LABEL[w]}
                </button>
              ))}
            </span>
          </label>
          <div className="flex items-center gap-2 font-semibold text-zinc-600">
            Columns:
            {(["daily", "wtd", "ptd"] as Win[]).map((w) => (
              <label key={w} className="flex items-center gap-1 font-normal">
                <input type="checkbox" checked={cols[w]} onChange={(e) => setCols((c) => ({ ...c, [w]: e.target.checked }))} className="h-3.5 w-3.5 accent-accent" />
                {WIN_LABEL[w]}
              </label>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-white shadow-sm">
              <tr className="text-[10px] uppercase tracking-wide text-zinc-400">
                <th rowSpan={2} onClick={() => toggleSort("store", 1)}
                  className="sticky left-0 z-10 cursor-pointer select-none bg-white px-3 py-1.5 text-left hover:text-zinc-600">
                  Store{sortMark("store")}
                </th>
                {wins.map((w) => (
                  <th key={w} colSpan={TABLE_METRICS.length} className="border-l border-zinc-100 bg-amber-50/60 px-2 py-1 text-center font-bold text-zinc-500">{WIN_LABEL[w]}</th>
                ))}
              </tr>
              <tr className="text-[9px] uppercase tracking-wide text-zinc-400">
                {wins.map((w) => TABLE_METRICS.map((m, i) => {
                  const col = `${w}:${m.key}`;
                  return (
                    <th key={`${w}-${m.key}`} onClick={() => toggleSort(col)}
                      className={cn("cursor-pointer select-none whitespace-nowrap px-2 py-1 text-right hover:text-zinc-600",
                        i === 0 && "border-l border-zinc-100", effSort.col === col && "font-bold text-midnight")}>
                      {m.label}{sortMark(col)}
                    </th>
                  );
                }))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {rows.length === 0 ? (
                <tr><td colSpan={1 + wins.length * TABLE_METRICS.length} className="p-8 text-center text-sm text-zinc-400">No stores match — lower the minimum.</td></tr>
              ) : rows.map((s) => (
                <tr key={s.store_number} className="hover:bg-zinc-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-semibold text-midnight">
                    #{s.store_number} <span className="font-normal text-zinc-500">{s.store_name}</span>
                  </td>
                  {wins.map((w) => TABLE_METRICS.map((m, i) => (
                    <td key={`${w}-${m.key}`} className={cn("px-2 py-1.5 text-right", i === 0 && "border-l border-zinc-100", cellTone(m.key, s[w]))}>
                      {m.fmt(s[w][m.key])}
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Week Trend ───────────────────────────────────────────────────────
// A Mon→Sun daily strip per node at the current level, plus the scope total,
// each day rolled up (the "average for each parent level").
function weekRangeLabel(mondayIso: string | null): string {
  if (!mondayIso) return "";
  const mon = new Date(`${mondayIso}T12:00:00`);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  const f = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(mon)} – ${f(sun)}`;
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function WeekTrendModal({ cacheKey, level, filter, weekFetcher, onClose }: {
  cacheKey: string;
  level: Chain;
  filter: { region: string | null; area: string | null; district: string | null };
  weekFetcher: WeekFetcher;
  onClose: () => void;
}) {
  // null weekOf = latest week; otherwise a Monday we've paged to.
  const [weekOf, setWeekOf] = useState<string | null>(null);
  // Expand each strip to show the week before it, for a direct WoW compare.
  const [showPrev, setShowPrev] = useState(false);

  const q = useQuery({
    queryKey: [cacheKey, level, filter.region, filter.area, filter.district, weekOf],
    queryFn: () => weekFetcher({ level, ...filter, weekOf }),
    staleTime: 60_000,
    retry: false,
  });
  const d = q.data;
  const prevStart = d?.week_start ? addDaysIso(d.week_start, -7) : null;

  // Previous week (one before the one on screen) — only fetched when expanded.
  const qPrev = useQuery({
    queryKey: [cacheKey, level, filter.region, filter.area, filter.district, "prev", prevStart],
    queryFn: () => weekFetcher({ level, ...filter, weekOf: prevStart }),
    enabled: showPrev && !!prevStart && !!d?.has_prev,
    staleTime: 60_000,
    retry: false,
  });
  const prevByName = useMemo(() => {
    const m = new Map<string, WeekNode>();
    if (qPrev.data) {
      if (qPrev.data.scope_total) m.set(qPrev.data.scope_total.name, qPrev.data.scope_total);
      for (const n of qPrev.data.nodes) m.set(n.name, n);
    }
    return m;
  }, [qPrev.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-screen w-full flex-col bg-white shadow-xl sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-midnight">Week trend · {LEVEL_LABEL[level].split(" · ")[0]} · daily labor %</div>
            <div className="text-[11px] text-zinc-500">{weekRangeLabel(d?.week_start ?? null)}{d && !d.has_next ? " · this week" : ""}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => prevStart && setWeekOf(prevStart)}
              disabled={!d?.has_prev}
              title="Previous week"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => d?.week_start && setWeekOf(addDaysIso(d.week_start, 7))}
              disabled={!d?.has_next}
              title="Next week"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="ml-1 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowPrev((v) => !v)}
            className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", showPrev ? "bg-midnight text-white ring-black/10" : "bg-white text-zinc-600 ring-zinc-200 hover:border-accent")}
          >
            {showPrev ? "Hide previous week" : "Compare previous week"}
          </button>
          {d?.has_next && (
            <button type="button" onClick={() => setWeekOf(null)} className="text-xs font-semibold text-accent hover:underline">
              Jump to this week
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {q.isLoading ? (
            <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>
          ) : q.isError || !d ? (
            <div className="py-8 text-center text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load."}</div>
          ) : (
            <>
              {d.scope_total && <WeekStrip node={d.scope_total} total prev={showPrev ? prevByName.get(d.scope_total.name) : undefined} prevLoading={showPrev && qPrev.isLoading} />}
              {d.nodes.map((n) => <WeekStrip key={n.name} node={n} prev={showPrev ? prevByName.get(n.name) : undefined} prevLoading={showPrev && qPrev.isLoading} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekStrip({ node, total, prev, prevLoading }: { node: WeekNode; total?: boolean; prev?: WeekNode; prevLoading?: boolean }) {
  return (
    <div className={cn("rounded-xl p-2.5 ring-1", total ? "bg-midnight text-white ring-black/10" : "bg-white ring-zinc-200")}>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span className={cn("truncate text-sm font-bold", total ? "text-white" : "text-midnight")}>{node.name}</span>
        {node.leader && <span className={cn("truncate text-xs", total ? "text-white/60" : "text-zinc-500")}>{node.leader}</span>}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {node.week.map((day) => <WeekCell key={day.date} day={day} onDark={total} />)}
      </div>
      {(prev || prevLoading) && (
        <div className={cn("mt-2 border-t pt-2", total ? "border-white/15" : "border-zinc-100")}>
          <div className={cn("mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide", total ? "text-white/50" : "text-zinc-400")}>Previous week</div>
          {prev ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {prev.week.map((day) => <WeekCell key={day.date} day={day} onDark={total} />)}
            </div>
          ) : (
            <div className={cn("px-1 pb-1 text-[11px]", total ? "text-white/40" : "text-zinc-400")}>Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}

function WeekCell({ day, onDark }: { day: WeekDay; onDark?: boolean }) {
  const dt = new Date(`${day.date}T12:00:00`);
  const wd = dt.toLocaleDateString("en-US", { weekday: "short" });
  const dom = dt.getDate();
  if (day.status === "future" || day.status === "missing") {
    return (
      <div className={cn("min-w-[58px] shrink-0 rounded-lg px-2 py-1.5 text-center ring-1", onDark ? "bg-white/5 ring-white/10" : "bg-zinc-50 ring-zinc-100")}>
        <div className={cn("text-[11px] font-semibold", onDark ? "text-white/70" : "text-zinc-500")}>{wd}</div>
        <div className={cn("text-[10px]", onDark ? "text-white/40" : "text-zinc-400")}>{dom}</div>
        <div className={cn("mt-1 text-sm", onDark ? "text-white/30" : "text-zinc-300")}>—</div>
      </div>
    );
  }
  const over = day.status === "over";
  const pctCls = onDark ? (over ? "text-red-300" : "text-emerald-300") : (over ? "text-red-600" : "text-emerald-600");
  return (
    <div className={cn("min-w-[58px] shrink-0 rounded-lg px-2 py-1.5 text-center ring-1", onDark ? "bg-white/10 ring-white/10" : over ? "bg-red-50/40 ring-red-100" : "bg-zinc-50 ring-zinc-100")}>
      <div className="flex items-center justify-center gap-1">
        <span className={cn("text-[11px] font-semibold", onDark ? "text-white/80" : "text-zinc-600")}>{wd}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", over ? "bg-red-500" : "bg-emerald-500")} />
      </div>
      <div className={cn("text-[10px]", onDark ? "text-white/50" : "text-zinc-400")}>{dom}</div>
      <div className={cn("mt-0.5 text-sm font-bold tabular-nums", pctCls)}>{fmtPct(day.labor_pct)}</div>
      {(day.hours_over ?? 0) > 0 && (
        <div className={cn("text-[10px] tabular-nums", onDark ? "text-red-300" : "text-red-600")}>+{day.hours_over!.toFixed(1)}h</div>
      )}
      {day.wtd_pct != null && (
        <div className={cn("mt-0.5 text-[9px] tabular-nums", onDark ? "text-white/50" : "text-zinc-400")}>WTD {fmtPct(day.wtd_pct)}</div>
      )}
    </div>
  );
}
