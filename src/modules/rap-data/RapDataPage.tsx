import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Star, ChevronUp, ChevronDown, AlertTriangle, ChevronDown as ChevDown } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Drawer } from "@/shared/ui/Drawer";
import { useFlag } from "@/lib/flags";
import { fetchRapScores, fetchRapStore, fetchRapReviews } from "./api";
import { SCOPE_LABELS } from "./types";
import type { RapScoreRow, RapReview, RapHistoryPoint } from "./types";

// ── Channel badge ──────────────────────────────────────────────────────────
const CHANNEL_CLASSES: Record<string, string> = {
  google: "bg-blue-100 text-blue-800",
  qualtrics: "bg-purple-100 text-purple-800",
  doordash: "bg-red-100 text-red-800",
  ubereats: "bg-emerald-100 text-emerald-800",
  grubhub: "bg-orange-100 text-orange-800",
};

function ChannelBadge({ channel }: { channel: string }) {
  const cls = CHANNEL_CLASSES[channel?.toLowerCase()] ?? "bg-zinc-100 text-zinc-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {channel}
    </span>
  );
}

// ── Score cell — red when below threshold ─────────────────────────────────
function ScoreCell({ value, threshold = 70 }: { value: number | null; threshold?: number }) {
  if (value == null) return <span className="text-zinc-400">—</span>;
  const cls = value < threshold ? "font-semibold text-red-600" : "";
  return <span className={cls}>{value.toFixed(1)}</span>;
}

function StarsCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-400">—</span>;
  return <span>{value.toFixed(1)}</span>;
}

// ── Review card ───────────────────────────────────────────────────────────
function ReviewCard({ review }: { review: RapReview }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ChannelBadge channel={review.channel} />
        {review.store_name && (
          <span className="text-xs text-ink-muted">
            #{review.store_number} · {review.store_name}
          </span>
        )}
        <span className="ml-auto text-xs text-ink-muted">
          {review.review_date?.slice(0, 10)}
        </span>
      </div>
      {review.pii_possible && (
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          May contain guest PII
        </div>
      )}
      {review.review_text ? (
        <p className="mt-2 text-sm text-ink">{review.review_text}</p>
      ) : (
        <p className="mt-2 text-xs italic text-ink-muted">No review text.</p>
      )}
    </div>
  );
}

