// /admin/kpi — admin-only KPI dashboard over the Expressway snapshot feed,
// re-scoped onto OUR org hierarchy (region → area → district → store) by joining
// the feed's store number to the SOAR org. Total tiles up top, then a
// level-switchable, sortable, searchable drill-down.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, RefreshCw, Search, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchKpiSnapshot } from "./api";
import type { KpiOrgRow, PeriodKey } from "./types";

// ── formatters ──────────────────────────────────────────────────────────────
const n = (v: number | null | undefined) => (v == null ? null : v);
const fmtUSD0 = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUSD2 = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const fmtPct = (frac: number | null, digits = 1) => (frac == null ? "—" : `${(frac * 100).toFixed(digits)}%`);
const fmtRate = (v: number | null, digits = 2) => (v == null ? "—" : v.toFixed(digits));

function Delta({ frac }: { frac: number | null }) {
  if (frac == null) return null;
  const up = frac >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", up ? "text-emerald-600" : "text-red-600")}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {fmtPct(Math.abs(frac))}
    </span>
  );
}

function Tile({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs font-medium text-zinc-500">{label}</div>
        <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-midnight dark:text-night-ink">{value}</div>
        {(delta !== undefined || sub) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-400">
            {delta !== undefined && <Delta frac={delta ?? null} />}
            {sub && <span>{sub}</span>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── table model ─────────────────────────────────────────────────────────────
type SortKey = "name" | "netSales" | "yoY" | "tickets" | "avgTicket" | "labor" | "splh" | "onTime";
type LevelKey = "region" | "area" | "district" | "store";
const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "region", label: "Regions" },
  { key: "area", label: "Areas" },
  { key: "district", label: "Districts" },
  { key: "store", label: "Stores" },
];
// Leader title shown next to each row's name, by level.
const LEADER_LABEL: Record<LevelKey, string> = { region: "RVP", area: "SDO", district: "DO", store: "GM" };
const LEVEL_ORDER: LevelKey[] = ["region", "area", "district", "store"];
const childLevel = (l: LevelKey): LevelKey | null => LEVEL_ORDER[LEVEL_ORDER.indexOf(l) + 1] ?? null;
const levelLabel = (l: LevelKey) => LEVELS.find((x) => x.key === l)?.label ?? l;

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "wtd", label: "WTD" },
  { key: "ptd", label: "PTD" },
];

// Upstream KPI feed transiently 502s with "non-JSON" — usually a cold start on
// the source. Auto-retry several times with exponential backoff so a refresh-
// then-everything-works rhythm becomes invisible. Total worst-case spend is
// ~22s across 5 attempts before the user actually sees an error card.
const MAX_KPI_RETRIES = 4; // total attempts = 1 + 4 = 5

