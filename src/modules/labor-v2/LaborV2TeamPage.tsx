// /labor-v2/team — leadership labor rollup, scoped to the caller's org
// (DO → district, SDO → market/area, RVP → region). District / Market / Region
// level tabs, scope tiles, and a Groups / By-store list with the notes-to-review
// status workflow. Data: labor_v2_daily + labor_reviews via the labor-v2 fn.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, Clock } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchLaborV2Team } from "./api";
import type { TeamBand, TeamDisplayLevel, TeamGroup, TeamStore } from "./types";

const fmtPctPts = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtSignedUSD0 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const fmtSignedHrs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtHrs = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";

const overTone = (over: boolean | null) => (over == null ? "text-zinc-500" : over ? "text-red-600" : "text-emerald-600");
const isOver = (b: TeamBand | null | undefined) => (b?.status === "over" ? true : b?.status === "on" ? false : null);

const LEVEL_ORDER: TeamDisplayLevel[] = ["region", "area", "district", "store"];
const LEVEL_LABEL: Record<TeamDisplayLevel, string> = { region: "Region", area: "Market", district: "District", store: "Stores" };
const childOf = (l: TeamDisplayLevel): TeamDisplayLevel | null => LEVEL_ORDER[LEVEL_ORDER.indexOf(l) + 1] ?? null;

type Filter = "all" | "over" | "due";
type SortKey = "name" | "day" | "wtd" | "ptd" | "var" | "over" | "hrsover" | "sched" | "actual" | "ot" | "actsch" | "status";

const STATUS_RANK: Record<string, number> = { over: 3, unknown: 2, on: 1, missing: 0 };

// Sort accessor shared by group rows and store rows (both carry day/wtd/ptd
// bands and a status).
function sortVal(r: TeamGroup | TeamStore, k: SortKey): number | string {
  const label = "store_number" in r ? String(r.store_number) : r.name;
  const status = "status" in r ? r.status : r.day.status;
  switch (k) {
    case "name": return label.toLowerCase();
    case "day": return r.day.labor_pct ?? -Infinity;
    case "wtd": return r.wtd.labor_pct ?? -Infinity;
    case "ptd": return r.ptd.labor_pct ?? -Infinity;
    case "var": return r.day.variance_pts ?? -Infinity;
    case "over": return r.day.dollars_over_chart ?? -Infinity;
    case "hrsover": return r.day.hours_over_chart ?? -Infinity;
    case "sched": return r.day.scheduled_hours ?? -Infinity;
    case "actual": return r.day.actual_hours ?? -Infinity;
    case "ot": return r.day.overtime_hours ?? -Infinity;
    case "actsch": return r.day.act_vs_sched ?? -Infinity;
    case "status": return STATUS_RANK[status] ?? 0;
  }
}

