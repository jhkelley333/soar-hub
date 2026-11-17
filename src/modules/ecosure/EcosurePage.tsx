import { useState, useEffect, useMemo } from "react";
import { ShieldCheck, ChevronUp, ChevronDown, Search, X } from "lucide-react";
import { fetchEcosureSummary } from "./api";
import { StoreDetail } from "./StoreDetail";
import type {
  EcosureStore,
  EcosureSummaryResp,
  TopFinding,
  EcosureFilters,
  RiskRating,
} from "./types";

type SortField = keyof Pick<
  EcosureStore,
  "store_number" | "store_name" | "assessment_date" | "visit_score" | "days_since_audit" | "total_findings"
>;
type SortDir = "asc" | "desc";
type Tab = "stores" | "findings" | "overdue";

const RISK_COLORS: Record<string, string> = {
  "Low Risk":      "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  "Moderate Risk": "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "High Risk":     "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function RiskBadge({ rating }: { rating: RiskRating | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">—</span>;
  const cls = RISK_COLORS[rating] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {rating}
    </span>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-400">—</span>;
  const cls =
    score >= 95 ? "text-green-600 dark:text-green-400" :
    score >= 85 ? "text-amber-600 dark:text-amber-400" :
                  "text-red-600 dark:text-red-400";
  return <span className={`font-semibold tabular-nums ${cls}`}>{score.toFixed(1)}</span>;
}

function SortIcon({ field, sort }: { field: string; sort: { field: string; dir: SortDir } }) {
  if (sort.field !== field) return <ChevronDown className="h-3 w-3 opacity-30 ml-1 inline" />;
  return sort.dir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 inline text-blue-600" />
    : <ChevronDown className="h-3 w-3 ml-1 inline text-blue-600" />;
}

