// Public labor sheet — /labor/:token, no login. The token in the URL is the
// credential (same pattern as the shared Territory Map). Resolves to a live
// read-only drill-down: Company → RVP → SDO → DO → Store, with Yesterday / PTD /
// YTD labor %, Act vs Schedule (Yesterday + PTD), and a this-week-vs-last-week
// trend. An RVP's link is scoped to their region; the company link shows all.

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchSharedLabor, type HoursTrend, type ShareBand, type ShareNode, type SharedLaborResponse } from "./api";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtVar = (v: number | null) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtAvs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}h`);
const fmtOverUsd = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtHrsOver = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
const fmtUsd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

// Applied labor credits (period-to-date) — No GM / PTO / Training. These are
// already baked into the labor %, $ over and hrs over above; this line just
// makes the adjustment visible, like the hub does.
function CreditsLine({ credits, light }: { credits: ShareNode["credits"]; light?: boolean }) {
  const parts: string[] = [];
  if (credits.no_gm) parts.push(`No GM ${fmtUsd0(credits.no_gm)}`);
  if (credits.pto) parts.push(`PTO ${fmtUsd0(credits.pto)}`);
  if (credits.training) parts.push(`Training ${fmtUsd0(credits.training)}`);
  if (!parts.length) return null;
  return (
    <div className={cn("text-[10px] tabular-nums", light ? "text-white/70" : "text-zinc-500")}>
      <span className={cn("font-semibold uppercase tracking-wide", light ? "text-white/50" : "text-zinc-400")}>Credits · PTD</span>{" "}
      {parts.join(" · ")}
    </div>
  );
}
const hasCredits = (c: ShareNode["credits"]) => !!(c.no_gm || c.pto || c.training);
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";

// Over chart (labor above target) is bad → red; on/under is good → emerald.
const bandTone = (b: ShareBand) => ((b.variance_pts ?? 0) > 0 ? "text-red-600" : "text-emerald-600");

const CHAIN = ["region", "area", "district", "store"] as const;
type Chain = (typeof CHAIN)[number];
const LEVEL_LABEL: Record<Chain, string> = { region: "RVP · Region", area: "SDO · Market", district: "DO · District", store: "Store" };
const childOf = (l: Chain): Chain | null => CHAIN[CHAIN.indexOf(l) + 1] ?? null;

export function SharedLaborPage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["shared-labor", token],
    queryFn: () => fetchSharedLabor(token),
    enabled: !!token,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">SOAR Hub</div>
          <h1 className="text-2xl font-bold tracking-tight text-midnight">Labor</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {q.data
              ? `${q.data.label ? `${q.data.label} · ` : ""}Business day ${fmtDate(q.data.date)} · read-only`
              : "Read-only shared labor view."}
          </p>
        </div>

        {q.isLoading && <div className="py-16 text-center text-sm text-zinc-500">Loading labor…</div>}
        {q.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center">
            <div className="text-sm font-semibold text-red-700">
              {(q.error as Error)?.message ?? "This labor link is no longer active."}
            </div>
            <p className="mt-1 text-xs text-red-600">Ask whoever sent it for a fresh link.</p>
          </div>
        )}
        {q.data && <SharedLaborExplorer data={q.data} />}
      </div>
    </div>
  );
}

function SharedLaborExplorer({ data }: { data: SharedLaborResponse }) {
  const [path, setPath] = useState<{ level: Chain; name: string }[]>([]);
  const startLevel: Chain = data.scope.kind === "region" ? "area" : "region";
  const displayLevel: Chain = path.length ? (childOf(path[path.length - 1].level) ?? "store") : startLevel;

  const matchesPath = (n: ShareNode) =>
    path.every((c) => (n as unknown as Record<string, unknown>)[c.level] === c.name);

  const rows = useMemo(() => {
    const src = data.levels[displayLevel] ?? [];
    return src
      .filter(matchesPath)
      .slice()
      .sort((a, b) => (b.ptd.variance_pts ?? -Infinity) - (a.ptd.variance_pts ?? -Infinity));
  }, [data, displayLevel, path]);

  // The node you've drilled INTO — its metrics stay pinned above the children
  // as you go deeper (company at the root, then the RVP / SDO / DO you opened).
  const parentNode = useMemo<ShareNode | null>(() => {
    if (!path.length) return data.company;
    const lvl = path[path.length - 1].level;
    return (data.levels[lvl] ?? []).find(matchesPath) ?? data.company;
  }, [data, path]);

  function drill(n: ShareNode) {
    if (displayLevel === "store") return;
    setPath((p) => [...p, { level: displayLevel, name: n.name }]);
  }

  return (
    <div className="space-y-4">
      {/* Scope / drilled-into summary — stays visible as you go deeper */}
      {parentNode && <SummaryCard node={parentNode} />}

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button onClick={() => setPath([])} className={cn(path.length ? "font-medium text-accent hover:underline" : "font-semibold text-midnight")}>
          {data.scope.kind === "region" ? data.scope.region ?? "Region" : "Company"}
        </button>
        {path.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
            <button onClick={() => setPath(path.slice(0, i + 1))} className={cn(i === path.length - 1 ? "font-semibold text-midnight" : "text-accent hover:underline")}>
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{LEVEL_LABEL[displayLevel]}</div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-sm text-zinc-500 ring-1 ring-zinc-200">Nothing to show here.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <NodeCard key={n.store_number ?? n.name} node={n} canDrill={displayLevel !== "store"} onDrill={() => drill(n)} />
          ))}
        </div>
      )}

      <p className="pt-2 text-center text-[11px] text-zinc-400">
        Labor % vs target · AvS = actual − scheduled hours
      </p>
    </div>
  );
}

function SummaryCard({ node }: { node: ShareNode }) {
  return (
    <div className="rounded-xl bg-midnight p-4 text-white ring-1 ring-black/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{node.name}</div>
          <div className="truncate text-xs text-white/60">{node.leader ? `${node.leader} · ` : ""}{node.storeCount} stores</div>
        </div>
        <HoursFlag trend={node.hours_trend} light />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <BandBox label="Daily" b={node.daily} light withAvs />
        <BandBox label="WTD" b={node.wtd} light withAvs />
        <BandBox label="PTD" b={node.ptd} light withAvs />
      </div>
      {hasCredits(node.credits) && <div className="mt-2"><CreditsLine credits={node.credits} light /></div>}
    </div>
  );
}

// Week-over-week flag on hours over chart: are they improving? Fewer hours over
// than last week = improving (green ▼). Shows "—" until last week's close lands.
function HoursFlag({ trend, light }: { trend: HoursTrend; light?: boolean }) {
  const { delta, improving } = trend;
  if (delta == null) {
    return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", light ? "bg-white/10 text-white/50" : "bg-zinc-100 text-zinc-400")}>Hrs WoW —</span>;
  }
  const flat = Math.abs(delta) < 0.05;
  const Icon = flat ? Minus : improving ? TrendingDown : TrendingUp;
  const tone = flat
    ? (light ? "bg-white/10 text-white/70" : "bg-zinc-100 text-zinc-500")
    : improving
      ? (light ? "bg-emerald-400/20 text-emerald-200" : "bg-emerald-50 text-emerald-700")
      : (light ? "bg-red-400/20 text-red-200" : "bg-red-50 text-red-700");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", tone)} title="WTD hours over vs same point last week">
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? "Hrs flat vs LW" : `${improving ? "Improving" : "Worse"} ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}h`}
    </span>
  );
}

function NodeCard({ node, canDrill, onDrill }: { node: ShareNode; canDrill: boolean; onDrill: () => void }) {
  const over = (node.daily.variance_pts ?? 0) > 0;
  const title = node.store_number ? `#${node.store_number} ${node.store_name ?? ""}` : node.name;
  return (
    <button
      type="button"
      onClick={canDrill ? onDrill : undefined}
      className={cn("w-full overflow-hidden rounded-xl bg-white text-left ring-1 ring-zinc-200", canDrill && "active:bg-zinc-50", over && "ring-red-200")}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full", over ? "bg-red-500" : "bg-emerald-500")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-midnight">
            <span className="truncate">{title}</span>
            {canDrill && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {node.leader ? node.leader : "—"}{node.store_number ? "" : ` · ${node.storeCount} store${node.storeCount === 1 ? "" : "s"}`}
          </div>
          <div className="mt-1"><HoursFlag trend={node.hours_trend} /></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 p-2.5">
        <BandBox label="Daily" b={node.daily} withAvs />
        <BandBox label="WTD" b={node.wtd} withAvs />
        <BandBox label="PTD" b={node.ptd} withAvs />
      </div>
      {hasCredits(node.credits) && (
        <div className="border-t border-zinc-100 px-2.5 py-1.5"><CreditsLine credits={node.credits} /></div>
      )}
    </button>
  );
}

