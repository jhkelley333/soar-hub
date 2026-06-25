// /labor-v2/team — leadership labor rollup, scoped to the caller's org
// (DO → district, SDO → market/area, RVP → region). District / Market / Region
// level tabs, scope tiles, and a Groups / By-store list with the notes-to-review
// status workflow. Data: labor_v2_daily + labor_reviews via the labor-v2 fn.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Clock, Copy, Share2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchLaborV2Team } from "./api";
import type { LaborPeriod, TeamBand, TeamDisplayLevel, TeamGroup, TeamStore } from "./types";

const fmtPctPts = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtSignedUSD0 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const fmtSignedHrs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtRate2 = (v: number | null) => (v == null ? "—" : `+${v.toFixed(2)}`); // Hrs/Unit: per-store avg of over-stores, 2 dp (negatives hidden upstream)
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
  const toast = useToast();
  const [baseLevel, setBaseLevel] = useState<TeamDisplayLevel | null>(null);
  const [path, setPath] = useState<{ level: TeamDisplayLevel; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "var", dir: "desc" });
  const [period, setPeriod] = useState<LaborPeriod>("day"); // mobile cards: which period headlines
  const [shareDraft, setShareDraft] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["labor-v2-team"], queryFn: () => fetchLaborV2Team(), staleTime: 5 * 60_000 });
  const data = q.data;
  const t = data?.totals ?? null;
  const missing = data?.missing ?? [];

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

  // The drilled-into node's own rollup row (shown as a summary above its
  // children). Null at the top level — the tiles cover the whole scope there.
  const summary = useMemo<TeamGroup | null>(() => {
    if (!data || !path.length) return null;
    const lvl = path[path.length - 1].level as "region" | "area" | "district";
    return data.levels[lvl].find(matchesPath) ?? null;
  }, [data, path]);

  const levelTabs: TeamDisplayLevel[] = data
    ? [...(["region", "area", "district"] as const).filter((lv) => data.levels[lv].length > 0), "store"]
    : [];
  const nameHeader = LEVEL_LABEL[displayLevel] === "Stores" ? "Store" : LEVEL_LABEL[displayLevel];

  // Plain-text summary of the current scope + visible rows, for sharing to
  // WhatsApp (which only takes text). Reflects the active drill + sort.
  function buildShareText(): string {
    if (!data || !t) return "";
    const band = (b: TeamBand) => `${fmtPctPts(b.labor_pct)} (tgt ${fmtPctPts(b.target_pct)}, ${fmtPts(b.variance_pts)})`;
    const scope = path.length ? path.map((c) => c.name).join(" › ") : "All my stores";
    const out: string[] = [
      `*SOAR Labor — ${fmtDate(data.date)}*`,
      `Scope: ${scope} · ${data.scope.stores} stores`,
      "",
      `DAY  ${band(t.day)} · ${fmtSignedUSD0(t.day.dollars_over_chart)} over · ${fmtRate2(t.day.hours_over_chart)} hr/unit`,
      `WTD  ${band(t.wtd)} · ${fmtSignedUSD0(t.wtd.dollars_over_chart)} over`,
      `PTD  ${band(t.ptd)} · ${fmtSignedUSD0(t.ptd.dollars_over_chart)} over`,
      `Over chart: ${t.storesOver}/${data.scope.stores} stores · ${t.notesDue} notes due`,
    ];
    if (missing.length) out.push(`⚠ May be skewed — ${missing.length} store(s) not polled: ${missing.map((m) => `#${m.number}`).join(", ")}`);
    out.push("", `${LEVEL_LABEL[displayLevel]}:`);
    const cap = 25;
    rows.slice(0, cap).forEach((r, i) => {
      const name = "store_number" in r ? `${r.store_number} ${r.store_name}` : r.name;
      out.push(`${i + 1}. ${name} — ${fmtPctPts(r.day.labor_pct)} (${fmtPts(r.day.variance_pts)}) ${fmtSignedUSD0(r.day.dollars_over_chart)}`);
    });
    if (rows.length > cap) out.push(`…and ${rows.length - cap} more`);
    return out.join("\n");
  }
  function openShare() { setShareDraft(buildShareText()); }
  function shareToWhatsApp() {
    if (shareDraft == null) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareDraft)}`, "_blank", "noopener");
  }
  async function copyShare() {
    if (shareDraft == null) return;
    try { await navigator.clipboard.writeText(shareDraft); toast.push("Copied to clipboard.", "success"); }
    catch { toast.push("Couldn't copy — select the text and copy manually.", "error"); }
  }

  return (
    <>
      <PageHeader
        title="Team labor"
        description={data?.date ? `${fmtDate(data.date)} · ${data.scope.stores} stores rolled up${data.scope.dos.length ? ` · ${data.scope.dos.length} DO${data.scope.dos.length === 1 ? "" : "s"}` : ""}` : "Labor rollup for your stores"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {t && t.notesDue > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sonic-50 px-3 py-1.5 text-xs font-semibold text-sonic-700">
                <Clock className="h-3.5 w-3.5" />
                {t.notesDue} {t.notesDue === 1 ? "note" : "notes"} to review
              </span>
            )}
            {t && (
              <Button variant="secondary" size="sm" onClick={openShare}>
                <Share2 className="mr-1 h-3.5 w-3.5" /> Share
              </Button>
            )}
          </div>
        }
      />

      <Modal open={shareDraft != null} onClose={() => setShareDraft(null)} title="Share labor to WhatsApp"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={copyShare}><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
            <Button size="sm" onClick={shareToWhatsApp}><Share2 className="mr-1 h-3.5 w-3.5" /> Open WhatsApp</Button>
          </>
        }>
        <p className="mb-2 text-xs text-zinc-500">Edit if you like, then open WhatsApp to pick a chat — or copy the text.</p>
        <textarea
          value={shareDraft ?? ""}
          onChange={(e) => setShareDraft(e.target.value)}
          rows={14}
          className="w-full resize-y rounded-lg border-0 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </Modal>

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

      {missing.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 text-sm text-amber-800">
            <p className="font-semibold">Numbers may be skewed — {missing.length} store{missing.length === 1 ? "" : "s"} had no Expressway polling for this day.</p>
            <p className="mt-1 break-words text-xs text-amber-700">{missing.map((m) => `#${m.number} ${m.name}`).join(" · ")}</p>
          </div>
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
            <Tile label="$ Over Chart · Day" value={fmtSignedUSD0(t.day.dollars_over_chart)} sub={`${fmtRate2(t.day.hours_over_chart)} hr/unit`} tone={overTone((t.day.dollars_over_chart ?? 0) > 0)} />
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

            {/* Mobile controls: period + sort (the table header is desktop-only) */}
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 lg:hidden">
              <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200 text-xs">
                {(["day", "wtd", "ptd"] as LaborPeriod[]).map((p) => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={cn("px-3 py-1 font-semibold uppercase first:rounded-l-md last:rounded-r-md", period === p ? "bg-accent text-white" : "text-zinc-500")}>
                    {p === "day" ? "Day" : p.toUpperCase()}
                  </button>
                ))}
              </div>
              <select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: dir as "asc" | "desc" }); }}
                className="h-7 rounded-md border-0 bg-zinc-50 px-2 text-xs text-zinc-700 ring-1 ring-inset ring-zinc-200 focus:outline-none"
              >
                <option value="var:desc">Variance ↓</option>
                <option value="day:desc">Labor % ↓</option>
                <option value="over:desc">$ Over ↓</option>
                <option value="hrsover:desc">Hrs/Unit ↓</option>
                <option value="name:asc">Name ↑</option>
              </select>
            </div>

            <div className="hidden items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 lg:flex">
              <SortTh label={nameHeader} k="name" sort={sort} onSort={toggleSort} className="min-w-0 flex-1 justify-start" />
              <SortTh label="Day %" k="day" sort={sort} onSort={toggleSort} className="w-16" />
              <SortTh label="WTD %" k="wtd" sort={sort} onSort={toggleSort} className="hidden w-14 lg:flex" />
              <SortTh label="PTD %" k="ptd" sort={sort} onSort={toggleSort} className="hidden w-14 lg:flex" />
              <SortTh label="Var" k="var" sort={sort} onSort={toggleSort} className="w-14" />
              <SortTh label="$ Over" k="over" sort={sort} onSort={toggleSort} className="w-20" />
              <SortTh label="Hrs/Unit" k="hrsover" sort={sort} onSort={toggleSort} className="w-14" />
              <SortTh label="Sched" k="sched" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="Actual" k="actual" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="OT" k="ot" sort={sort} onSort={toggleSort} className="hidden w-14 xl:flex" />
              <SortTh label="Act−Sch" k="actsch" sort={sort} onSort={toggleSort} className="hidden w-16 xl:flex" />
              <SortTh label="Status" k="status" sort={sort} onSort={toggleSort} className="ml-2 w-[92px]" />
            </div>

            {/* Desktop table */}
            <div className="hidden divide-y divide-zinc-100 lg:block">
              {summary && (
                <SummaryRow name={summary.name} leader={summary.leader} storeCount={summary.storeCount} storesOver={summary.storesOver} notesDue={summary.notesDue} r={summary} />
              )}
              {rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">{isStore ? "No stores match this filter." : "Nothing here yet."}</div>
              ) : isStore ? (
                (rows as TeamStore[]).map((s) => <StoreRow key={s.store_number} s={s} />)
              ) : (
                (rows as TeamGroup[]).map((g) => <GroupRow key={g.name} g={g} onDrill={() => drillInto(g.name)} />)
              )}
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 p-3 lg:hidden">
              {summary && <MobileRow row={summary} isStore={false} period={period} summary />}
              {rows.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500">{isStore ? "No stores match this filter." : "Nothing here yet."}</div>
              ) : isStore ? (
                (rows as TeamStore[]).map((s) => <MobileRow key={s.store_number} row={s} isStore period={period} />)
              ) : (
                (rows as TeamGroup[]).map((g) => <MobileRow key={g.name} row={g} isStore={false} period={period} onDrill={() => drillInto(g.name)} />)
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

// The right-aligned metric columns (Day/WTD/PTD %, Var, $ Over, Hrs/Unit, then
// Sched/Actual/OT/Act−Sch), shared by group, store, and summary rows.
function BandCells({ r }: { r: { day: TeamBand; wtd: TeamBand; ptd: TeamBand } }) {
  const over = r.day.status === "over";
  return (
    <>
      <span className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPctPts(r.day.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(r.wtd.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(r.ptd.labor_pct)}</span>
      <span className={cn("w-14 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtPts(r.day.variance_pts)}</span>
      <span className={cn("w-20 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtSignedUSD0(r.day.dollars_over_chart)}</span>
      <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{fmtRate2(r.day.hours_over_chart)}</span>
      <HoursCells band={r.day} />
    </>
  );
}

// A non-clickable "total" row for the current scope (whole org at root, or the
// drilled node), shown above its children.
function SummaryRow({ name, leader, storeCount, storesOver, notesDue, r }: {
  name: string; leader: string | null; storeCount: number; storesOver: number; notesDue: number; r: { day: TeamBand; wtd: TeamBand; ptd: TeamBand };
}) {
  return (
    <div className="flex items-center gap-3 border-b-2 border-zinc-200 bg-zinc-50/70 px-4 py-3">
      <span className="h-10 w-1 rounded-full bg-transparent" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-midnight dark:text-night-ink">{name}</div>
        <div className="truncate text-xs text-zinc-500">{leader ? `${leader} · ` : ""}{storeCount} store{storeCount === 1 ? "" : "s"}</div>
      </div>
      <BandCells r={r} />
      <span className="ml-2 w-[92px] text-right text-[11px] font-semibold tabular-nums text-zinc-500">{storesOver} over{notesDue ? ` · ${notesDue} due` : ""}</span>
    </div>
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

function MobileMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("truncate text-sm font-semibold tabular-nums text-midnight dark:text-night-ink", tone)}>{value}</div>
    </div>
  );
}

// Responsive card for a group / store / summary on phones + tablets.
function MobileRow({ row, isStore, period, summary, onDrill }: {
  row: TeamGroup | TeamStore; isStore: boolean; period: LaborPeriod; summary?: boolean; onDrill?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const b = row[period];
  const over = b.status === "over";
  const store = isStore ? (row as TeamStore) : null;
  const grp = isStore ? null : (row as TeamGroup);
  const name = store ? `#${store.store_number} ${store.store_name}` : grp!.name;
  const sub = store
    ? [store.gm_name ? `GM ${store.gm_name}` : null, store.do_name ? `DO ${store.do_name}` : null].filter(Boolean).join(" · ") || "—"
    : `${grp!.leader || "—"} · ${grp!.storeCount} store${grp!.storeCount === 1 ? "" : "s"}`;
  const tap = summary ? undefined : isStore ? () => store!.note && setOpen((o) => !o) : onDrill;

  const statusLabel = store ? (store.note_due ? "Note due" : store.explained ? "Explained" : over ? "Over" : "On chart") : null;
  const statusCls = store?.note_due ? "bg-amber-50 text-amber-700" : store?.explained ? "bg-accent-100 text-accent-700" : over ? "bg-sonic-50 text-sonic-700" : "bg-emerald-50 text-emerald-700";

  return (
    <div className={cn("overflow-hidden rounded-xl ring-1", summary ? "bg-zinc-50 ring-zinc-300" : "bg-white ring-zinc-200", over && !summary && "ring-red-200")}>
      <button onClick={tap} className={cn("flex w-full items-start gap-3 p-3.5 text-left", tap && "active:bg-zinc-50")}>
        <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-midnight dark:text-night-ink">
            <span className="truncate">{name}</span>
            {grp && !summary && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{sub}</div>
          <div className="mt-1.5">
            {store
              ? <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusCls)}>{statusLabel}</span>
              : <span className="text-[11px] font-semibold text-zinc-500">{grp!.storesOver} over{grp!.notesDue ? ` · ${grp!.notesDue} due` : ""}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-2xl font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPctPts(b.labor_pct)}</div>
          <div className="text-[11px] text-zinc-400">tgt {fmtPctPts(b.target_pct)} · {fmtPts(b.variance_pts)}</div>
        </div>
      </button>
      <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 px-3.5 py-2">
        <MobileMetric label="$ Over" value={fmtSignedUSD0(b.dollars_over_chart)} tone={over ? "text-red-700" : undefined} />
        <MobileMetric label="Hrs/Unit" value={fmtRate2(b.hours_over_chart)} />
        <MobileMetric label="Sched→Act" value={`${fmtHrs(b.scheduled_hours)}→${fmtHrs(b.actual_hours)}`} />
      </div>
      {store && open && store.note && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-3.5 py-2.5">
          <div className="grid grid-cols-3 gap-2">
            <MobileMetric label="WTD %" value={fmtPctPts(store.wtd.labor_pct)} />
            <MobileMetric label="PTD %" value={fmtPctPts(store.ptd.labor_pct)} />
            <MobileMetric label="OT hrs" value={fmtHrs(b.overtime_hours)} />
          </div>
          <div className="mt-2 rounded-lg bg-white p-2 text-xs text-zinc-600 ring-1 ring-zinc-200">{store.note}</div>
        </div>
      )}
    </div>
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
      <BandCells r={g} />
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
        <BandCells r={s} />
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
