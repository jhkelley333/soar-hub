// Risk tab — who's ABOUT to be in trouble. The board says who's behind;
// this says where it's heading, with the reasons always spelled out.
// Signals: rank trajectory, labor-miss patterns + filed root causes,
// leadership fragility (no GM / open-store tags), service slide, and
// data purity as its own risk class.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Users } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchRankingRisk, type RiskKind, type RiskStore } from "./api";

const KIND_META: Record<RiskKind, { label: string; cls: string; icon: React.ReactNode }> = {
  performance: { label: "Performance", cls: "bg-sonic-50 text-sonic-700", icon: <AlertTriangle className="h-3 w-3" /> },
  people: { label: "People", cls: "bg-accent-100 text-accent-700", icon: <Users className="h-3 w-3" /> },
  data: { label: "Data purity", cls: "bg-zinc-100 text-zinc-600", icon: <Database className="h-3 w-3" /> },
};

export function RankingRiskView() {
  const q = useQuery({ queryKey: ["ranking-risk"], queryFn: fetchRankingRisk, staleTime: 5 * 60_000 });
  const [kindFilter, setKindFilter] = useState<RiskKind | null>(null);
  const [showLow, setShowLow] = useState(false);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load risk" description={(q.error as Error)?.message ?? "Try again."} />;

  const { counts, stores, generated_from_weeks } = q.data!;
  if (!stores.length) {
    return <EmptyState title="No risk signals" description="Run the ranking and import legacy history first — risk needs both." />;
  }

  const visible = stores.filter((s) =>
    (kindFilter ? s.reasons.some((r) => r.kind === kindFilter) : true) &&
    (showLow || s.bucket !== "low"));
  const high = visible.filter((s) => s.bucket === "high");
  const watch = visible.filter((s) => s.bucket === "watch");
  const low = visible.filter((s) => s.bucket === "low");

  return (
    <div className="space-y-5">
      {/* Summary + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={`${counts.high} high`} cls="bg-red-600 text-white" />
        <Chip label={`${counts.watch} watch`} cls="bg-amber-500 text-white" />
        <Chip label={`${counts.low} low`} cls="bg-zinc-200 text-zinc-600" />
        <Chip label={`${counts.stable} stable`} cls="bg-emerald-50 text-emerald-700" />
        <span className="mx-1 text-zinc-300">·</span>
        {(Object.keys(KIND_META) as RiskKind[]).map((k) => (
          <button key={k} onClick={() => setKindFilter(kindFilter === k ? null : k)}
            className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold",
              kindFilter === k ? "border-midnight bg-midnight text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300")}>
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-zinc-400">signals from {generated_from_weeks} weeks of history + the latest run</span>
      </div>

      {/* High risk — full cards */}
      {high.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-red-600">High risk — act this week</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {high.map((s) => <RiskCard key={s.number} s={s} />)}
          </div>
        </section>
      )}

      {/* Watch — compact rows */}
      {watch.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-amber-600">Watch</h3>
          <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            {watch.map((s) => <RiskRow key={s.number} s={s} />)}
          </div>
        </section>
      )}

      {/* Low — collapsed by default */}
      <button onClick={() => setShowLow(!showLow)} className="text-xs font-semibold text-zinc-400 hover:text-zinc-600">
        {showLow ? "Hide" : "Show"} low-signal stores ({counts.low})
      </button>
      {showLow && low.length > 0 && (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          {low.map((s) => <RiskRow key={s.number} s={s} />)}
        </div>
      )}
    </div>
  );
}

function Chip({ label, cls }: { label: string; cls: string }) {
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", cls)}>{label}</span>;
}

function RiskCard({ s }: { s: RiskStore }) {
  return (
    <div className="rounded-xl border-l-4 border-red-500 bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-sm font-bold text-midnight">#{s.number}</span>
          <span className="ml-2 text-sm text-zinc-600">{s.name ?? ""}</span>
          {s.gm && <span className="ml-2 text-xs text-zinc-400">GM {s.gm}</span>}
        </div>
        <div className="shrink-0 text-right text-xs text-zinc-400">
          {s.rank != null && <>rank <b className="font-mono text-zinc-600">{s.rank}</b></>}
          {s.points != null && <> · <b className="font-mono text-zinc-600">{s.points}</b> pts</>}
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {s.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-700">
            <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold", KIND_META[r.kind].cls)}>
              {KIND_META[r.kind].icon}
            </span>
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RiskRow({ s }: { s: RiskStore }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-50">
        <span className="w-14 shrink-0 font-mono text-sm font-bold text-midnight">{s.number}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{s.name ?? ""}{s.gm ? ` · ${s.gm}` : ""}</span>
        <span className="hidden text-xs text-zinc-400 sm:block">{s.reasons[0]?.label}{s.reasons.length > 1 ? ` +${s.reasons.length - 1}` : ""}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold",
          s.bucket === "watch" ? "bg-amber-50 text-amber-700" : "bg-zinc-100 text-zinc-500")}>{s.score}</span>
      </button>
      {open && (
        <ul className="space-y-1 bg-zinc-50/60 px-16 py-2">
          {s.reasons.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-zinc-600">
              <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5", KIND_META[r.kind].cls)}>{KIND_META[r.kind].icon}</span>
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