export function EcosurePage() {
  const [data, setData]       = useState<EcosureSummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filters, setFilters] = useState<EcosureFilters>({});
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState<{ field: SortField; dir: SortDir }>({ field: "visit_score", dir: "asc" });
  const [tab, setTab]         = useState<Tab>("stores");
  const [selectedStore, setSelectedStore] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchEcosureSummary(filters)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters.region, filters.area, filters.district]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive unique filter options from loaded data
  const filterOpts = useMemo(() => {
    const rows = data?.stores ?? [];
    return {
      regions:   [...new Set(rows.map((s) => s.region).filter(Boolean) as string[])].sort(),
      areas:     [...new Set(rows.map((s) => s.area).filter(Boolean)   as string[])].sort(),
      districts: [...new Set(rows.map((s) => s.district).filter(Boolean) as string[])].sort(),
    };
  }, [data]);

  const displayStores = useMemo(() => {
    let rows = data?.stores ?? [];
    if (filters.region)   rows = rows.filter((s) => s.region   === filters.region);
    if (filters.area)     rows = rows.filter((s) => s.area     === filters.area);
    if (filters.district) rows = rows.filter((s) => s.district === filters.district);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) =>
          s.store_number.toLowerCase().includes(q) ||
          s.store_name?.toLowerCase().includes(q) ||
          s.district?.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      const av = a[sort.field] as string | number | null;
      const bv = b[sort.field] as string | number | null;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, filters, search, sort]);

  const overdueStores = useMemo(
    () => (data?.stores ?? []).filter((s) => s.days_since_audit > 180)
      .sort((a, b) => b.days_since_audit - a.days_since_audit),
    [data],
  );

  const toggleSort = (field: SortField) => {
    setSort((s) =>
      s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" },
    );
  };

  const setFilter = (key: keyof EcosureFilters, val: string) => {
    setFilters((f) => {
      const next = { ...f, [key]: val || undefined };
      if (key === "region") { delete next.area; delete next.district; }
      if (key === "area")   { delete next.district; }
      return next;
    });
  };

  const summary = data?.summary;
  const asOf    = data?.as_of ? new Date(data.as_of).toLocaleDateString() : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 md:px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Food Safety</h1>
            <span className="text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 rounded-full px-2 py-0.5">
              Beta
            </span>
          </div>
          {asOf && (
            <span className="text-xs text-gray-400">Updated {asOf}</span>
          )}
        </div>

        {/* Filter bar */}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <select
            value={filters.region ?? ""}
            onChange={(e) => setFilter("region", e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">All Regions</option>
            {filterOpts.regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={filters.area ?? ""}
            onChange={(e) => setFilter("area", e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">All Areas</option>
            {filterOpts.areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={filters.district ?? ""}
            onChange={(e) => setFilter("district", e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">All Districts</option>
            {filterOpts.districts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <div className="relative ml-auto">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search store…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-6 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-48"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <X className="h-3 w-3 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 space-y-4">
        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Avg score */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Avg Score</div>
              <div className="text-2xl font-bold">
                <ScoreCell score={summary.avg_score} />
              </div>
              <div className="text-xs text-gray-400 mt-1">{summary.total_stores} stores audited</div>
            </div>

            {/* Risk distribution */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Risk Distribution</div>
              <div className="space-y-1">
                {(["Low Risk", "Moderate Risk", "High Risk"] as RiskRating[]).map((r) => {
                  const n     = summary.risk_counts[r] || 0;
                  const total = summary.total_stores || 1;
                  const pct   = Math.round((n / total) * 100);
                  return (
                    <div key={r} className="flex items-center gap-2 text-xs">
                      <RiskBadge rating={r} />
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${r === "Low Risk" ? "bg-green-500" : r === "Moderate Risk" ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-gray-500 w-6 text-right">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Overdue */}
            <div
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 cursor-pointer hover:border-amber-300 transition-colors"
              onClick={() => setTab("overdue")}
            >
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Overdue ≥180 days</div>
              <div className={`text-2xl font-bold ${summary.overdue_count > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                {summary.overdue_count}
              </div>
              <div className="text-xs text-gray-400 mt-1">stores need scheduling</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
          {(["stores", "findings", "overdue"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
                tab === t
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {t === "overdue" ? `Overdue (${overdueStores.length})` : t === "findings" ? "Top Findings" : "Stores"}
            </button>
          ))}
        </div>

        {/* Loading / error */}
        {loading && (
          <div className="flex justify-center py-16 text-gray-400">Loading…</div>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Stores tab */}
        {!loading && !error && tab === "stores" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    {(
                      [
                        ["store_number", "#"],
                        ["store_name",   "Store"],
                        ["assessment_date", "Last Audit"],
                        ["visit_score",  "Score"],
                        [null,           "Rating"],
                        ["total_findings", "Findings"],
                        ["days_since_audit", "Days Ago"],
                      ] as [SortField | null, string][]
                    ).map(([field, label]) => (
                      <th
                        key={label}
                        className={`text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-2.5 whitespace-nowrap ${field ? "cursor-pointer hover:text-gray-700 dark:hover:text-gray-200" : ""}`}
                        onClick={() => field && toggleSort(field)}
                      >
                        {label}
                        {field && <SortIcon field={field} sort={sort} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayStores.map((s) => (
                    <tr
                      key={s.store_number}
                      onClick={() => setSelectedStore(s.store_number)}
                      className="border-b border-gray-50 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{s.store_number}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {s.store_name ?? s.store_number}
                        {s.district && <div className="text-xs text-gray-400 font-normal">{s.district}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {s.assessment_date}
                      </td>
                      <td className="px-3 py-2.5">
                        <ScoreCell score={s.visit_score} />
                      </td>
                      <td className="px-3 py-2.5">
                        <RiskBadge rating={s.visit_rating as RiskRating | null} />
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 text-center">
                        {s.total_findings ?? "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${s.days_since_audit > 180 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-500"}`}>
                        {s.days_since_audit}
                      </td>
                    </tr>
                  ))}
                  {displayStores.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                        No stores found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top Findings tab */}
        {!loading && !error && tab === "findings" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Top Failing Questions
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Ranked by frequency across all assessments in scope
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">#</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">Question</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">Standard Description</th>
                    <th className="text-right text-xs font-medium text-gray-500 px-3 py-2.5">Occurrences</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.top_findings ?? []).map((f: TopFinding, i: number) => (
                    <tr key={f.question_number} className="border-b border-gray-50 dark:border-gray-800">
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                        {f.question_number}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                        {f.standard_description ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-700 dark:text-gray-300">
                        {f.count}
                      </td>
                    </tr>
                  ))}
                  {(data?.top_findings ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-gray-400">
                        No findings data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Overdue tab */}
        {!loading && !error && tab === "overdue" && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Stores Overdue for Audit
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                No EcoSure assessment in the last 180 days
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">Store</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">District</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-3 py-2.5">Last Audit</th>
                    <th className="text-right text-xs font-medium text-gray-500 px-3 py-2.5">Days Ago</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueStores.map((s) => (
                    <tr
                      key={s.store_number}
                      onClick={() => setSelectedStore(s.store_number)}
                      className="border-b border-gray-50 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {s.store_name ?? s.store_number}
                        </span>
                        <span className="ml-2 font-mono text-xs text-gray-400">{s.store_number}</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">{s.district ?? "—"}</td>
                      <td className="px-3 py-2.5 text-gray-500">{s.assessment_date}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                        {s.days_since_audit}
                      </td>
                    </tr>
                  ))}
                  {overdueStores.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-gray-400">
                        All stores have recent audits
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Store detail drawer */}
      {selectedStore && (
        <StoreDetail
          storeNumber={selectedStore}
          onClose={() => setSelectedStore(null)}
        />
      )}
    </div>
  );
}
