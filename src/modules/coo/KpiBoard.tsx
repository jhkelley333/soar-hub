// COO KPI board — company tiles + a market table that drills
// RVP → SDO → DO → Store, all from one fetchRankingFull call (the same run
// the Ranker shows, so the numbers always agree with it). Built for a
// desktop read: summary first, then exceptions, then the table.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Home } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchRankingFull, type FullRunScope, type RankScope, type RankingResultRow } from "@/modules/ranking/api";

type Level = "rvp" | "sdo" | "do" | "store";
const NEXT: Record<Level, Level | null> = { rvp: "sdo", sdo: "do", do: "store", store: null };
const PARENT_KEY: Record<Exclude<Level, "rvp">, string> = { sdo: "rvpName", do: "sdoName", store: "doName" };
const LEVEL_LABEL: Record<Level, string> = { rvp: "RVP", sdo: "SDO", do: "DO", store: "Store" };

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const usd = (v: unknown) => (isNum(v) ? (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString("en-US")}`) : "—");
const pct = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : "—");
const spct = (v: unknown, unit = "%") => (isNum(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}${unit}` : "—");
const pts = (v: unknown) => (isNum(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : "—");
const nameOf = (r: RankingResultRow) => String(r.metrics.name ?? r.entity_key);

// Thresholds for the status chip. Labor variance is a fraction of sales
// (0.01 = 1 point over chart); sales vs LY is a fraction (−0.02 = −2%).
type Status = "On track" | "Watch" | "Off track";
function statusOf(m: RankingResultRow["metrics"]): Status | null {
  const v = m.varianceToChart, ly = m.pctVsLy;
  if (!isNum(v) && !isNum(ly)) return null;
  if ((isNum(v) && v > 0.015) || (isNum(ly) && ly < -0.03)) return "Off track";
  if ((isNum(v) && v > 0.005) || (isNum(ly) && ly < 0)) return "Watch";
  return "On track";
}
const STATUS_CLS: Record<Status, string> = {
  "On track": "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Watch: "bg-amber-50 text-amber-800 ring-amber-200",
  "Off track": "bg-red-50 text-red-800 ring-red-200",
};
function StatusChip({ s }: { s: Status | null }) {
  if (!s) return <span className="text-ink-subtle">—</span>;
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1", STATUS_CLS[s])}>{s}</span>;
}

const signCls = (v: unknown, higherIsBetter = true) =>
  !isNum(v) || v === 0 ? "" : (v > 0) === higherIsBetter ? "text-emerald-700" : "text-red-700";

function Tile({ label, value, sub, subCls }: { label: string; value: string; sub?: string; subCls?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-heading tabular-nums">{value}</div>
      {sub && <div className={cn("mt-0.5 text-xs font-medium text-ink-muted", subCls)}>{sub}</div>}
    </Card>
  );
}

export function KpiBoard({ pendingPafs, onOpenPaf }: { pendingPafs?: number; onOpenPaf?: () => void }) {
  const [scope, setScope] = useState<RankScope>("wtd");
  const [path, setPath] = useState<{ level: Level; name: string }[]>([]);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);

  const q = useQuery({
    queryKey: ["coo-kpi-board"],
    queryFn: () => fetchRankingFull(null),
    staleTime: 60_000,
  });
  const run = q.data?.run ?? null;
  const data = q.data?.scopes?.[scope] as FullRunScope | undefined;

  const level: Level = path.length ? (NEXT[path[path.length - 1].level] ?? "store") : "rvp";
  const parentName = path.length ? path[path.length - 1].name : null;

  const allRows = useMemo(() => {
    if (!data) return [] as RankingResultRow[];
    const src = (data[level] ?? []) as RankingResultRow[];
    const filtered = parentName
      ? src.filter((r) => String(r.metrics[PARENT_KEY[level as Exclude<Level, "rvp">]] ?? "") === parentName)
      : src;
    return [...filtered].sort((a, b) => (isNum(a.rank) ? a.rank : 9999) - (isNum(b.rank) ? b.rank : 9999));
  }, [data, level, parentName]);
  const rows = exceptionsOnly ? allRows.filter((r) => statusOf(r.metrics) !== "On track") : allRows;

  const summary = useMemo(() => {
    if (!data) return null;
    if (!path.length) return (data.company?.[0] as RankingResultRow | undefined) ?? null;
    const last = path[path.length - 1];
    return ((data[last.level] ?? []) as RankingResultRow[]).find((r) => nameOf(r) === last.name) ?? null;
  }, [data, path]);

  // "Needs your attention": the children furthest over labor chart and the
  // ones trailing last year, plus PAFs waiting on the COO.
  const attention = useMemo(() => {
    const out: { tag: string; tone: "off" | "watch"; text: string; go?: () => void; cta?: string }[] = [];
    if (pendingPafs && pendingPafs > 0 && onOpenPaf) {
      out.push({ tag: "PAF", tone: "watch", text: `${pendingPafs} PAF${pendingPafs === 1 ? " is" : "s are"} waiting on your response.`, go: onOpenPaf, cta: "Respond" });
    }
    const overLabor = allRows.filter((r) => isNum(r.metrics.varianceToChart) && (r.metrics.varianceToChart as number) > 0.015)
      .sort((a, b) => (b.metrics.laborMiss as number ?? 0) - (a.metrics.laborMiss as number ?? 0)).slice(0, 3);
    if (overLabor.length) {
      out.push({ tag: "Labor", tone: "off", text: `Over chart by 1.5+ pts: ${overLabor.map((r) => `${level === "store" ? "#" : ""}${nameOf(r)} (${spct(r.metrics.varianceToChart, " pts")})`).join(", ")}.` });
    }
    const trailing = allRows.filter((r) => isNum(r.metrics.pctVsLy) && (r.metrics.pctVsLy as number) < -0.03).slice(0, 3);
    if (trailing.length) {
      out.push({ tag: "Sales", tone: "off", text: `Trailing last year by 3%+: ${trailing.map((r) => `${level === "store" ? "#" : ""}${nameOf(r)} (${spct(r.metrics.pctVsLy)})`).join(", ")}.` });
    }
    return out;
  }, [allRows, level, pendingPafs, onOpenPaf]);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (q.isError) return <EmptyState title="Couldn't load the KPI board" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!run || !data?.store?.length) {
    return <EmptyState title="No ranking run yet" description="The KPI board reads the latest Ranker run. Once this week's run completes it fills in here." />;
  }

  const m = summary?.metrics ?? {};
  const drillInto = (name: string) => setPath((p) => [...p, { level, name }]);
  const isStore = level === "store";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => setPath([])}
            className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1.5 font-semibold text-ink-2 hover:bg-surface-sunk">
            <Home className="h-3.5 w-3.5" /> Company
          </button>
          {path.map((c, i) => (
            <Fragment key={i}>
              <ChevronRight className="h-3.5 w-3.5 text-ink-subtle" />
              <button onClick={() => setPath((p) => p.slice(0, i + 1))}
                className="rounded-full bg-surface-muted px-3 py-1.5 font-semibold text-ink-2 hover:bg-surface-sunk">
                {LEVEL_LABEL[c.level]} · {c.name}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">P{run.period} W{run.week} · week ending {run.week_ending}</span>
          <Segmented<RankScope> dense value={scope} onChange={setScope}
            options={[{ value: "wtd", label: "Week" }, { value: "ptd", label: "Period" }]} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Net sales" value={usd(m.sales)} sub={`${spct(m.pctVsLy)} vs LY`} subCls={signCls(m.pctVsLy)} />
        <Tile label="Labor %" value={pct(m.laborPct)} sub={`${spct(m.varianceToChart, " pts")} vs chart`} subCls={signCls(m.varianceToChart, false)} />
        <Tile label="Labor $ miss" value={usd(m.laborMiss)} sub={isNum(m.hoursOver) ? `${Math.round(m.hoursOver as number).toLocaleString()} hours over` : undefined} />
        <Tile label="COGS efficiency" value={pct(m.cogsEff)} sub={isNum(m.fcMiss) ? `${usd(m.fcMiss)} food cost miss` : undefined} />
        <Tile label="On-time" value={pct(m.onTimePct)} sub={isNum(m.callsPer10k) ? `${(m.callsPer10k as number).toFixed(1)} complaints / 10k` : undefined} />
        <Tile label="Ranker points" value={pts(summary?.total_points)} sub={isNum(m.storeCount) ? `${m.storeCount} stores${isNum(summary?.rank) ? ` · rank ${summary!.rank}` : ""}` : undefined} />
      </div>

      {attention.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-heading">Needs your attention</h2>
          <div className="space-y-2">
            {attention.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1", a.tone === "off" ? STATUS_CLS["Off track"] : STATUS_CLS.Watch)}>{a.tag}</span>
                  <span className="text-sm text-ink-2">{a.text}</span>
                </div>
                {a.go && (
                  <button onClick={a.go} className="h-9 rounded-lg bg-surface px-3 text-sm font-semibold text-heading ring-1 ring-inset ring-border hover:bg-surface-muted">
                    {a.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-heading">
              {rows.length} {LEVEL_LABEL[level]}{rows.length === 1 ? "" : "s"}{parentName ? ` in ${parentName}` : ""}
            </h2>
            <p className="text-xs text-ink-muted">{isStore ? "Rank 1 is best." : "Click a name to drill in. Rank 1 is best."}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={exceptionsOnly} onChange={(e) => setExceptionsOnly(e.target.checked)} />
            Exceptions only
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-ink-muted">
              <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                <th className="text-right">Rank</th>
                <th className="text-left">{LEVEL_LABEL[level]}</th>
                <th className="text-left">{isStore ? "GM" : "Stores"}</th>
                <th className="text-right">Net sales</th>
                <th className="text-right">vs LY</th>
                <th className="text-right">Labor %</th>
                <th className="text-right">Var to chart</th>
                <th className="text-right">Labor $ miss</th>
                <th className="text-right">COGS eff</th>
                <th className="text-right">On-time</th>
                <th className="text-right">Points</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const rm = r.metrics;
                return (
                  <tr key={r.entity_key} className="tabular-nums [&>td]:whitespace-nowrap [&>td]:px-3 [&>td]:py-2.5">
                    <td className="text-right font-semibold text-ink-muted">{isNum(r.rank) ? r.rank : "–"}</td>
                    <td className="text-left">
                      {isStore ? (
                        <span className="font-semibold text-heading">#{r.entity_key}<span className="ml-1.5 font-normal text-ink-muted">{String(rm.location ?? "")}</span></span>
                      ) : (
                        <button onClick={() => drillInto(nameOf(r))} className="font-semibold text-accent hover:underline">{nameOf(r)}</button>
                      )}
                    </td>
                    <td className="text-left text-ink-muted">{isStore ? String(rm.gm ?? "—") : isNum(rm.storeCount) ? rm.storeCount : "—"}</td>
                    <td className="text-right">{usd(rm.sales)}</td>
                    <td className={cn("text-right", signCls(rm.pctVsLy))}>{spct(rm.pctVsLy)}</td>
                    <td className="text-right">{pct(rm.laborPct)}</td>
                    <td className={cn("text-right", signCls(rm.varianceToChart, false))}>{spct(rm.varianceToChart, " pts")}</td>
                    <td className="text-right">{usd(rm.laborMiss)}</td>
                    <td className="text-right">{pct(rm.cogsEff)}</td>
                    <td className="text-right">{pct(rm.onTimePct)}</td>
                    <td className="text-right font-bold text-heading">{pts(r.total_points)}</td>
                    <td className="text-left"><StatusChip s={statusOf(rm)} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-ink-muted">Everything here is on track.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-ink-muted">
        Status: Off track = labor 1.5+ pts over chart or sales 3%+ under LY. Watch = labor 0.5+ pts over or sales under LY.
      </p>
    </div>
  );
}
