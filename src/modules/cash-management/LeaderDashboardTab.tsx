// Cash Management — Leader Dashboard. A multi-store roll-up for DO/SDO/RVP/
// VP/COO/admin: which stores need attention right now (didn't close, over
// tolerance, overdue deposit, open alerts) plus a full per-store status table.
// Scoped server-side to the caller's stores. Clicking a store drills into the
// store-scoped Dashboard tab.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Search } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchLeaderOverview } from "./api";
import { usd } from "./money";
import { Pill } from "./ui";
import type { LeaderIssue, LeaderStoreRow } from "./types";

// Lowest weight = most urgent; drives the "Needs attention" sort order.
const ISSUE_WEIGHT: Record<LeaderIssue, number> = {
  not_closed: 0,
  over_tolerance: 1,
  deposit_overdue: 2,
  open_alerts: 3,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const toneCls = {
    ok: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
    neutral: "text-midnight",
  }[tone];
  return (
    <Card className="p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

// The status cells shared by the desktop row and the mobile card.
function StatusCells({ r }: { r: LeaderStoreRow }) {
  return (
    <>
      {r.closed_today ? (
        <span className="inline-flex items-center gap-1">
          <Pill tone="green" dot>Closed</Pill>
          {r.today_is_late && <Pill tone="red">Late</Pill>}
        </span>
      ) : (
        <Pill tone="red" dot>Not closed</Pill>
      )}
    </>
  );
}

export function LeaderDashboardTab({ onOpenStore }: { onOpenStore: (storeId: string) => void }) {
  const q = useQuery({ queryKey: ["cash-leader-overview"], queryFn: fetchLeaderOverview });
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [search, setSearch] = useState("");

  const data = q.data;
  const tol = data?.tolerance_cents ?? 500;

  const rows = useMemo(() => {
    const all = data?.stores ?? [];
    const term = search.trim().toLowerCase();
    let list = all;
    if (filter === "attention") list = list.filter((r) => r.issues.length > 0);
    if (term) {
      list = list.filter((r) =>
        `${r.store.number} ${r.store.name ?? ""}`.toLowerCase().includes(term)
      );
    }
    // Attention view: most-urgent issue first, then store number. All view:
    // store number ascending.
    return [...list].sort((a, b) => {
      if (filter === "attention") {
        const aw = Math.min(...a.issues.map((i) => ISSUE_WEIGHT[i]));
        const bw = Math.min(...b.issues.map((i) => ISSUE_WEIGHT[i]));
        if (aw !== bw) return aw - bw;
      }
      return Number(a.store.number) - Number(b.store.number);
    });
  }, [data, filter, search]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError || !data) {
    return (
      <EmptyState
        title="Couldn't load the leader roll-up"
        description={(q.error as Error)?.message ?? "Try again in a moment."}
      />
    );
  }
  if (data.summary.stores_total === 0) {
    return <EmptyState title="No stores in your scope" description="The leader roll-up shows the stores you manage." />;
  }

  const s = data.summary;

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Leader Dashboard</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">
          {data.scope_all ? "All stores" : "My stores"} — cash status
        </h2>
        <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
          Today's close status across {s.stores_total} store{s.stores_total === 1 ? "" : "s"}
          {data.business_date ? ` · business day ${fmtDate(data.business_date)}` : ""}. Tap a store to drill in.
        </p>
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Closed today"
          value={`${s.closed_today}/${s.stores_total}`}
          sub={s.not_closed_today > 0 ? `${s.not_closed_today} not closed` : "all closed"}
          tone={s.not_closed_today > 0 ? "warn" : "ok"}
        />
        <Kpi label="Needs attention" value={String(s.needs_attention)} tone={s.needs_attention > 0 ? "bad" : "ok"} />
        <Kpi label="Over tolerance" value={String(s.over_tolerance)} tone={s.over_tolerance > 0 ? "bad" : "neutral"} />
        <Kpi
          label="Deposits overdue"
          value={String(s.deposits_overdue)}
          sub={`${s.deposits_pending} pending`}
          tone={s.deposits_overdue > 0 ? "bad" : "neutral"}
        />
        <Kpi label="Open alerts" value={String(s.open_alerts)} tone={s.open_alerts > 0 ? "bad" : "neutral"} />
      </div>

      {/* controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
          {(["attention", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition first:rounded-l-md last:rounded-r-md",
                filter === f ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50"
              )}
            >
              {f === "attention" ? `Needs attention (${s.needs_attention})` : `All stores (${s.stores_total})`}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a store…"
            className="w-44 rounded-md border-0 bg-white py-1.5 pl-8 pr-3 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="text-sm font-semibold text-midnight">
            {filter === "attention" ? "Nothing needs attention" : "No stores match"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {filter === "attention"
              ? "Every store in scope is closed, balanced, and clear of alerts."
              : "Try a different search."}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* desktop table */}
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <th className="px-5 py-3">Store</th>
                <th className="px-4 py-3">Today</th>
                <th className="px-4 py-3 text-right">Variance</th>
                <th className="px-4 py-3">Deposit</th>
                <th className="px-4 py-3 text-center">Alerts</th>
                <th className="px-4 py-3">Last close</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.store.id}
                  onClick={() => onOpenStore(r.store.id)}
                  className="cursor-pointer border-t border-zinc-100 transition hover:bg-zinc-50"
                >
                  <td className="px-5 py-3">
                    <div className="font-semibold text-midnight">#{r.store.number}</div>
                    {r.store.name && <div className="truncate text-xs text-zinc-500">{r.store.name}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusCells r={r} /></td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-semibold tabular-nums",
                      r.today_variance_cents === null
                        ? "text-zinc-300"
                        : r.today_flagged
                          ? "text-red-700"
                          : r.today_variance_cents === 0
                            ? "text-zinc-400"
                            : "text-zinc-600"
                    )}
                  >
                    {r.today_variance_cents === null
                      ? "—"
                      : r.today_variance_cents === 0
                        ? "$0.00"
                        : usd(r.today_variance_cents, { signed: true })}
                  </td>
                  <td className="px-4 py-3">
                    {r.pending_deposits === 0 ? (
                      <span className="text-zinc-300">—</span>
                    ) : r.deposit_overdue ? (
                      <Pill tone="red" dot>Overdue {r.deposit_overdue_days}d</Pill>
                    ) : (
                      <span className="text-zinc-600">
                        {r.pending_deposits} pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.open_alerts > 0 ? <Pill tone="red">{r.open_alerts}</Pill> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 tabular-nums">{fmtDate(r.last_close_date)}</td>
                  <td className="px-3 py-3 text-right">
                    <ChevronRight className="inline h-4 w-4 text-zinc-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* mobile cards */}
          <ul className="divide-y divide-zinc-100 sm:hidden">
            {rows.map((r) => (
              <li key={r.store.id}>
                <button
                  type="button"
                  onClick={() => onOpenStore(r.store.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-midnight">#{r.store.number}</span>
                      <StatusCells r={r} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      {r.today_variance_cents !== null && r.today_variance_cents !== 0 && (
                        <span className={cn("tabular-nums", r.today_flagged && "font-semibold text-red-700")}>
                          {usd(r.today_variance_cents, { signed: true })}
                        </span>
                      )}
                      {r.deposit_overdue && <span className="font-semibold text-red-700">Deposit {r.deposit_overdue_days}d overdue</span>}
                      {!r.deposit_overdue && r.pending_deposits > 0 && <span>{r.pending_deposits} deposit pending</span>}
                      {r.open_alerts > 0 && <span className="font-semibold text-red-700">{r.open_alerts} alert{r.open_alerts === 1 ? "" : "s"}</span>}
                      <span>Last close {fmtDate(r.last_close_date)}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-3 text-[11px] text-zinc-400">
        Over tolerance = today's variance beyond ±{usd(tol)}. Deposit overdue = pending more than 3 days.
      </p>
    </div>
  );
}
