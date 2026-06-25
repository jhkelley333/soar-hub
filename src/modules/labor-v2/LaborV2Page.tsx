// /admin/labor-v2 — admin-only labor + sales by store, rolled up onto our org
// (region → area → district → store) with click-to-drill, a Daily/WTD/PTD
// period toggle, a historical date picker, and labor-vs-target coloring.
// Data: labor_v2_daily via the labor-v2 fn.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchLaborDates, fetchLaborSummary } from "./api";
import type { LaborBandAgg, LaborLevel, LaborPeriod, LaborRow } from "./types";

const fmtUSD0 = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtSignedUSD0 = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const fmtPct = (frac: number | null, d = 1) => (frac == null ? "—" : `${(frac * 100).toFixed(d)}%`);
const fmtPts = (frac: number | null) => (frac == null ? "—" : `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(1)} pts`);
const fmtHrs = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const fmtRate2 = (v: number | null) => (v == null ? "—" : `+${v.toFixed(2)}`); // Hrs/Unit: per-store avg of over-stores, 2 dp
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";

// Over target → red; on/under → emerald.
const overTone = (over: boolean | null) => (over == null ? "text-zinc-600" : over ? "text-red-600" : "text-emerald-600");
const isOver = (b: LaborBandAgg | null) => (b && b.laborPct != null && b.targetPct != null ? b.laborPct > b.targetPct : null);

const LEVELS: { key: LaborLevel; label: string }[] = [
  { key: "region", label: "Regions" },
  { key: "area", label: "Areas" },
  { key: "district", label: "Districts" },
  { key: "store", label: "Stores" },
];
const LEADER_LABEL: Record<LaborLevel, string> = { region: "RVP", area: "SDO", district: "DO", store: "GM" };
const LEVEL_ORDER: LaborLevel[] = ["region", "area", "district", "store"];
const childLevel = (l: LaborLevel): LaborLevel | null => LEVEL_ORDER[LEVEL_ORDER.indexOf(l) + 1] ?? null;
const levelLabel = (l: LaborLevel) => LEVELS.find((x) => x.key === l)?.label ?? l;

const PERIODS: { key: LaborPeriod; label: string; hint: string }[] = [
  { key: "day", label: "Daily", hint: "previous completed business day" },
  { key: "wtd", label: "WTD", hint: "week-to-date" },
  { key: "ptd", label: "PTD", hint: "period-to-date" },
];

type SortKey = "name" | "sales" | "labor" | "target" | "variance" | "dollarsOver" | "hoursOver" | "sched" | "actual" | "ot" | "actVsSched";

