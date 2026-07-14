// Mobile-first drill-down for the ranking — built for a COO on a phone.
// Company → RVP → SDO → DO → Store, one tap per level, big thumb targets,
// score chips you read at a glance, and a store card that expands to the
// full detail. One fetchRankingFull call feeds every level.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchRankingFull, type FullRunScope, type RankScope, type RankingResultRow } from "./api";

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const fmtUSD = (v: unknown) => (isNum(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const fmtSignedPct = (v: unknown) =>
  isNum(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—";
const fmtPct1 = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : "—");
const fmtInt = (v: unknown) => (isNum(v) ? Math.round(v).toLocaleString("en-US") : "—");
const fmtNum1 = (v: unknown) => (isNum(v) ? v.toFixed(1) : typeof v === "string" ? v : "—");

const SCORE_BG: Record<number, string> = {
  1: "bg-red-600", 2: "bg-amber-500", 3: "bg-zinc-400", 4: "bg-emerald-500", 5: "bg-emerald-700",
};
function Chip({ label, v }: { label: string; v: unknown }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md font-mono text-sm font-bold text-white",
        isNum(v) ? SCORE_BG[v] ?? "bg-zinc-400" : "bg-zinc-200 !text-zinc-400")}>
        {isNum(v) ? v : "–"}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
    </div>
  );
}

type Level = "rvp" | "sdo" | "do" | "store";
const NEXT: Record<Level, Level | null> = { rvp: "sdo", sdo: "do", do: "store", store: null };
const PARENT_KEY: Record<Exclude<Level, "rvp">, string> = { sdo: "rvpName", do: "sdoName", store: "doName" };
const LEVEL_LABEL: Record<Level, string> = { rvp: "RVP", sdo: "SDO", do: "DO", store: "Store" };

export function RankingDrillView() {
  const [scope, setScope] = useState<RankScope>("ptd");
  const [path, setPath] = useState<{ level: Level; name: string }[]>([]);
  const [openStore, setOpenStore] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["ranking-drill", scope],
    queryFn: () => fetchRankingFull(null).then((r) => ({ run: r.run, data: r.scopes[scope] as FullRunScope })),
    staleTime: 60_000,
  });

  const run = q.data?.run ?? null;
  const data = q.data?.data;

  // Which level are we listing? Empty path → RVPs; else the child of the last.
  const level: Level = path.length ? (NEXT[path[path.length - 1].level] ?? "store") : "rvp";
  const parentName = path.length ? path[path.length - 1].name : null;

  const rows = useMemo(() => {
    if (!data) return [];
    const src = (data[level] ?? []) as RankingResultRow[];
    if (!parentName) return [...src].sort(byRank);
    const key = PARENT_KEY[level as Exclude<Level, "rvp">];
    return src.filter((r) => String(r.metrics[key] ?? "") === parentName).sort(byRank);
  }, [data, level, parentName]);

  // The drilled-into node's own summary row (its aggregate), shown up top.
  const summary = useMemo(() => {
    if (!data || !path.length) return data?.company?.[0] ?? null;
    const last = path[path.length - 1];
    const src = (data[last.level] ?? []) as RankingResultRow[];
    return src.find((r) => String(r.metrics.name ?? r.entity_key) === last.name) ?? null;
  }, [data, path]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!run || !data?.store?.length) {
    return <EmptyState title="No run yet" description="Run the ranking first — the drill-down reads the latest board." />;
  }

  const drillInto = (name: string) => { setPath((p) => [...p, { level, name }]); setOpenStore(null); };

  return (
    // Phone/PWA stays compact; the desktop drill gets progressively wider.
    <div className="mx-auto w-full max-w-lg space-y-3 md:max-w-2xl lg:max-w-4xl">
      {/* Scope + run */}
      <div className="flex items-center justify-between gap-2">
        <Segmented<RankScope> dense value={scope} onChange={(s) => { setScope(s); }}
          options={[{ value: "ptd", label: "Period" }, { value: "wtd", label: "Week" }]} />
        <span className="text-[11px] text-zinc-400">P{run.period}W{run.week}</span>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button onClick={() => { setPath([]); setOpenStore(null); }}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 font-semibold text-zinc-600">
          <Home className="h-3 w-3" /> Company
        </button>
        {path.map((c, i) => (
          <Fragment key={i}>
            <ChevronRight className="h-3 w-3 text-zinc-300" />
            <button onClick={() => { setPath((p) => p.slice(0, i + 1)); setOpenStore(null); }}
              className="rounded-full bg-zinc-100 px-2 py-1 font-semibold text-zinc-600">
              {c.name.length > 18 ? c.name.slice(0, 18) + "…" : c.name}
            </button>
          </Fragment>
        ))}
      </div>

      {/* Current node summary */}
      {summary && <SummaryCard row={summary} label={path.length ? LEVEL_LABEL[path[path.length - 1].level] : "Company"} />}

      {/* Back + level heading */}
      {path.length > 0 && (
        <button onClick={() => { setPath((p) => p.slice(0, -1)); setOpenStore(null); }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </button>
      )}
      <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
        {rows.length} {LEVEL_LABEL[level]}{rows.length === 1 ? "" : "s"}{level !== "rvp" && parentName ? ` in ${parentName}` : ""} · rank 1 is best
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {rows.map((r) => (
          <EntityCard key={r.entity_key} r={r} level={level}
            expanded={level === "store" && openStore === r.entity_key}
            onTap={() => (level === "store" ? setOpenStore((o) => (o === r.entity_key ? null : r.entity_key)) : drillInto(String(r.metrics.name ?? r.entity_key)))} />
        ))}
      </div>
    </div>
  );
}

