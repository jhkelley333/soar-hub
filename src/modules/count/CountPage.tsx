// /count — Daily Count scores. Per-store inventory count performance
// (Daily / Completion / Accuracy) from the same KPI feed as Labor v2,
// captured daily so trends accrue. DO+ see a sortable overview of their
// stores with week-over-week deltas and drill into a store's trend; a
// single-store viewer (GM) lands on their store. Admin/VP/COO get a
// Refresh that pulls the feed now.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchCountOverview, fetchCountTrend, refreshCount, type CountRow, type CountTrendPoint } from "./api";

// Feed scores are fractions (0.67 = 67%).
const scorePct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const deltaPts = (v: number | null | undefined) =>
  v == null || v === 0 ? null : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`;

// Score tone thresholds (on the 0–1 fraction). Tunable later.
function tone(v: number | null | undefined): "good" | "ok" | "bad" | "none" {
  if (v == null) return "none";
  if (v >= 0.9) return "good";
  if (v >= 0.75) return "ok";
  return "bad";
}
const TONE_TEXT = { good: "text-emerald-600", ok: "text-amber-600", bad: "text-red-600", none: "text-zinc-300" };

type SortKey = "store" | "daily" | "completion" | "accuracy";
type SortDir = "asc" | "desc";

export function CountPage() {
  const { profile } = useAuth();
  const canRefresh = ["admin", "vp", "coo"].includes(profile?.role ?? "");
  const toast = useToast();
  const qc = useQueryClient();
  const [store, setStore] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "daily", dir: "asc" });

  const q = useQuery({ queryKey: ["count-overview"], queryFn: () => fetchCountOverview(), staleTime: 5 * 60_000 });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);

  useEffect(() => {
    if (!store && rows.length === 1) setStore(rows[0].store_number);
  }, [store, rows]);

  const refresh = useMutation({
    mutationFn: refreshCount,
    onSuccess: (r) => {
      toast.push(r.upserted ? `Pulled ${r.upserted} stores for ${r.business_date}.` : r.note ?? "No count scores in this pull.", r.upserted ? "success" : "info");
      qc.invalidateQueries({ queryKey: ["count-overview"] });
      qc.invalidateQueries({ queryKey: ["count-trend"] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Refresh failed.", "error"),
  });

  const sorted = useMemo(() => {
    const val = (r: CountRow): number | string => {
      switch (sort.key) {
        case "store": return String(r.store_number);
        case "daily": return r.daily_score ?? -Infinity;
        case "completion": return r.completion_score ?? -Infinity;
        case "accuracy": return r.accuracy_score ?? -Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort]);

  if (store) {
    return <TrendView store={store} date={q.data?.date ?? null} onBack={rows.length > 1 ? () => setStore(null) : undefined} />;
  }

  return (
    <>
      <PageHeader
        title="Daily Count"
        description={q.data?.date ? `Inventory count scores · ${q.data.date}` : "Inventory count scores — Daily, Completion, Accuracy."}
        actions={
          canRefresh ? (
            <button
              type="button"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} strokeWidth={2} />
              {refresh.isPending ? "Pulling…" : "Refresh"}
            </button>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load counts" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No count data yet"
          description={canRefresh ? "Hit Refresh to pull the latest scores from the feed, or wait for the next scheduled capture." : "Count scores appear after the next feed capture."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <Th label="Store" k="store" sort={sort} onSort={setSort} />
                  <Th label="Daily" k="daily" sort={sort} onSort={setSort} right />
                  <Th label="Completion" k="completion" sort={sort} onSort={setSort} right />
                  <Th label="Accuracy" k="accuracy" sort={sort} onSort={setSort} right />
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((r) => (
                  <tr key={r.store_number} className="cursor-pointer hover:bg-zinc-50" onClick={() => setStore(r.store_number)}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-midnight">#{r.store_number}</span>
                      <span className="ml-2 text-zinc-500">{r.store_name ?? ""}</span>
                    </td>
                    <ScoreCell value={r.daily_score} wow={r.wow_daily} />
                    <ScoreCell value={r.completion_score} wow={r.wow_completion} />
                    <ScoreCell value={r.accuracy_score} wow={r.wow_accuracy} />
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-accent">Trend →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function ScoreCell({ value, wow }: { value: number | null; wow: number | null }) {
  const d = deltaPts(wow);
  return (
    <td className="px-4 py-2.5 text-right">
      <span className={cn("font-semibold tabular-nums", TONE_TEXT[tone(value)])}>{scorePct(value)}</span>
      {d && (
        <span className={cn("ml-1.5 inline-flex items-center gap-0.5 text-[11px] tabular-nums", (wow ?? 0) > 0 ? "text-emerald-600" : "text-red-600")}>
          {(wow ?? 0) > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
          {d.replace(/^[+-]/, "").replace(" pts", "")}
        </span>
      )}
    </td>
  );
}

function Th({ label, k, sort, onSort, right }: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-4 py-2", right && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "store" ? "asc" : "desc" })}
        className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide hover:text-zinc-600", right && "flex-row-reverse", active && "text-accent")}
      >
        {label}
        <Icon className={cn("h-2.5 w-2.5", !active && "opacity-40")} />
      </button>
    </th>
  );
}

// ── One store's trend ────────────────────────────────────────────────
function TrendView({ store, date, onBack }: { store: string; date: string | null; onBack?: () => void }) {
  const q = useQuery({ queryKey: ["count-trend", store], queryFn: () => fetchCountTrend(store), staleTime: 5 * 60_000 });
  const history = q.data?.history ?? [];
  const latest = history[history.length - 1] ?? null;

  return (
    <>
      {onBack && (
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
          <ArrowLeft className="h-4 w-4" /> All stores
        </button>
      )}
      <PageHeader
        title={q.data ? `#${q.data.store_number}${q.data.store_name ? ` · ${q.data.store_name}` : ""}` : `#${store}`}
        description={`Daily count trend${date ? ` · latest ${date}` : ""}`}
      />
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load trend" description={(q.error as Error)?.message ?? "Try again."} />
      ) : history.length === 0 ? (
        <EmptyState title="No history yet" description="Trend builds as daily captures accrue." />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Daily" value={latest?.daily_score} />
            <Tile label="Completion" value={latest?.completion_score} />
            <Tile label="Accuracy" value={latest?.accuracy_score} />
          </div>
          <TrendChart history={history} />
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Daily</th>
                  <th className="px-4 py-2 text-right">Completion</th>
                  <th className="px-4 py-2 text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {[...history].reverse().map((h) => (
                  <tr key={h.business_date}>
                    <td className="px-4 py-2 text-zinc-600">{h.business_date}</td>
                    <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", TONE_TEXT[tone(h.daily_score)])}>{scorePct(h.daily_score)}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums", TONE_TEXT[tone(h.completion_score)])}>{scorePct(h.completion_score)}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums", TONE_TEXT[tone(h.accuracy_score)])}>{scorePct(h.accuracy_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums", TONE_TEXT[tone(value)])}>{scorePct(value)}</div>
    </div>
  );
}

// Lightweight inline SVG sparkline of the daily score over time — no chart
// dependency. Points are the daily_score fraction mapped to a 0–1 band.
function TrendChart({ history }: { history: CountTrendPoint[] }) {
  const pts = history.map((h) => h.daily_score).filter((v): v is number => v != null);
  if (pts.length < 2) return null;
  const W = 640, H = 120, pad = 8;
  const min = Math.min(...pts, 0.5);
  const max = Math.max(...pts, 1);
  const span = max - min || 1;
  const line = history
    .map((h, i) => {
      if (h.daily_score == null) return null;
      const x = pad + (i / (history.length - 1)) * (W - 2 * pad);
      const y = H - pad - ((h.daily_score - min) / span) * (H - 2 * pad);
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .filter(Boolean)
    .join(" ");
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Daily score trend</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
        <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