export function LaborV2TeamPage() {
  const [baseLevel, setBaseLevel] = useState<TeamDisplayLevel | null>(null);
  const [path, setPath] = useState<{ level: TeamDisplayLevel; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "var", dir: "desc" });

  const q = useQuery({ queryKey: ["labor-v2-team"], queryFn: () => fetchLaborV2Team(), staleTime: 5 * 60_000 });
  const data = q.data;
  const t = data?.totals ?? null;

  const startLevel: TeamDisplayLevel = baseLevel ?? data?.startLevel ?? "district";
  const displayLevel: TeamDisplayLevel = path.length ? (childOf(path[path.length - 1].level) ?? "store") : startLevel;
  const isStore = displayLevel === "store";

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }
  function selectLevel(l: TeamDisplayLevel) { setBaseLevel(l); setPath([]); setFilter("all"); }
  function drillInto(name: string) { if (!childOf(displayLevel)) return; setPath((p) => [...p, { level: displayLevel, name }]); setFilter("all"); }

  const matchesPath = (r: TeamGroup | TeamStore) => path.every((c) => (r as unknown as Record<string, unknown>)[c.level] === c.name);

  const scopedStores = useMemo(() => (data?.levels.store ?? []).filter(matchesPath), [data, path]);
  const overCount = scopedStores.filter((s) => s.status === "over").length;
  const dueCount = scopedStores.filter((s) => s.note_due).length;

  const rows = useMemo(() => {
    const src: (TeamGroup | TeamStore)[] = isStore ? (data?.levels.store ?? []) : (data?.levels[displayLevel as "region" | "area" | "district"] ?? []);
    let r = src.filter(matchesPath);
    if (isStore) {
      if (filter === "over") r = (r as TeamStore[]).filter((s) => s.status === "over");
      if (filter === "due") r = (r as TeamStore[]).filter((s) => s.note_due);
    }
    return [...r].sort((a, b) => {
      const av = sortVal(a, sort.key), bv = sortVal(b, sort.key);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, displayLevel, path, filter, sort, isStore]);

  const levelTabs: TeamDisplayLevel[] = data
    ? [...(["region", "area", "district"] as const).filter((lv) => data.levels[lv].length > 0), "store"]
    : [];
  const nameHeader = LEVEL_LABEL[displayLevel] === "Stores" ? "Store" : LEVEL_LABEL[displayLevel];

  return (
    <>
      <PageHeader
        title="Team labor"
        description={data?.date ? `${fmtDate(data.date)} · ${data.scope.stores} stores rolled up${data.scope.dos.length ? ` · ${data.scope.dos.length} DO${data.scope.dos.length === 1 ? "" : "s"}` : ""}` : "Labor rollup for your stores"}
        actions={
          t && t.notesDue > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sonic-50 px-3 py-1.5 text-xs font-semibold text-sonic-700">
              <Clock className="h-3.5 w-3.5" />
              {t.notesDue} {t.notesDue === 1 ? "note" : "notes"} to review
            </span>
          ) : undefined
        }
      />

      {/* Level tabs (jump) — drill into a row to go deeper */}
      {levelTabs.length > 0 && (
        <div className="mb-4 inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
          {levelTabs.map((lv) => (
            <button key={lv} onClick={() => selectLevel(lv)}
              className={cn("px-4 py-1.5 text-sm font-semibold transition first:rounded-l-md last:rounded-r-md",
                !path.length && displayLevel === lv ? "bg-accent text-white" : "text-zinc-600 hover:bg-zinc-50")}>
              {LEVEL_LABEL[lv]}
            </button>
          ))}
        </div>
      )}

      {q.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load team labor" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !t ? (
        <EmptyState title="No labor data yet" description="No labor captured for your stores yet. Data appears after the next capture (7/9/11 AM CT)." />
      ) : (
        <div className="space-y-5">
          {/* Tiles (whole scope) */}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Labor % · Day" value={fmtPctPts(t.day.labor_pct)} sub={`avg across ${data!.scope.stores} stores`} tone={overTone(isOver(t.day))} />
            <Tile label="WTD Labor %" value={fmtPctPts(t.wtd.labor_pct)} sub={t.wtd.dollars_over_chart ? `${fmtSignedUSD0(t.wtd.dollars_over_chart)} over chart` : "week-to-date"} tone={overTone(isOver(t.wtd))} />
            <Tile label="PTD Labor %" value={fmtPctPts(t.ptd.labor_pct)} sub={t.ptd.dollars_over_chart ? `${fmtSignedUSD0(t.ptd.dollars_over_chart)} over · PTD` : "period-to-date"} tone={overTone(isOver(t.ptd))} />
            <Tile label="Stores Over Chart" value={`${t.storesOver} / ${data!.scope.stores}`} sub={`${data!.scope.stores - t.storesOver} on or under`} tone={overTone(t.storesOver > 0)} />
            <Tile label="Notes to Review" value={String(t.notesDue)} sub={`${t.notesExplained} already explained`} />
            <Tile label="$ Over Chart · Day" value={fmtSignedUSD0(t.day.dollars_over_chart)} sub={`${fmtSignedHrs(t.day.hours_over_chart)} hrs`} tone={overTone((t.day.dollars_over_chart ?? 0) > 0)} />
          </div>

          {/* List */}
          <div className="rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-4">
              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <button onClick={() => setPath([])} className={cn(path.length ? "font-medium text-accent hover:underline" : "font-semibold text-midnight")}>{LEVEL_LABEL[startLevel]}</button>
                {path.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
                    <button onClick={() => setPath(path.slice(0, i + 1))}
                      className={cn(i === path.length - 1 ? "font-semibold text-midnight dark:text-night-ink" : "text-accent hover:underline")}>
                      {c.name}
                    </button>
                  </span>
                ))}
              </div>
              {isStore && (
                <Chips value={filter} onChange={setFilter} options={[
                  { value: "all", label: `All ${scopedStores.length}` },
                  { value: "over", label: `Over ${overCount}`, dot: "bg-red-500" },
                  { value: "due", label: `Due ${dueCount}`, dot: "bg-amber-500" },
                ]} />
              )}
            </div>

            <div className="hidden items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 sm:flex">
              <SortTh label={nameHeader} k="name" sort={sort} onSort={toggleSort} className="min-w-0 flex-1 justify-start" />
              <SortTh label="Day %" k="day" sort={sort} onSort={toggleSort} className="w-16" />
              <SortTh label="WTD %" k="wtd" sort={sort} onSort={toggleSort} className="hidden w-14 lg:flex" />
              <SortTh label="PTD %" k="ptd" sort={sort} onSort={toggleSort} className="hidden w-14 lg:flex" />
              <SortTh label="Var" k="var" sort={sort} onSort={toggleSort} className="w-14" />
              <SortTh label="$ Over" k="over" sort={sort} onSort={toggleSort} className="w-20" />
              <SortTh label="Hrs Over" k="hrsover" sort={sort} onSort={toggleSort} className="w-14" />
              <SortTh label="Sched" k="sched" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="Actual" k="actual" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="OT" k="ot" sort={sort} onSort={toggleSort} className="hidden w-14 xl:flex" />
              <SortTh label="Act−Sch" k="actsch" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="Status" k="status" sort={sort} onSort={toggleSort} className="ml-2 w-[92px]" />
            </div>

            <div className="divide-y divide-zinc-100">
              {rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">{isStore ? "No stores match this filter." : "Nothing here yet."}</div>
              ) : isStore ? (
                (rows as TeamStore[]).map((s) => <StoreRow key={s.store_number} s={s} />)
              ) : (
                (rows as TeamGroup[]).map((g) => <GroupRow key={g.name} g={g} onDrill={() => drillInto(g.name)} />)
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums tracking-tight text-midnight dark:text-night-ink", tone)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function SortTh({ label, k, sort, onSort, className }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = sort.key === k;
  return (
    <button onClick={() => onSort(k)} className={cn("inline-flex items-center justify-end gap-1 text-right uppercase tracking-wide hover:text-zinc-600", active && "text-accent", className)}>
      {label}
      {active && (sort.dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
    </button>
  );
}

function HoursCells({ band }: { band: TeamBand }) {
  return (
    <>
      <span className="hidden w-16 text-right text-xs tabular-nums text-zinc-500 xl:block">{fmtHrs(band.scheduled_hours)}</span>
      <span className="hidden w-16 text-right text-xs tabular-nums text-zinc-500 xl:block">{fmtHrs(band.actual_hours)}</span>
      <span className={cn("hidden w-14 text-right text-xs tabular-nums xl:block", band.overtime_hours ? "font-semibold text-amber-600" : "text-zinc-500")}>{fmtHrs(band.overtime_hours)}</span>
      <span className={cn("hidden w-16 text-right text-xs tabular-nums xl:block", (band.act_vs_sched ?? 0) > 0 ? "text-red-600" : "text-emerald-600")}>{fmtSignedHrs(band.act_vs_sched)}</span>
    </>
  );
}

function GroupRow({ g, onDrill }: { g: TeamGroup; onDrill: () => void }) {
  const over = g.day.status === "over";
  return (
    <button onClick={onDrill} className="flex w-full items-center gap-3 p-4 text-left hover:bg-zinc-50">
      <span className={cn("h-10 w-1 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-midnight dark:text-night-ink">
          {g.name}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
        </div>
        <div className="truncate text-xs text-zinc-500">{g.leader || "—"} · {g.storeCount} store{g.storeCount === 1 ? "" : "s"}</div>
      </div>
      <span className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPctPts(g.day.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(g.wtd.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(g.ptd.labor_pct)}</span>
      <span className={cn("w-14 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtPts(g.day.variance_pts)}</span>
      <span className={cn("w-20 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtSignedUSD0(g.day.dollars_over_chart)}</span>
      <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{fmtSignedHrs(g.day.hours_over_chart)}</span>
      <HoursCells band={g.day} />
      <span className="ml-2 w-[92px] text-right text-[11px] font-semibold tabular-nums text-zinc-500">
        {g.storesOver} over{g.notesDue ? ` · ${g.notesDue} due` : ""}
      </span>
    </button>
  );
}

function StoreRow({ s }: { s: TeamStore }) {
  const [open, setOpen] = useState(false);
  const over = s.status === "over";
  const label = s.note_due ? "Note due" : s.explained ? "Explained" : over ? "Over" : "On chart";
  const chip = s.note_due ? "bg-amber-50 text-amber-700" : s.explained ? "bg-accent-100 text-accent-700" : over ? "bg-sonic-50 text-sonic-700" : "bg-emerald-50 text-emerald-700";
  const dot = s.note_due ? "bg-amber-500" : s.explained ? "bg-accent" : over ? "bg-sonic" : "bg-emerald-500";
  return (
    <div>
      <button onClick={() => s.note && setOpen((o) => !o)} className={cn("flex w-full items-center gap-3 p-4 text-left", s.note && "hover:bg-zinc-50")}>
        <span className={cn("h-10 w-1 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-midnight dark:text-night-ink">#{s.store_number} · {s.store_name}</div>
          <div className="truncate text-xs text-zinc-500">
            {[s.gm_name ? `GM ${s.gm_name}` : null, s.do_name ? `DO ${s.do_name}` : null].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <span className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPctPts(s.day.labor_pct)}</span>
        <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(s.wtd.labor_pct)}</span>
        <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(s.ptd.labor_pct)}</span>
        <span className={cn("w-14 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtPts(s.day.variance_pts)}</span>
        <span className={cn("w-20 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtSignedUSD0(s.day.dollars_over_chart)}</span>
        <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{fmtSignedHrs(s.day.hours_over_chart)}</span>
        <HoursCells band={s.day} />
        <span className={cn("ml-2 inline-flex w-[92px] shrink-0 items-center justify-end gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
          {label}
        </span>
      </button>
      {open && s.note && <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-midnight">{s.note}</div>}
    </div>
  );
}

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; dot?: string }[] }) {
  return (
    <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium first:rounded-l-md last:rounded-r-md", value === o.value ? "bg-zinc-100 text-midnight" : "text-zinc-500 hover:bg-zinc-50")}>
          {o.dot && <span className={cn("h-1.5 w-1.5 rounded-full", o.dot)} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