function byRank(a: RankingResultRow, b: RankingResultRow) {
  const ar = isNum(a.rank) ? a.rank : 9999, br = isNum(b.rank) ? b.rank : 9999;
  return ar - br;
}

function SummaryCard({ row, label }: { row: RankingResultRow; label: string }) {
  const m = row.metrics;
  return (
    <div className="rounded-xl bg-midnight p-3 text-white">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/60">{label}</div>
          <div className="text-base font-bold">{String(m.name ?? row.entity_key)}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-black">{isNum(row.total_points) ? row.total_points : "–"}</div>
          <div className="text-[10px] text-white/60">points{isNum(row.rank) ? ` · rank ${row.rank}` : ""}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
        <span>{isNum(m.storeCount) ? `${m.storeCount} stores` : ""}</span>
        <span className="font-mono">{fmtUSD(m.sales)} · <span className={isNum(m.pctVsLy) && (m.pctVsLy as number) < 0 ? "text-red-300" : "text-emerald-300"}>{fmtSignedPct(m.pctVsLy)} LY</span></span>
        <span className="font-mono text-red-300">{fmtUSD(m.finAnnualized)}/yr miss</span>
      </div>
    </div>
  );
}

function EntityCard({ r, level, expanded, onTap }: {
  r: RankingResultRow; level: Level; expanded: boolean; onTap: () => void;
}) {
  const m = r.metrics;
  const isStore = level === "store";
  const title = isStore ? `#${r.entity_key}` : String(m.name ?? r.entity_key);
  const sub = isStore ? String(m.location ?? "") : isNum(m.storeCount) ? `${m.storeCount} stores` : "";
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <button onClick={onTap} className="flex w-full items-center gap-3 p-3 text-left active:bg-zinc-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 font-mono text-sm font-bold text-zinc-600">
          {isNum(r.rank) ? r.rank : "–"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-midnight">{title}</div>
          <div className="truncate text-xs text-zinc-500">{sub}{isStore && m.gm ? ` · ${m.gm}` : ""}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Chip label="Sal" v={m.salesScore} />
          <Chip label="FC" v={m.fcScore} />
          <Chip label="Lab" v={m.laborScore} />
          <Chip label="Ops" v={m.opsScore} />
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg font-black text-midnight">{isNum(r.total_points) ? r.total_points : "–"}</div>
          {!isStore && <ChevronRight className="ml-auto h-4 w-4 text-zinc-300" />}
        </div>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-100 bg-zinc-50/60 px-3 py-3 text-xs">
          {/* Full metric dump — parity with the board + workbook */}
          <Detail l="Sales" v={fmtUSD(m.sales)} />
          <Detail l="LY sales" v={fmtUSD(m.lySales)} />
          <Detail l="vs LY" v={fmtSignedPct(m.pctVsLy)} />
          <Detail l="Tickets" v={fmtInt(m.tickets)} />
          <Detail l="Tickets vs LY" v={fmtSignedPct(m.ticketsVsLyPct)} />
          <Detail l="COGS eff" v={fmtPct1(m.cogsEff)} />
          <Detail l="FC $ miss" v={fmtUSD(m.fcMiss)} />
          <Detail l="FC annualized" v={fmtUSD(m.fcAnnualized)} />
          <Detail l="Labor %" v={fmtPct1(m.laborPct)} />
          <Detail l="PTO %" v={fmtPct1(m.ptoPct)} />
          <Detail l="Chart" v={fmtPct1(m.chart)} />
          <Detail l="Var to chart" v={fmtSignedPct(m.varianceToChart)} />
          <Detail l="Labor $ miss" v={fmtUSD(m.laborMiss)} />
          <Detail l="Hrs over" v={fmtInt(m.hoursOver)} />
          <Detail l="Labor annualized" v={fmtUSD(m.laborAnnualized)} />
          <Detail l="Fin $ miss" v={fmtUSD(m.finMiss)} />
          <Detail l="Fin annualized" v={fmtUSD(m.finAnnualized)} />
          <Detail l="BSC training" v={fmtPct1(m.bscTrainingPct)} />
          <Detail l="On time" v={fmtPct1(m.onTimePct)} />
          <Detail l="Calls /10k" v={fmtNum1(m.callsPer10k)} />
          <Detail l="EcoSure" v={fmtPct1(m.ecosure)} />
          <Detail l="VOG" v={fmtPct1(m.vog)} />
          <Detail l="Training %" v={fmtPct1(m.totalTrainingPct)} />
          <Detail l="Shops" v={fmtInt(m.msCount)} />
          <Detail l="Shop avg" v={fmtPct1(m.msScore)} />
          <Detail l="Voids $" v={fmtUSD(m.voids)} />
          <Detail l="Voids %" v={fmtPct1(m.voidsPct)} />
          <Detail l="DOH" v={fmtNum1(m.doh)} />
          <Detail l="Ending $" v={fmtUSD(m.endingDollars)} />
          <Detail l="$ over goal" v={fmtUSD(m.dollarsOverGoal)} />
        </div>
      )}
    </div>
  );
}

function Detail({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-zinc-100 py-0.5">
      <span className="text-zinc-400">{l}</span>
      <span className="font-mono text-zinc-700">{v}</span>
    </div>
  );
}