// ── History chart inside store drawer ────────────────────────────────────
function HistoryChart({ data }: { data: RapHistoryPoint[] }) {
  if (!data.length) return <EmptyState title="No history" description="No monthly data yet." />;
  const formatted = data.map((p) => ({
    month: p.period_start?.slice(0, 7),
    LTR: p.ltr,
    OSAT: p.osat,
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e4e4e7)" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend
          payload={[
            { value: "LTR", type: "line", color: "#3b82f6" },
            { value: "OSAT", type: "line", color: "#f59e0b" },
          ]}
        />
        <Line type="monotone" dataKey="LTR" stroke="#3b82f6" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="OSAT" stroke="#f59e0b" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Store detail drawer ───────────────────────────────────────────────────
function StoreDrawer({
  storeNumber,
  onClose,
}: {
  storeNumber: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["rap-store", storeNumber],
    queryFn: () => fetchRapStore(storeNumber!),
    enabled: !!storeNumber,
  });

  return (
    <Drawer
      open={!!storeNumber}
      onClose={onClose}
      title={
        storeNumber
          ? `Store #${storeNumber}${data?.store_name ? ` — ${data.store_name}` : ""}`
          : "Store Detail"
      }
      width="500px"
    >
      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <EmptyState title="Error" description="Couldn't load store data." />}
      {data && (
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              LTR &amp; OSAT — Monthly History
            </h3>
            <HistoryChart data={data.history} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Recent Reviews ({data.reviews.length})
            </h3>
            {data.reviews.length === 0 ? (
              <EmptyState title="No reviews" description="No reviews found for this store." />
            ) : (
              <div className="space-y-3">
                {data.reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ── Scores tab ────────────────────────────────────────────────────────────
type SortKey = keyof RapScoreRow;
type SortDir = "asc" | "desc";

const SCOPES = ["mtd", "rolling3", "month_final"] as const;

function ScoresTab() {
  const [scope, setScope] = useState<string>("mtd");
  const [worstFirst, setWorstFirst] = useState(false);
  const [region, setRegion] = useState("");
  const [area, setArea] = useState("");
  const [district, setDistrict] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("store_number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [drawerStore, setDrawerStore] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["rap-scores", scope],
    queryFn: () => fetchRapScores(scope),
  });

  const rows = data?.rows ?? [];

  // Build filter options from data.
  const regions = useMemo(
    () => [...new Set(rows.map((r) => r.region).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const areas = useMemo(
    () =>
      [...new Set(rows.filter((r) => !region || r.region === region).map((r) => r.area).filter(Boolean) as string[])].sort(),
    [rows, region],
  );
  const districts = useMemo(
    () =>
      [...new Set(rows.filter((r) => (!region || r.region === region) && (!area || r.area === area)).map((r) => r.district).filter(Boolean) as string[])].sort(),
    [rows, region, area],
  );

  // Reset cascades when parent filter changes.
  useEffect(() => { setArea(""); setDistrict(""); }, [region]);
  useEffect(() => { setDistrict(""); }, [area]);

  const filtered = useMemo(() => {
    let r = rows;
    if (region) r = r.filter((x) => x.region === region);
    if (area) r = r.filter((x) => x.area === area);
    if (district) r = r.filter((x) => x.district === district);
    return r;
  }, [rows, region, area, district]);

  const sorted = useMemo(() => {
    if (worstFirst) {
      return [...filtered].sort((a, b) => {
        const av = a.ltr ?? Infinity;
        const bv = b.ltr ?? Infinity;
        return av - bv;
      });
    }
    return [...filtered].sort((a, b) => {
      const av = (a[sortKey] as string | number | null) ?? "";
      const bv = (b[sortKey] as string | number | null) ?? "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, worstFirst, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevDown className="ml-0.5 h-3 w-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-0.5 h-3 w-3" />
      : <ChevronDown className="ml-0.5 h-3 w-3" />;
  }

  const TH = ({ col, children }: { col: SortKey; children: React.ReactNode }) => (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-heading"
      onClick={() => toggleSort(col)}
    >
      <span className="inline-flex items-center">
        {children}
        <SortIcon col={col} />
      </span>
    </th>
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <EmptyState title="Error" description="Couldn't load scores." />;

  return (
    <>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Scope pills */}
        <div className="flex rounded-md border border-border bg-surface">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                scope === s
                  ? "bg-accent text-white"
                  : "text-ink-muted hover:bg-surface-hover"
              }`}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Org filters */}
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
        >
          <option value="">All Regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          disabled={!region}
        >
          <option value="">All Areas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          disabled={!area}
        >
          <option value="">All Districts</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Worst First */}
        <button
          onClick={() => setWorstFirst((v) => !v)}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            worstFirst
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-border bg-surface text-ink-muted hover:bg-surface-hover"
          }`}
        >
          Worst First
        </button>

        {data?.as_of && (
          <span className="ml-auto text-xs text-ink-muted">
            As of {data.as_of.slice(0, 10)}
          </span>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <EmptyState title="No data" description="No scores match the current filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-subtle">
              <tr>
                <TH col="store_number">Store #</TH>
                <TH col="store_name">Name</TH>
                <TH col="district">District</TH>
                <TH col="ltr">LTR</TH>
                <TH col="osat">OSAT</TH>
                <TH col="doordash">DD★</TH>
                <TH col="google">Google★</TH>
                <TH col="grubhub">GH★</TH>
                <TH col="ubereats">UE★</TH>
                <TH col="other">Other★</TH>
                <TH col="avg_stars">Avg★</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row) => (
                <tr
                  key={row.store_number}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => setDrawerStore(row.store_number)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.store_number}</td>
                  <td className="max-w-[140px] truncate px-3 py-2 text-xs text-ink-muted">
                    {row.store_name ?? "—"}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-xs text-ink-muted">
                    {row.district ?? "—"}
                  </td>
                  <td className="px-3 py-2"><ScoreCell value={row.ltr} /></td>
                  <td className="px-3 py-2"><ScoreCell value={row.osat} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.doordash} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.google} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.grubhub} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.ubereats} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.other} /></td>
                  <td className="px-3 py-2"><StarsCell value={row.avg_stars} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StoreDrawer storeNumber={drawerStore} onClose={() => setDrawerStore(null)} />
    </>
  );
}

// ── Reviews tab ───────────────────────────────────────────────────────────
function ReviewsTab() {
  const [storeInput, setStoreInput] = useState("");
  const [channel, setChannel] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const [accumulated, setAccumulated] = useState<RapReview[]>([]);
  const lastUpdatedAt = useRef(0);

  // 400ms debounce on text search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchText), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  // Reset page & accumulator on filter change
  useEffect(() => { setPage(0); setAccumulated([]); lastUpdatedAt.current = 0; }, [storeInput, channel, fromDate, toDate, debouncedQ]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["rap-reviews", storeInput, channel, fromDate, toDate, debouncedQ, page],
    queryFn: () =>
      fetchRapReviews({
        store: storeInput || undefined,
        channel: channel || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        q: debouncedQ || undefined,
        page,
      }),
  });

  // Accumulate pages without duplicates using dataUpdatedAt guard.
  useEffect(() => {
    if (!data?.reviews) return;
    const now = Date.now();
    if (now === lastUpdatedAt.current) return;
    lastUpdatedAt.current = now;
    if (page === 0) {
      setAccumulated(data.reviews);
    } else {
      setAccumulated((prev) => {
        const ids = new Set(prev.map((r) => r.id));
        return [...prev, ...data.reviews.filter((r) => !ids.has(r.id))];
      });
    }
  }, [data]);

  const handleLoadMore = useCallback(() => setPage((p) => p + 1), []);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Store #</label>
          <input
            type="text"
            value={storeInput}
            onChange={(e) => setStoreInput(e.target.value)}
            placeholder="e.g. 1234"
            className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          >
            <option value="">All</option>
            <option value="Google">Google</option>
            <option value="Qualtrics">Qualtrics</option>
            <option value="Doordash">Doordash</option>
            <option value="Ubereats">Ubereats</option>
            <option value="Grubhub">Grubhub</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-muted">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-muted">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-ink-muted">Search text</label>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search review text…"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Results */}
      {isLoading && page === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : accumulated.length === 0 ? (
        <EmptyState title="No reviews" description="Try adjusting your filters." />
      ) : (
        <>
          <div className="space-y-3">
            {accumulated.map((r) => <ReviewCard key={r.id} review={r} />)}
          </div>
          {data?.hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={isFetching}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
              >
                {isFetching ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
const TABS = ["Scores", "Reviews"] as const;
type Tab = (typeof TABS)[number];

export function RapDataPage() {
  const flagOn = useFlag("rap_data_beta");
  const [tab, setTab] = useState<Tab>("Scores");

  if (!flagOn) {
    return (
      <>
        <PageHeader title="Customer RAP Data" />
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Lock className="h-8 w-8 text-zinc-400" />
              <p className="text-sm font-medium text-heading">Beta access not enabled</p>
              <p className="max-w-sm text-xs text-ink-muted">
                The <code>rap_data_beta</code> feature flag is not enabled for your account.
                Contact an admin to request access.
              </p>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" strokeWidth={1.75} />
            Customer RAP Data
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              BETA
            </span>
          </span>
        }
        description="Guest outcomes, platform ratings, and review feed."
      />

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-accent text-accent"
                : "text-ink-muted hover:text-heading"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Scores" ? <ScoresTab /> : <ReviewsTab />}
    </>
  );
}