export function LaborV2Page() {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState<string>(""); // "" = latest
  const [period, setPeriod] = useState<LaborPeriod>("day");
  const [level, setLevel] = useState<LaborLevel>("region");
  const [path, setPath] = useState<{ level: LaborLevel; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "variance", dir: "desc" });

  const datesQ = useQuery({ queryKey: ["labor-v2-dates"], queryFn: fetchLaborDates, staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: ["labor-v2-summary", date],
    queryFn: () => fetchLaborSummary({ date: date || undefined }),
    staleTime: 5 * 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => fetchLaborSummary({ date: date || undefined, refresh: true }),
    onSuccess: (data) => {
      qc.setQueryData(["labor-v2-summary", date], data);
      qc.invalidateQueries({ queryKey: ["labor-v2-dates"] });
      const r = data.refreshed;
      if (r && (r.wtd === 0 || r.ptd === 0)) {
        toast.push(`Pulled ${r.stores} stores · WTD ${r.wtd} · PTD ${r.ptd}. Feed sections: ${(r.feedKeys ?? []).join(", ") || "none"}`, "error");
      } else {
        toast.push(r ? `Pulled ${r.stores} stores · WTD ${r.wtd} · PTD ${r.ptd}.` : "Pulled the latest labor numbers.", "success");
      }
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't refresh.", "error"),
  });

  const displayLevel: LaborLevel = path.length ? childLevel(path[path.length - 1].level) ?? "store" : level;
  function selectLevel(k: LaborLevel) { setLevel(k); setPath([]); setSearch(""); }
  function drillInto(row: LaborRow) {
    if (!childLevel(displayLevel)) return;
    setPath((p) => [...p, { level: displayLevel, name: row.name }]);
    setSearch("");
  }

  const total = q.data?.total ?? null;
  const totalBand = total ? total[period] : null;

  const rows = useMemo(() => {
    const base: LaborRow[] = q.data?.levels?.[displayLevel] ?? [];
    const all = base.filter((r) => path.every((c) => (r[c.level as keyof LaborRow] as unknown) === c.name));
    const term = search.trim().toLowerCase();
    const filtered = term ? all.filter((r) => r.name.toLowerCase().includes(term)) : all;
    const val = (r: LaborRow, k: SortKey): number | string => {
      const b = r[period];
      switch (k) {
        case "name": return r.name.toLowerCase();
        case "sales": return b.sales ?? -Infinity;
        case "labor": return b.laborPct ?? -Infinity;
        case "target": return b.targetPct ?? -Infinity;
        case "variance": return b.variancePts ?? -Infinity;
        case "dollarsOver": return b.dollarsOver ?? -Infinity;
        case "hoursOver": return b.hoursOver ?? -Infinity;
        case "sched": return b.scheduledHours ?? -Infinity;
        case "actual": return b.laborHours ?? -Infinity;
        case "ot": return b.overtimeHours ?? -Infinity;
        case "actVsSched": return b.actualVsSched ?? -Infinity;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [q.data, displayLevel, path, search, sort, period]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  const dates = datesQ.data?.dates ?? [];
  const activeDate = q.data?.date ?? null;
  const scope = q.data?.scope;

  return (
    <>
      <PageHeader
        title="Labor v2"
        description={activeDate ? `${fmtDate(activeDate)}${scope ? ` · ${scope.matched} stores` : ""}` : "Labor & sales by store"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={date || activeDate || ""}
              onChange={(e) => { setDate(e.target.value); setPath([]); }}
              className="h-9 rounded-md border-0 bg-white px-2.5 text-sm text-zinc-800 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {activeDate && !dates.includes(activeDate) && <option value={activeDate}>{fmtDate(activeDate)}</option>}
              {dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
            <Button variant="secondary" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", refresh.isPending && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load labor" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !activeDate ? (
        <EmptyState
          title="No labor history yet"
          description="Click Refresh to pull the latest day from the feed, or wait for the next scheduled capture (7/9/11 AM CT)."
        />
      ) : (
        <>
          {/* Period toggle */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={cn("px-4 py-1.5 text-sm font-semibold transition first:rounded-l-md last:rounded-r-md",
                    period === p.key ? "bg-accent text-white" : "text-zinc-600 hover:bg-zinc-50")}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-zinc-400">{PERIODS.find((p) => p.key === period)?.hint}</span>
          </div>

          {/* Company tiles (selected period) */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Net Sales" value={fmtUSD0(totalBand?.sales ?? null)} />
            <Tile label="Labor %" value={fmtPct(totalBand?.laborPct ?? null)} tone={overTone(isOver(totalBand))} />
            <Tile label="Target %" value={fmtPct(totalBand?.targetPct ?? null)} />
            <Tile label="Variance" value={fmtPts(totalBand?.variancePts ?? null)} tone={overTone(totalBand ? (totalBand.variancePts ?? 0) > 0 : null)} />
            <Tile label="$ Over Chart" value={fmtSignedUSD0(totalBand?.dollarsOver ?? null)} sub="cost − chart $" tone={overTone(totalBand ? (totalBand.dollarsOver ?? 0) > 0 : null)} />
            <Tile label="Hrs Over / Unit" value={fmtRate2(totalBand?.hoursOver ?? null)} sub="over-store hrs ÷ # stores" tone={overTone(totalBand ? (totalBand.hoursOver ?? 0) > 0 : null)} />
          </div>

          <Card className="mt-6">
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
                  {LEVELS.map((l) => (
                    <button key={l.key} onClick={() => selectLevel(l.key)}
                      className={cn("px-3.5 py-1.5 text-sm font-medium transition first:rounded-l-md last:rounded-r-md",
                        displayLevel === l.key ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50")}>
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 ring-1 ring-inset ring-zinc-200">
                  <Search className="h-4 w-4 text-zinc-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${displayLevel}s…`}
                    className="w-40 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none" />
                </div>
              </div>

              {path.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
                  <button onClick={() => setPath([])} className="font-medium text-accent hover:underline">{levelLabel(level)}</button>
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
              )}

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-400">No {displayLevel} rows here.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                        <Th label="Name" k="name" sort={sort} onSort={toggleSort} />
                        <Th label="Sales" k="sales" sort={sort} onSort={toggleSort} right />
                        <Th label="Labor %" k="labor" sort={sort} onSort={toggleSort} right />
                        <Th label="Target %" k="target" sort={sort} onSort={toggleSort} right />
                        <Th label="Variance" k="variance" sort={sort} onSort={toggleSort} right />
                        <Th label="$ Over Chart" k="dollarsOver" sort={sort} onSort={toggleSort} right />
                        <Th label="Hrs/Unit" k="hoursOver" sort={sort} onSort={toggleSort} right />
                        <Th label="Sched Hrs" k="sched" sort={sort} onSort={toggleSort} right />
                        <Th label="Actual Hrs" k="actual" sort={sort} onSort={toggleSort} right />
                        <Th label="OT Hrs" k="ot" sort={sort} onSort={toggleSort} right />
                        <Th label="Act−Sched" k="actVsSched" sort={sort} onSort={toggleSort} right />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const canDrill = !!childLevel(displayLevel);
                        const b = r[period];
                        return (
                          <tr key={`${r.name}-${i}`}
                            onClick={canDrill ? () => drillInto(r) : undefined}
                            className={cn("border-b border-zinc-50 hover:bg-zinc-50/60", canDrill && "cursor-pointer")}>
                            <td className="py-2.5 pr-3">
                              <div className="flex items-center gap-1.5 font-medium text-midnight dark:text-night-ink">
                                {r.name}
                                {canDrill && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />}
                              </div>
                              <div className="text-[11px] text-zinc-400">
                                <span className="font-medium text-zinc-500">{LEADER_LABEL[displayLevel]}</span> {r.leader || "—"}
                                {displayLevel !== "store" && ` · ${r.storeCount} store${r.storeCount === 1 ? "" : "s"}`}
                              </div>
                            </td>
                            <td className="py-2.5 pl-3 text-right tabular-nums">{fmtUSD0(b.sales)}</td>
                            <td className={cn("py-2.5 pl-3 text-right font-semibold tabular-nums", overTone(isOver(b)))}>{fmtPct(b.laborPct)}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-500">{fmtPct(b.targetPct)}</td>
                            <td className={cn("py-2.5 pl-3 text-right tabular-nums", overTone(b.variancePts != null ? b.variancePts > 0 : null))}>{fmtPts(b.variancePts)}</td>
                            <td className={cn("py-2.5 pl-3 text-right tabular-nums", overTone(b.dollarsOver != null ? b.dollarsOver > 0 : null))}>{fmtSignedUSD0(b.dollarsOver)}</td>
                            <td className={cn("py-2.5 pl-3 text-right tabular-nums", overTone(b.hoursOver != null ? b.hoursOver > 0 : null))}>{fmtRate2(b.hoursOver)}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtHrs(b.scheduledHours)}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtHrs(b.laborHours)}</td>
                            <td className={cn("py-2.5 pl-3 text-right tabular-nums", b.overtimeHours != null && b.overtimeHours > 0 ? "font-semibold text-amber-600" : "text-zinc-600")}>{fmtHrs(b.overtimeHours)}</td>
                            <td className={cn("py-2.5 pl-3 text-right tabular-nums", overTone(b.actualVsSched != null ? b.actualVsSched > 0 : null))}>{fmtHrs(b.actualVsSched)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-2 text-[11px] text-zinc-400">
                {rows.length} {displayLevel}{rows.length === 1 ? "" : "s"}
                {scope?.unmatched ? ` · ${scope.unmatched} feed store${scope.unmatched === 1 ? "" : "s"} not in your org` : ""}
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs font-medium text-zinc-500">{label}</div>
        <div className={cn("mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-midnight dark:text-night-ink", tone)}>{value}</div>
        {sub && <div className="mt-1 text-[11px] text-zinc-400">{sub}</div>}
      </CardBody>
    </Card>
  );
}

function Th({ label, k, sort, onSort, right }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={cn("py-2", right ? "pl-3 text-right" : "pr-3")}>
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-zinc-600", right && "flex-row-reverse", active && "text-accent")}>
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}
