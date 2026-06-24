// /labor-v2/team — leadership labor rollup, scoped to the caller's org
// (DO → district, SDO → market/area, RVP → region). District / Market / Region
// level tabs, scope tiles, and a Groups / By-store list with the notes-to-review
// status workflow. Data: labor_v2_daily + labor_reviews via the labor-v2 fn.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchLaborV2Team } from "./api";
import type { TeamBand, TeamGroup, TeamLevel, TeamStore } from "./types";

const fmtPctPts = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtSignedUSD0 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const fmtSignedHrs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";

const overTone = (over: boolean | null) => (over == null ? "text-zinc-500" : over ? "text-red-600" : "text-emerald-600");
const isOver = (b: TeamBand | null | undefined) => (b?.status === "over" ? true : b?.status === "on" ? false : null);

const LEVELS: { key: TeamLevel; label: string }[] = [
  { key: "district", label: "District" },
  { key: "area", label: "Market" },
  { key: "region", label: "Region" },
];

type View = "groups" | "stores";
type Filter = "all" | "over" | "due";
type Sort = "worst" | "labor" | "store";

export function LaborV2TeamPage() {
  const [level, setLevel] = useState<TeamLevel>("district");
  const [view, setView] = useState<View>("groups");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("worst");

  const q = useQuery({ queryKey: ["labor-v2-team", level], queryFn: () => fetchLaborV2Team(level), staleTime: 5 * 60_000 });
  const data = q.data;
  const t = data?.totals ?? null;

  const stores = useMemo(() => {
    let r = [...(data?.stores ?? [])];
    if (filter === "over") r = r.filter((s) => s.status === "over");
    if (filter === "due") r = r.filter((s) => s.note_due);
    if (sort === "worst") r.sort((a, b) => (b.day.variance_pts ?? -999) - (a.day.variance_pts ?? -999));
    if (sort === "labor") r.sort((a, b) => (b.day.labor_pct ?? -999) - (a.day.labor_pct ?? -999));
    if (sort === "store") r.sort((a, b) => String(a.store_number).localeCompare(String(b.store_number)));
    return r;
  }, [data?.stores, filter, sort]);

  const overCount = (data?.stores ?? []).filter((s) => s.status === "over").length;
  const dueCount = (data?.stores ?? []).filter((s) => s.note_due).length;
  const levelNoun = LEVELS.find((l) => l.key === level)?.label ?? "District";

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

      {/* Level tabs */}
      <div className="mb-4 inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
        {LEVELS.map((l) => (
          <button key={l.key} onClick={() => { setLevel(l.key); setView("groups"); }}
            className={cn("px-4 py-1.5 text-sm font-semibold transition first:rounded-l-md last:rounded-r-md",
              level === l.key ? "bg-accent text-white" : "text-zinc-600 hover:bg-zinc-50")}>
            {l.label}
          </button>
        ))}
      </div>

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
          {/* Tiles */}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={`${levelNoun} Labor % · Day`} value={fmtPctPts(t.day.labor_pct)} sub={`avg across ${data!.scope.stores} stores`} tone={overTone(isOver(t.day))} />
            <Tile label="WTD Labor %" value={fmtPctPts(t.wtd.labor_pct)} sub={t.wtd.dollars_over_chart ? `${fmtSignedUSD0(t.wtd.dollars_over_chart)} over chart` : "week-to-date"} tone={overTone(isOver(t.wtd))} />
            <Tile label="PTD Labor %" value={fmtPctPts(t.ptd.labor_pct)} sub={t.ptd.dollars_over_chart ? `${fmtSignedUSD0(t.ptd.dollars_over_chart)} over · PTD` : "period-to-date"} tone={overTone(isOver(t.ptd))} />
            <Tile label="Stores Over Chart" value={`${t.storesOver} / ${data!.scope.stores}`} sub={`${data!.scope.stores - t.storesOver} on or under`} tone={overTone(t.storesOver > 0)} />
            <Tile label="Notes to Review" value={String(t.notesDue)} sub={`${t.notesExplained} already explained`} />
            <Tile label="$ Over Chart · Day" value={fmtSignedUSD0(t.day.dollars_over_chart)} sub={`${fmtSignedHrs(t.day.hours_over_chart)} hrs`} tone={overTone((t.day.dollars_over_chart ?? 0) > 0)} />
          </div>

          {/* List */}
          <div className="rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-4">
              <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
                <button onClick={() => setView("groups")} className={cn("px-3.5 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md", view === "groups" ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50")}>{levelNoun}</button>
                <button onClick={() => setView("stores")} className={cn("px-3.5 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md", view === "stores" ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50")}>By store</button>
              </div>
              {view === "stores" && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Chips value={filter} onChange={setFilter} options={[
                    { value: "all", label: `All ${data!.stores.length}` },
                    { value: "over", label: `Over ${overCount}`, dot: "bg-red-500" },
                    { value: "due", label: `Due ${dueCount}`, dot: "bg-amber-500" },
                  ]} />
                  <Chips value={sort} onChange={setSort} options={[
                    { value: "worst", label: "worst first" },
                    { value: "labor", label: "labor %" },
                    { value: "store", label: "store" },
                  ]} />
                </div>
              )}
            </div>

            <div className="hidden items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 sm:flex">
              <span className="min-w-0 flex-1">{view === "groups" ? levelNoun : "Store"}</span>
              <span className="w-16 text-right">Day %</span>
              <span className="hidden w-14 text-right lg:block">WTD %</span>
              <span className="hidden w-14 text-right lg:block">PTD %</span>
              <span className="w-14 text-right">Var</span>
              <span className="w-20 text-right">$ Over</span>
              <span className="w-14 text-right">Hrs</span>
              <span className="ml-2 w-[92px] text-right">Status</span>
            </div>

            <div className="divide-y divide-zinc-100">
              {view === "groups"
                ? (data!.groups.length === 0
                    ? <Empty />
                    : data!.groups.map((g) => <GroupRow key={g.name} g={g} />))
                : (stores.length === 0
                    ? <div className="p-8 text-center text-sm text-zinc-500">No stores match this filter.</div>
                    : stores.map((s) => <StoreRow key={s.store_number} s={s} />))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Empty() {
  return <div className="p-8 text-center text-sm text-zinc-500">Nothing here yet.</div>;
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

function GroupRow({ g }: { g: TeamGroup }) {
  const over = g.day.status === "over";
  return (
    <div className="flex items-center gap-3 p-4">
      <span className={cn("h-10 w-1 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-midnight dark:text-night-ink">{g.name}</div>
        <div className="truncate text-xs text-zinc-500">{g.leader || "—"} · {g.storeCount} store{g.storeCount === 1 ? "" : "s"}</div>
      </div>
      <span className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPctPts(g.day.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(g.wtd.labor_pct)}</span>
      <span className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">{fmtPctPts(g.ptd.labor_pct)}</span>
      <span className={cn("w-14 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtPts(g.day.variance_pts)}</span>
      <span className={cn("w-20 text-right text-xs tabular-nums", over ? "text-red-700" : "text-zinc-500")}>{fmtSignedUSD0(g.day.dollars_over_chart)}</span>
      <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{fmtSignedHrs(g.day.hours_over_chart)}</span>
      <span className="ml-2 w-[92px] text-right text-[11px] font-semibold tabular-nums text-zinc-500">
        {g.storesOver} over{g.notesDue ? ` · ${g.notesDue} due` : ""}
      </span>
    </div>
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