function BandBox({ label, b, light, withAvs }: { label: string; b: ShareBand; light?: boolean; withAvs?: boolean }) {
  const overCls = (v: number | null) => (light ? "text-white/60" : (v ?? 0) > 0 ? "text-red-500" : "text-emerald-600");
  return (
    <div className={cn("rounded-lg px-2 py-1.5", light ? "bg-white/10" : "bg-zinc-50")}>
      <div className={cn("text-[9px] font-semibold uppercase tracking-wide", light ? "text-white/50" : "text-zinc-400")}>{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", light ? "text-white" : bandTone(b))}>{fmtPct(b.labor_pct)}</div>
      <div className={cn("text-[10px] tabular-nums", light ? "text-white/60" : "text-zinc-400")}>
        tgt {fmtPct(b.target_pct)} · {fmtVar(b.variance_pts)}
      </div>
      <div className={cn("text-[10px] tabular-nums", overCls(b.dollars_over))}>$ over {fmtOverUsd(b.dollars_over)}</div>
      <div className={cn("text-[10px] tabular-nums", overCls(b.hours_over))}>hrs over {fmtHrsOver(b.hours_over)}</div>
      {withAvs && (
        <div className={cn("text-[10px] tabular-nums", overCls(b.act_vs_sched))}>AvS {fmtAvs(b.act_vs_sched)}</div>
      )}
    </div>
  );
}
