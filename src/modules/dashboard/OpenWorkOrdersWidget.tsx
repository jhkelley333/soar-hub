// Dashboard bell widget — surfaces actionable open work orders for
// the signed-in user across four buckets:
//   * New (last 24h)            — fresh submissions to your stores
//   * Awaiting your approval    — pending quotes in your tier
//   * Emergency / Business Critical — non-terminal, high-priority
//   * No activity in 3+ days    — non-terminal, stale
//
// Polls every 60 seconds. Each row links into Work Orders V2 so a
// click on the bell goes from "see what needs attention" to "act on
// the actual ticket" in two taps.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import {
  fetchOpenWorkOrderAlerts,
  type OpenAlertGroup,
  type OpenAlertItem,
} from "@/modules/work-orders-v2/api";

export function OpenWorkOrdersWidget() {
  const q = useQuery({
    queryKey: ["dashboard", "open-wo-alerts"],
    queryFn: fetchOpenWorkOrderAlerts,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const groups = q.data?.groups || [];
  const total = q.data?.total_unique_tickets ?? 0;
  const hasAny = groups.some((g) => g.count > 0);

  return (
    <div className="mt-6">
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <BellWithBadge total={total} loading={q.isLoading} />
              Open Work Orders
            </span>
          }
          description="Actionable items at the stores you can see."
          actions={
            <button
              type="button"
              onClick={() => q.refetch()}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
              aria-label="Refresh alerts"
              title="Refresh"
            >
              {q.isFetching
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
            </button>
          }
        />
        <CardBody>
          {q.isLoading && (
            <div className="text-sm text-zinc-500">Loading…</div>
          )}
          {q.isError && (
            <div className="text-sm text-red-700">
              {(q.error as Error)?.message ?? "Couldn't load alerts."}
            </div>
          )}
          {!q.isLoading && !q.isError && !hasAny && (
            <div className="text-sm text-zinc-500">
              You're all caught up — nothing in any bucket right now.
            </div>
          )}
          {!q.isLoading && !q.isError && hasAny && (
            <div className="space-y-2">
              {groups.map((g) => (
                <AlertGroupRow key={g.key} group={g} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function BellWithBadge({ total, loading }: { total: number; loading: boolean }) {
  // Subtle ring around the bell when there's something to see.
  const has = total > 0;
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center">
      <Bell
        className={
          "h-4.5 w-4.5 " +
          (has ? "text-amber-500" : "text-zinc-400")
        }
        strokeWidth={2}
      />
      {!loading && total > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-4 text-white shadow-sm"
        >
          {total > 99 ? "99+" : total}
        </span>
      )}
    </span>
  );
}

function AlertGroupRow({ group }: { group: OpenAlertGroup }) {
  // Default expanded for non-empty groups so users see what's in
  // them without an extra click. Empty groups stay collapsed +
  // dimmed so the absence reads as "nothing here, ignore."
  const [open, setOpen] = useState(group.count > 0);
  const empty = group.count === 0;
  return (
    <div className={"rounded-md border " + (empty ? "border-zinc-100" : "border-zinc-200") + " bg-white"}>
      <button
        type="button"
        onClick={() => !empty && setOpen((v) => !v)}
        disabled={empty}
        className={
          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left " +
          (empty ? "cursor-default" : "hover:bg-zinc-50")
        }
      >
        <div className="flex items-center gap-2">
          {empty ? (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-300" strokeWidth={1.75} />
          ) : open ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
          )}
          <span className={"text-sm font-medium " + (empty ? "text-zinc-400" : "text-midnight")}>
            {group.label}
          </span>
        </div>
        <Badge tone={empty ? "neutral" : group.tone}>
          {group.count}
        </Badge>
      </button>
      {open && !empty && (
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
          {group.items.map((it) => (
            <li key={it.id}>
              <AlertItemRow group={group} item={it} />
            </li>
          ))}
          {group.count > group.items.length && (
            <li className="px-3 py-2 text-[11px] text-zinc-500">
              +{group.count - group.items.length} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  if (diffMin < 14 * 1440) return `${Math.floor(diffMin / 1440)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AlertItemRow({ group, item }: { group: OpenAlertGroup; item: OpenAlertItem }) {
  const priorityChip =
    item.priority === "Emergency"
      ? <Badge tone="danger">Emergency</Badge>
      : item.priority === "Urgent"
        ? <Badge tone="warning">Urgent</Badge>
        : null;
  const businessCriticalChip = item.is_business_critical
    ? <Badge tone="danger">Critical</Badge>
    : null;
  const stuckChip = group.key === "stuck"
    ? <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
        <Clock className="h-3 w-3" strokeWidth={1.75} />
        idle {relTime(item.timestamp)}
      </span>
    : null;
  const approvalChip = group.key === "awaitingApproval" && item.cost_estimate
    ? <Badge tone="warning">${Number(item.cost_estimate).toFixed(0)}</Badge>
    : null;

  return (
    <Link
      to="/admin/work-orders-v2"
      className="flex items-start gap-2 px-3 py-2 transition hover:bg-zinc-50"
    >
      <AlertTriangle
        className={
          "mt-0.5 h-3.5 w-3.5 shrink-0 " +
          (group.tone === "danger" ? "text-red-500" :
           group.tone === "warning" ? "text-amber-500" :
           group.tone === "info"    ? "text-blue-500" :
                                      "text-zinc-400")
        }
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="font-mono font-semibold text-midnight">
            {item.wo_number || "—"}
          </span>
          {item.store_number && (
            <span className="text-zinc-400">· Store {item.store_number}</span>
          )}
          {priorityChip}
          {businessCriticalChip}
          {approvalChip}
          {!stuckChip && (
            <span className="ml-auto text-zinc-400">{relTime(item.timestamp)}</span>
          )}
          {stuckChip && <span className="ml-auto">{stuckChip}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-midnight">
          {item.summary}
        </div>
      </div>
    </Link>
  );
}
