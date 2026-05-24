// Mobile-first home — the post-login landing. Apple-clean dashboard:
// a greeting header, a "Today" hero card (items needing you + scope
// index + three stat tiles), a quick-actions grid, and a recent feed.
//
// All numbers are real, pulled from the same sources the dedicated
// pages use (approvals queue, birthdays, region rollup, recent
// messages) and shared via React Query cache. Each query degrades to a
// neutral state on error so one slow/empty source never blanks the home.
//
// Renders on phones (< lg); DashboardPage still handles desktop.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox,
  Hammer,
  Building2,
  ClipboardCheck,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { roleLevel } from "@/types/database";
import { cn } from "@/lib/cn";
import { fetchApprovalsQueue, relativeTime } from "@/modules/approvals/api";
import { fetchRegionRollup } from "@/modules/region/api";
import { fetchBirthdays, fetchMyTree, launchScopeLabel } from "@/modules/my-stores/api";
import { thisAndNextWeekRange } from "@/modules/my-stores/dateRange";
import { fetchRecentMessages } from "@/modules/work-orders-v2/api";

function greetingFor(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string | null | undefined): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "—";
}

export function MobileHome() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  const isDoPlus = role != null && (roleLevel(role) ?? 0) >= 30;

  const firstName =
    profile?.preferred_name?.trim() || profile?.full_name?.split(" ")[0] || "there";

  const range = useMemo(() => thisAndNextWeekRange(), []);

  const approvalsQ = useQuery({
    queryKey: ["approvals-queue", role],
    queryFn: () => fetchApprovalsQueue(role),
    staleTime: 60_000,
  });
  const treeQ = useQuery({
    queryKey: ["my-stores-tree"],
    queryFn: fetchMyTree,
    staleTime: 5 * 60_000,
  });
  const rollupQ = useQuery({
    queryKey: ["region-rollup"],
    queryFn: fetchRegionRollup,
    enabled: isDoPlus,
    staleTime: 5 * 60_000,
  });
  const birthdaysQ = useQuery({
    queryKey: ["birthdays", range.start, range.end],
    queryFn: () => fetchBirthdays(range.start, range.end),
    staleTime: 5 * 60_000,
  });
  const recentQ = useQuery({
    queryKey: ["wo2", "recent", 48],
    queryFn: () => fetchRecentMessages(48),
    staleTime: 60_000,
  });

  const bySource = approvalsQ.data?.bySource;
  const itemsNeedYou = approvalsQ.data?.counts.all ?? 0;
  const approvalsCount = bySource ? bySource.workspace + bySource.paf : 0;
  const woReview = bySource?.work_order ?? 0;
  const birthdayCount = birthdaysQ.data?.entries.length ?? 0;

  const scopeFull = role && treeQ.data ? launchScopeLabel(treeQ.data, role) : null;
  const scopeShort = scopeFull?.split(" · ")[0] ?? null;
  const regionIndex = rollupQ.data?.index ?? null;

  const num = (q: { isLoading: boolean }, v: number) => (q.isLoading ? "—" : String(v));

  const recent = (recentQ.data?.messages ?? []).slice(0, 4);

  return (
    <div className="mx-auto min-h-full w-full max-w-md bg-surface-muted px-4 pb-8">
      {/* Header */}
      <header className="flex items-start justify-between pt-4 pb-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-midnight-400">
            {greetingFor()}
          </p>
          <h1 className="mt-1 truncate text-[26px] font-semibold leading-tight text-midnight-900">
            {firstName}
          </h1>
          {role && (
            <p className="mt-1 truncate text-[12.5px] text-midnight-500">
              {role.toUpperCase()}
              {scopeFull ? ` · ${scopeFull}` : ""}
            </p>
          )}
        </div>
        <div className="ml-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-frost-100 text-[13px] font-semibold text-midnight-700 ring-1 ring-midnight-100">
          {initials(profile?.full_name)}
        </div>
      </header>

      {/* Today hero card */}
      <section
        className="rounded-3xl px-5 py-5 text-white shadow-float"
        style={{
          background:
            "radial-gradient(ellipse 130% 100% at 100% 0%, #356491 0%, #285780 45%, #1d4063 100%)",
        }}
      >
        <div className="flex items-start justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-frost-300">
            Today
          </p>
          {isDoPlus && regionIndex != null && (
            <div className="text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-white/55">
                Region index
              </p>
              <p className="text-[22px] font-semibold leading-none">{regionIndex}</p>
            </div>
          )}
        </div>

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[44px] font-bold leading-none">
            {num(approvalsQ, itemsNeedYou)}
          </span>
          <span className="text-[13px] text-white/70">items need you</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <StatTile to="/approvals" label="Approvals" value={num(approvalsQ, approvalsCount)} />
          <StatTile to="/admin/work-orders-v2" label="WO review" value={num(approvalsQ, woReview)} />
          <StatTile to="/my-stores" label="Birthdays" value={num(birthdaysQ, birthdayCount)} />
        </div>
      </section>

      {/* Quick actions */}
      <h2 className="mt-7 mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-midnight-400">
        Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <QuickAction to="/approvals" Icon={Inbox} title="Approvals" sub={`${itemsNeedYou} pending`} />
        <QuickAction to="/walkthrough" Icon={ClipboardCheck} title="Walkthrough" sub="Start new" />
        <QuickAction to="/region" Icon={Building2} title="Stores" sub={scopeShort || "Your stores"} />
        <QuickAction to="/admin/work-orders-v2" Icon={Hammer} title="Work orders" sub={`${woReview} awaiting`} />
      </div>

      {/* Recent */}
      <h2 className="mt-7 mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-midnight-400">
        Recent
      </h2>
      <div className="overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-midnight-100">
        {recentQ.isLoading ? (
          <div className="px-4 py-6 text-center text-[13px] text-midnight-400">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-midnight-400">
            Nothing new in the last 48 hours.
          </div>
        ) : (
          recent.map((m, i) => (
            <Link
              key={m.id}
              to={`/admin/work-orders-v2?ticket=${encodeURIComponent(m.ticket_id)}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted",
                i > 0 && "border-t border-midnight-100",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-midnight-900">
                  SDI {m.store_number}
                  {m.asset_type ? ` · ${m.asset_type}` : ""}
                </p>
                <p className="truncate text-[12.5px] text-midnight-500">{m.message}</p>
              </div>
              <span className="shrink-0 text-[11px] text-midnight-400">
                {relativeTime(m.created_at)}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function StatTile({ to, label, value }: { to: string; label: string; value: string }) {
  return (
    <Link
      to={to}
      className="rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10 transition active:bg-white/15"
    >
      <p className="text-[22px] font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-white/65">{label}</p>
    </Link>
  );
}

function QuickAction({
  to,
  Icon,
  title,
  sub,
}: {
  to: string;
  Icon: LucideIcon;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl bg-surface p-4 shadow-card ring-1 ring-midnight-100 transition hover:ring-midnight-200"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-frost-100 text-midnight-700">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.85} />
        </div>
        <ChevronRight className="h-4 w-4 text-midnight-300" strokeWidth={2} />
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-tight text-midnight-900">{title}</p>
      <p className="mt-0.5 truncate text-[12px] text-midnight-500">{sub}</p>
    </Link>
  );
}