export function KpiDashboardPage() {
  const q = useQuery({
    queryKey: ["kpi-snapshot"],
    queryFn: fetchKpiSnapshot,
    staleTime: 5 * 60_000,
    retry: MAX_KPI_RETRIES,
    // 1.5s, 3s, 6s, 12s (clamped at 12s) — gives the upstream time to warm up
    // without piling on more pressure during a real outage.
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 12_000),
  });
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [level, setLevel] = useState<LevelKey>("region"); // base level when not drilled
  const [path, setPath] = useState<{ level: LevelKey; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "netSales", dir: "desc" });

  // Drilling into a row shows the child level filtered to that node; the toggle
  // sets the base level (and clears any drill).
  const displayLevel: LevelKey = path.length ? childLevel(path[path.length - 1].level) ?? "store" : level;
  function selectLevel(key: LevelKey) { setLevel(key); setPath([]); setSearch(""); }
  function drillInto(row: KpiOrgRow) {
    if (!childLevel(displayLevel)) return; // store rows are leaves
    setPath((p) => [...p, { level: displayLevel, name: row.name }]);
    setSearch("");
  }

  const pdata = q.data?.periods?.[period] ?? null;
  const total = pdata?.total ?? null;
  const rows = useMemo(() => {
    const base: KpiOrgRow[] = pdata?.levels?.[displayLevel] ?? [];
    // Constrain to the drilled-into ancestors (each crumb fixes one org field).
    const all = base.filter((r) => path.every((c) => (r[c.level as keyof KpiOrgRow] as unknown) === c.name));
    const term = search.trim().toLowerCase();
    const filtered = term ? all.filter((r) => r.name.toLowerCase().includes(term)) : all;
    const val = (r: KpiOrgRow, k: SortKey): number | string => {
      switch (k) {
        case "name": return r.name.toLowerCase();
        case "netSales": return r.netSales ?? -Infinity;
        case "yoY": return r.yoYNetSalesPercentage ?? -Infinity;
        case "tickets": return r.tickets ?? -Infinity;
        case "avgTicket": return r.averageTicketAmount ?? -Infinity;
        case "labor": return r.laborPercentage ?? -Infinity;
        case "splh": return r.splh ?? -Infinity;
        case "onTime": return r.onTimePercentage ?? -Infinity;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [pdata, displayLevel, path, search, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  const asOf = q.data?.fetchedAt
    ? new Date(q.data.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const scope = pdata?.scope;
  const periodHasData = !!total || (pdata?.levels?.store?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="KPI Dashboard"
        description={
          asOf
            ? `As of ${asOf}${scope ? ` · ${scope.matched} stores mapped to your org${scope.unmatched ? ` · ${scope.unmatched} unmatched` : ""}` : ""}`
            : "Company snapshot, by your org"
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", q.isFetching && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="space-y-3">
          {/* Live status strip — indeterminate progress while we wait, and a
              transparent "Retrying" message when an attempt failed. The user
              asked for this so a transient non-JSON response isn't confused
              with the page being broken. */}
          <div className="rounded-md bg-white px-4 py-2 ring-1 ring-inset ring-zinc-200">
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span className="font-medium">
                {q.failureCount > 0
                  ? `Retrying the KPI feed… attempt ${q.failureCount + 1} of ${MAX_KPI_RETRIES + 1}`
                  : "Loading KPIs…"}
              </span>
              {q.failureCount > 0 && (
                <span className="text-amber-700">
                  Upstream is slow to respond — hold on
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full w-1/3 animate-[kpiBar_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          {/* Local keyframes — declare via a one-off <style> so we don't have
              to wire a Tailwind animation in the global config. */}
          <style>{`@keyframes kpiBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
        </div>
      ) : q.isError ? (
        <EmptyState
          title="Couldn't load KPIs"
          description={
            (q.error as Error)?.message?.includes("503") || (q.error as Error)?.message?.toLowerCase().includes("configured")
              ? "The KPI feed isn't configured yet — set SKUNKWORKS_KPI_TOKEN in Netlify and redeploy."
              : (q.error as Error)?.message ?? "Try again."
          }
        />
      ) : (
        <>
          {/* Period selector — Daily reflects the previous completed business day. */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className={cn("px-4 py-1.5 text-sm font-semibold transition first:rounded-l-md last:rounded-r-md",
                    period === p.key ? "bg-accent text-white" : "text-zinc-600 hover:bg-zinc-50")}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-zinc-400">
              {period === "day" ? "Daily = previous completed business day" : period === "wtd" ? "Week-to-date" : "Period-to-date"}
            </span>
          </div>

          {!periodHasData ? (
            <EmptyState
              title={`No ${period.toUpperCase()} data in this snapshot`}
              description={
                q.data?.feedKeys?.length
                  ? `The feed returned: ${q.data.feedKeys.join(", ")}. If the ${period === "wtd" ? "week-to-date" : "period-to-date"} section is named differently, tell me the key and I'll map it.`
                  : "The feed didn't include this period."
              }
            />
          ) : (
          <>
          {/* Company total tiles (all stores in the feed) */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Net Sales" value={fmtUSD0(n(total?.netSales ?? null))} delta={total?.yoYNetSalesPercentage ?? null} sub="vs last year" />
            <Tile label="Tickets" value={fmtNum(n(total?.tickets ?? null))} delta={total?.yoYTrafficPercentage ?? null} sub="traffic vs LY" />
            <Tile label="Avg Ticket" value={fmtUSD2(n(total?.averageTicketAmount ?? null))} delta={total?.yoYAverageTicket ?? null} />
            <Tile label="Labor %" value={fmtPct(n(total?.laborPercentage ?? null))} sub={`${fmtUSD0(n(total?.laborCost ?? null))} labor`} />
            <Tile label="SPLH" value={fmtRate(n(total?.splh ?? null))} sub="sales / labor hr" />
            <Tile label="On-Time %" value={fmtPct(n(total?.onTimePercentage ?? null))} sub={`avg ${fmtRate(n(total?.averageTicketTime ?? null))}m`} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Order Ahead %" value={fmtPct(n(total?.orderAheadPercentage ?? null))} />
            <Tile label="Delivery %" value={fmtPct(n(total?.deliveryPercentage ?? null))} />
            <Tile label="Discount %" value={fmtPct(n(total?.discountPercentage ?? null))} sub={`${fmtUSD0(n(total?.discountTotal ?? null))} total`} />
            <Tile label="Void Total" value={fmtUSD0(n(total?.voidTotal ?? null))} sub={`${fmtNum(n(total?.voidQuantity ?? null))} voids`} />
          </div>

          {/* Drill-down by our org */}
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

              {/* Drill breadcrumb */}
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
                <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-400">
                  No {displayLevel} rows here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                        <Th label="Name" k="name" sort={sort} onSort={toggleSort} />
                        <Th label="Net Sales" k="netSales" sort={sort} onSort={toggleSort} right />
                        <Th label="YoY" k="yoY" sort={sort} onSort={toggleSort} right />
                        <Th label="Tickets" k="tickets" sort={sort} onSort={toggleSort} right />
                        <Th label="Avg Tkt" k="avgTicket" sort={sort} onSort={toggleSort} right />
                        <Th label="Labor %" k="labor" sort={sort} onSort={toggleSort} right />
                        <Th label="SPLH" k="splh" sort={sort} onSort={toggleSort} right />
                        <Th label="On-Time" k="onTime" sort={sort} onSort={toggleSort} right />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const canDrill = !!childLevel(displayLevel);
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
                              <span className="font-medium text-zinc-500">{LEADER_LABEL[displayLevel]}</span>
                              {" "}{r.leader || "—"}
                              {displayLevel !== "store" && ` · ${r.storeCount} store${r.storeCount === 1 ? "" : "s"}`}
                            </div>
                          </td>
                          <td className="py-2.5 pl-3 text-right tabular-nums">{fmtUSD0(r.netSales)}</td>
                          <td className="py-2.5 pl-3 text-right"><div className="flex justify-end"><Delta frac={r.yoYNetSalesPercentage} /></div></td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtNum(r.tickets)}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtUSD2(r.averageTicketAmount)}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtPct(r.laborPercentage)}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtRate(r.splh)}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-zinc-600">{fmtPct(r.onTimePercentage)}</td>
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
      )}
    </>
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
