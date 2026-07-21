// Movers — week-over-week what improved / what slipped, VP-only. Compares the
// latest completed ranking week against the prior week at a chosen scope + tier
// and splits entities into Improved / Slipped by their change in total points,
// with rank movement and the category scores that moved.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchRankingMovers, type MoverRow, type RankScope, type RankTier } from "./api";

const TIER_TABS: { id: RankTier; label: string }[] = [
  { id: "store", label: "Stores" }, { id: "do", label: "DOs" }, { id: "sdo", label: "SDOs" },
  { id: "rvp", label: "RVPs" }, { id: "entity", label: "Entities" }, { id: "company", label: "Company" },
];

const CATS: { key: keyof MoverRow["cat"]; label: string }[] = [
  { key: "labor", label: "Labor" }, { key: "sales", label: "Sales" }, { key: "fc", label: "Food cost" },
  { key: "fin", label: "Fin" }, { key: "ops", label: "Ops" },
];

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

function displayName(r: MoverRow, tier: RankTier): { primary: string; secondary: string | null } {
  if (tier === "store") return { primary: `#${r.entity_key}`, secondary: r.location ?? r.gm ?? null };
  return { primary: r.name ?? r.entity_key, secondary: null };
}

function RankMove({ d }: { d: number | null }) {
  if (d == null) return <span className="text-[11px] text-zinc-400">new rank</span>;
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-[11px] text-zinc-400"><Minus className="h-3 w-3" /> same</span>;
  const up = d > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", up ? "text-emerald-700" : "text-red-600")}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d)}
    </span>
  );
}

function CatChips({ r }: { r: MoverRow }) {
  const chips = CATS.map(({ key, label }) => {
    const [now, prev] = r.cat[key];
    if (now == null || prev == null || now === prev) return null;
    const better = now > prev;
    return (
      <span key={key} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset",
        better ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200")}>
        {label} {prev}→{now}
      </span>
    );
  }).filter(Boolean);
  if (!chips.length) return null;
  return <div className="mt-1 flex flex-wrap gap-1">{chips}</div>;
}

function MoverCard({ r, tier }: { r: MoverRow; tier: RankTier }) {
  const { primary, secondary } = displayName(r, tier);
  const up = (r.d_points ?? 0) > 0;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-midnight">{primary}</div>
          {secondary && <div className="truncate text-xs text-zinc-500">{secondary}</div>}
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
            <span>rank {r.rank_prev ?? "—"} → <b className="text-zinc-600">{r.rank_now ?? "—"}</b></span>
            <RankMove d={r.d_rank} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-sm font-bold tabular-nums",
            up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
            {up ? "+" : "−"}{Math.abs(r.d_points ?? 0)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
            {r.points_prev ?? "—"} → <b className="text-zinc-600">{r.points_now ?? "—"}</b> pts
          </div>
        </div>
      </div>
      <CatChips r={r} />
    </div>
  );
}

export function RankingMoversView() {
  const [scope, setScope] = useState<RankScope>("ptd");
  const [tier, setTier] = useState<RankTier>("store");

  const q = useQuery({
    queryKey: ["ranking-movers", scope, tier],
    queryFn: () => fetchRankingMovers(scope, tier),
    staleTime: 60_000,
  });
  const d = q.data;

  const { improved, slipped, fresh } = useMemo(() => {
    const rows = d?.rows ?? [];
    const movers = rows.filter((r) => !r.is_new && r.d_points != null);
    return {
      improved: movers.filter((r) => (r.d_points ?? 0) > 0).sort((a, b) => (b.d_points ?? 0) - (a.d_points ?? 0)),
      slipped: movers.filter((r) => (r.d_points ?? 0) < 0).sort((a, b) => (a.d_points ?? 0) - (b.d_points ?? 0)),
      fresh: rows.filter((r) => r.is_new),
    };
  }, [d]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-midnight">Movers · week over week</h2>
          <p className="text-xs text-zinc-500">
            {d?.current
              ? d.previous
                ? <>Comparing <b className="text-midnight">P{d.current.period}W{d.current.week}</b> (wk ending {fmtDate(d.current.week_ending)}) against <b className="text-midnight">P{d.previous.period}W{d.previous.week}</b> ({fmtDate(d.previous.week_ending)}).</>
                : <>Only one week of runs so far — need a prior week to compare.</>
              : "No completed runs yet."}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 pb-2">
        <Segmented<RankScope> dense value={scope} onChange={setScope}
          options={[{ value: "ptd", label: "Period to date" }, { value: "wtd", label: "Week to date" }]} />
        <div className="ml-auto flex gap-0.5">
          {TIER_TABS.map((t) => (
            <button key={t.id} onClick={() => setTier(t.id)}
              className={cn("border-b-2 px-3 pb-2 pt-1.5 text-sm font-bold transition",
                tier === t.id ? "border-midnight text-midnight" : "border-transparent text-zinc-400 hover:text-zinc-600")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load movers" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !d?.previous ? (
        <EmptyState title="Need two weeks to compare"
          description="Movers compares the latest ranking week against the prior week. Once a second week has run, changes show up here." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-700">
                <TrendingUp className="h-4 w-4" /> Improved <span className="text-zinc-400 font-semibold">· {improved.length}</span>
              </div>
              <div className="space-y-2">
                {improved.length === 0 ? <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-400">No gains this week.</p>
                  : improved.map((r) => <MoverCard key={r.entity_key} r={r} tier={tier} />)}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-red-600">
                <TrendingDown className="h-4 w-4" /> Slipped <span className="text-zinc-400 font-semibold">· {slipped.length}</span>
              </div>
              <div className="space-y-2">
                {slipped.length === 0 ? <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-400">No declines this week.</p>
                  : slipped.map((r) => <MoverCard key={r.entity_key} r={r} tier={tier} />)}
              </div>
            </div>
          </div>

          {fresh.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">New this week · {fresh.length}</div>
              <div className="flex flex-wrap gap-2">
                {fresh.map((r) => {
                  const { primary, secondary } = displayName(r, tier);
                  return (
                    <span key={r.entity_key} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs">
                      <b className="text-midnight">{primary}</b>{secondary ? <span className="text-zinc-500"> · {secondary}</span> : null}
                      {r.points_now != null ? <span className="text-zinc-400"> · {r.points_now} pts</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
