// Desktop dashboard — redesigned landing (Claude Code handoff, phases 2-3).
// Dark-native layout: greeting → KPI row (hero + 4 stat cards) → Action Queue
// → secondary grid (Cash / Birthdays / Who's Out) → recent work-order
// messages. Wired to the existing scoped data hooks. Phase 3 added the real
// hero sparkline + week-over-week trend (from the tickets list), the merged
// Action Queue (escalated WOs + cash alerts + bonus PAFs + EA approvals), and
// "deposits verified today".
//
// The installed PWA (standalone) keeps its app-style MobileHome; payroll is
// redirected to their PAF queue. Both guards live BELOW all hooks so hook
// order stays stable (react-hooks/rules-of-hooks).

import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarOff,
  ChevronRight,
  FileText,
  Gift,
  Hammer,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { MakeTheRightCallDrawer } from "@/modules/contacts/MakeTheRightCallDrawer";
import { useAuth } from "@/auth/AuthProvider";
import type { UserRole } from "@/types/database";
import { fetchCallerStores, fetchOpenWorkOrderAlerts, fetchRecentMessages, fetchStats, fetchTickets } from "@/modules/work-orders-v2/api";
import { isOpenStatus } from "@/modules/work-orders-v2/types";
import type { RecentMessage, Ticket } from "@/modules/work-orders-v2/types";
import { fetchCfmExpiring } from "@/modules/team/api";
import { listSdoQueue } from "@/modules/paf/api";
import { fetchCashBadges } from "@/modules/cash-management/api";
import { listApprovalQueue } from "@/modules/employee-actions/api";
import { fetchBirthdays } from "@/modules/my-stores/api";
import { thisAndNextWeekRange, formatMonthDay } from "@/modules/my-stores/dateRange";
import type { BirthdayEntry } from "@/modules/my-stores/types";
import { listEmployeeActions } from "@/modules/employee-actions/api";
import type { PtoRow } from "@/modules/employee-actions/types";
import { isStandalone } from "@/lib/push";
import { cn } from "@/lib/cn";
import { FISCAL, fiscalInfo, fiscalWeekLabel } from "@/lib/fiscal";
import { BirthdayCelebration } from "@/modules/my-stores/BirthdayCelebration";
import { MobileHome } from "./MobileHome";
import { WeatherWidget } from "./WeatherWidget";
import { MessageBoard } from "@/modules/messages/MessageBoard";

const SDO_REVIEW_ROLES = new Set<UserRole>(["sdo", "rvp", "vp", "coo", "admin"]);
const PTO_VIEW_ROLES = new Set<UserRole>(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const CASH_ROLES = new Set<UserRole>([
  "gm", "shift_manager", "first_assistant_manager", "associate_manager",
  "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting",
]);
const WALK_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const WO_ROLES = new Set<UserRole>([
  "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader",
  "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin",
]);
const EA_APPROVER_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "admin"]);
const PTO_APPROVED = new Set(["SDO/RVP Approved", "PAF Submitted", "Closed"]);

// A ticket counts as "escalated" when it's open AND either business-critical
// or aged past the 15-day line — the same threshold the WO queue flags red.
function ticketDaysOpen(t: Ticket): number {
  const d = new Date(t.date_submitted);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
function isEscalated(t: Ticket): boolean {
  return isOpenStatus(t.status) && (t.is_business_critical || ticketDaysOpen(t) >= 15);
}

// 7-point daily-submitted sparkline + week-over-week % change, computed from
// the in-scope tickets list (no extra endpoint). Returns null trend when the
// prior week had no submissions (can't express a %).
function woTrend(tickets: Ticket[]): { points: number[]; trendPct: number | null } {
  const dayMs = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const buckets = new Array(7).fill(0);
  let thisWeek = 0;
  let priorWeek = 0;
  for (const t of tickets) {
    const d = new Date(t.date_submitted);
    if (Number.isNaN(d.getTime())) continue;
    const ageDays = Math.floor((startOfToday.getTime() - d.getTime()) / dayMs);
    if (ageDays >= 0 && ageDays < 7) buckets[6 - ageDays]++;
    if (ageDays >= 0 && ageDays < 7) thisWeek++;
    else if (ageDays >= 7 && ageDays < 14) priorWeek++;
  }
  const trendPct = priorWeek === 0 ? null : Math.round(((thisWeek - priorWeek) / priorWeek) * 100);
  return { points: buckets, trendPct };
}

// Shared card chrome — white in light, night-raised in dark.
const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

function timeOfDayGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dateKicker(d = new Date()): string {
  return d
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  if (min < 2880) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DashboardPage() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canCash = !!role && CASH_ROLES.has(role);
  const isSdoReviewer = !!role && SDO_REVIEW_ROLES.has(role);
  const canPto = !!role && PTO_VIEW_ROLES.has(role);
  const canWo = !!role && WO_ROLES.has(role);
  const isEaApprover = !!role && EA_APPROVER_ROLES.has(role);
  // Oversight-only roles (currently just FBC — external consultant) get a
  // narrower dashboard: CFMs Expiring + Stores in Scope + Birthdays. The
  // operations-heavy tiles (Open WOs hero, Cash Variances, Bonus PAFs,
  // Action Queue, Work-Order Messages) are hidden so the page isn't
  // dominated by signals they can't act on. Easy to extend if we add
  // similar consulting/audit-only roles later.
  const isOversightOnly = role === "fbc";

  // Dashboard cards are summary data — they don't need second-by-second
  // freshness, and they shouldn't fan out a fresh wave of queries every
  // time the tab regains focus. On a small DB instance the expensive case
  // is a refetch storm across many stores at login; caching for a few
  // minutes and skipping the focus refetch keeps baseline load low.
  const dashQ = {
    staleTime: 3 * 60_000,
    refetchOnWindowFocus: false as const,
  };

  const woStatsQ = useQuery({ queryKey: ["wo2", "stats"], queryFn: fetchStats, ...dashQ });
  const ticketsQ = useQuery({ queryKey: ["wo2", "tickets"], queryFn: fetchTickets, enabled: canWo, ...dashQ });
  const woAlertsQ = useQuery({ queryKey: ["wo2", "alerts"], queryFn: fetchOpenWorkOrderAlerts, enabled: canWo, ...dashQ });
  const eaQ = useQuery({ queryKey: ["ea-queue"], queryFn: listApprovalQueue, enabled: isEaApprover, ...dashQ });
  const storesQ = useQuery({ queryKey: ["wo2", "caller-stores"], queryFn: fetchCallerStores, ...dashQ });
  const weatherStoreId = profile?.primary_store_id ?? storesQ.data?.stores?.[0]?.id ?? null;
  const cfmQ = useQuery({ queryKey: ["cfm-expiring", 60], queryFn: () => fetchCfmExpiring(60), ...dashQ });
  const cashQ = useQuery({ queryKey: ["cash", "badges"], queryFn: fetchCashBadges, enabled: canCash, ...dashQ });
  const sdoQ = useQuery({ queryKey: ["paf-sdo-queue"], queryFn: listSdoQueue, enabled: isSdoReviewer, ...dashQ });
  const msgQ = useQuery({ queryKey: ["wo2", "recent-messages", 48], queryFn: () => fetchRecentMessages(48), ...dashQ });

  const bdayRange = useMemo(() => thisAndNextWeekRange(), []);
  const bdayQ = useQuery({
    queryKey: ["birthdays", bdayRange.start, bdayRange.end],
    queryFn: () => fetchBirthdays(bdayRange.start, bdayRange.end),
    ...dashQ,
    staleTime: 5 * 60_000,
  });
  const ptoQ = useQuery({
    queryKey: ["ea-list", "approved-pto-widget"],
    queryFn: listEmployeeActions,
    enabled: canPto,
    ...dashQ,
    staleTime: 5 * 60_000,
  });

  // Conditional returns AFTER all hooks (stable hook order).
  if (role === "payroll") return <Navigate to="/paf/queue" replace />;
  if (isStandalone()) return <MobileHome />;

  const greetingName =
    profile?.preferred_name?.trim() || profile?.full_name?.split(" ")[0] || "there";
  const storeCount = storesQ.data?.stores.length ?? null;

  const tickets = ticketsQ.data?.tickets ?? [];
  const escalatedTickets = tickets.filter(isEscalated);
  const { points: sparkPoints, trendPct } = woTrend(tickets);

  const openWo = woStatsQ.data?.stats.open ?? 0;
  const escalated = escalatedTickets.length || (woStatsQ.data?.stats.critical ?? 0);
  const cfmTotal =
    (cfmQ.data?.team.count_expired ?? 0) + (cfmQ.data?.team.count_expiring ?? 0);
  const cfmExpired = cfmQ.data?.team.count_expired ?? 0;
  const cashAlerts = cashQ.data?.open_alerts ?? 0;
  const closeoutsToValidate = cashQ.data?.pending_deposits ?? 0;
  const depositsVerifiedToday = cashQ.data?.deposits_verified_today ?? 0;
  const bonusPafs = sdoQ.data?.pafs ?? [];
  const eaCount = (eaQ.data?.trainingCredits.length ?? 0) + (eaQ.data?.ptoRequests.length ?? 0);
  const woApprovals =
    woAlertsQ.data?.groups.find((g) => g.key === "awaitingApproval")?.count ?? 0;

  return (
    <div className="space-y-6">
      <Greeting
        kicker={dateKicker()}
        title={`${timeOfDayGreeting()}, ${greetingName}`}
        storeCount={storeCount}
        showWalkActions={!!role && WALK_ROLES.has(role)}
      />

      {/* Store message board — announcements addressed to the signed-in user. */}
      <MessageBoard />

      {/* KPI row: hero + 4 stat cards (operations roles). FBC gets a slim
          two-card row covering just the oversight metrics they care about. */}
      {isOversightOnly ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KpiCard
            icon={ShieldCheck}
            title="CFMs Expiring"
            sub="Next 60 days"
            value={cfmQ.isLoading ? "…" : cfmQ.isError ? "—" : String(cfmTotal)}
            foot={cfmExpired > 0 ? `${cfmExpired} already expired` : "All certifications current"}
            tone={cfmExpired > 0 ? "err" : cfmTotal > 0 ? "warn" : "ok"}
            to="/cfm-expiring"
          />
          <KpiCard
            icon={Banknote}
            title="Stores in Scope"
            sub={storeCount !== null ? "Your footprint" : ""}
            value={storesQ.isLoading ? "…" : storesQ.isError ? "—" : String(storeCount ?? 0)}
            foot="Across your regions"
            tone="sky"
            to="/my-stores"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <KpiHero
            loading={woStatsQ.isLoading}
            error={woStatsQ.isError}
            open={openWo}
            escalated={escalated}
            points={sparkPoints}
            trendPct={trendPct}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
            <KpiCard
              icon={ShieldCheck}
              title="CFMs Expiring"
              sub="Next 60 days"
              value={cfmQ.isLoading ? "…" : cfmQ.isError ? "—" : String(cfmTotal)}
              foot={cfmExpired > 0 ? `${cfmExpired} already expired` : "All certifications current"}
              tone={cfmExpired > 0 ? "err" : cfmTotal > 0 ? "warn" : "ok"}
              to="/cfm-expiring"
            />
            <KpiCard
              icon={Wallet}
              title="Cash Variances"
              sub="Open, over tolerance"
              value={!canCash ? "—" : cashQ.isLoading ? "…" : cashQ.isError ? "—" : String(cashAlerts)}
              foot={!canCash ? "Not in your scope" : cashAlerts > 0 ? `${cashAlerts} awaiting resolution` : "All clear for the cycle"}
              tone={cashAlerts > 0 ? "warn" : "ok"}
              to={canCash ? "/admin/cash-management" : undefined}
            />
            <KpiCard
              icon={Banknote}
              title="Stores in Scope"
              sub={storeCount !== null ? "Your footprint" : ""}
              value={storesQ.isLoading ? "…" : storesQ.isError ? "—" : String(storeCount ?? 0)}
              foot="Across your regions"
              tone="sky"
              to="/my-stores"
            />
            <KpiCard
              icon={FileText}
              title="Bonus PAFs"
              sub="Awaiting your review"
              value={!isSdoReviewer ? "—" : sdoQ.isLoading ? "…" : sdoQ.isError ? "—" : String(bonusPafs.length)}
              foot={!isSdoReviewer ? "Not in your scope" : bonusPafs.length > 0 ? "Before payroll" : "Nothing pending"}
              tone={bonusPafs.length > 0 ? "warn" : "ok"}
              to={isSdoReviewer ? "/paf" : undefined}
            />
          </div>
        </div>
      )}

      {!isOversightOnly && (
        <ActionQueue
          woApprovals={canWo ? woApprovals : 0}
          pafCount={isSdoReviewer ? bonusPafs.length : 0}
          cashCount={canCash ? cashAlerts + closeoutsToValidate : 0}
          eaCount={isEaApprover ? eaCount : 0}
          loading={
            (canWo && woAlertsQ.isLoading) ||
            (isSdoReviewer && sdoQ.isLoading) ||
            (canCash && cashQ.isLoading) ||
            (isEaApprover && eaQ.isLoading)
          }
        />
      )}

      {/* Secondary grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {weatherStoreId && <WeatherWidget storeId={weatherStoreId} />}
        {canCash && (
          <CashSnapshot
            loading={cashQ.isLoading}
            closeouts={closeoutsToValidate}
            alerts={cashAlerts}
            verifiedToday={depositsVerifiedToday}
          />
        )}
        <BirthdaysCard
          loading={bdayQ.isLoading}
          entries={bdayQ.data?.entries ?? []}
        />
        {canPto && (
          <WhosOutCard loading={ptoQ.isLoading} rows={ptoQ.data?.ptoRequests ?? []} />
        )}
      </div>

      {!isOversightOnly && (
        <NewMessages
          loading={msgQ.isLoading}
          error={msgQ.isError}
          messages={msgQ.data?.messages ?? []}
        />
      )}

      <BirthdayCelebration />
    </div>
  );
}

// ── Greeting ────────────────────────────────────────────────────────
function Greeting({
  kicker,
  title,
  storeCount,
  showWalkActions,
}: {
  kicker: string;
  title: string;
  storeCount: number | null;
  showWalkActions: boolean;
}) {
  const fInfo = fiscalInfo(new Date());
  // Drawer open state for "Make the right call" — only mounted when the
  // caller's role qualifies (showWalkActions), so the button + drawer share
  // the same gate.
  const [callOpen, setCallOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
          <span className="h-px w-6 bg-accent" />
          {kicker}
          {fInfo && (
            <span
              className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent"
              title={`${FISCAL.label} · Period ${fInfo.period}, week ${fInfo.weekInPeriod} · Quarter ${fInfo.quarter}`}
            >
              {FISCAL.label} · P{fInfo.period} W{fInfo.weekInPeriod} · {fiscalWeekLabel(fInfo.fiscalWeek)}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-night-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted dark:text-night-muted">
          Here's what needs your attention
          {storeCount !== null ? (
            <> across <span className="font-semibold text-ink dark:text-night-ink tabular-nums">{storeCount}</span> stores.</>
          ) : (
            "."
          )}
        </p>
      </div>
      {showWalkActions && (
        <>
          <button
            type="button"
            onClick={() => setCallOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3.5 text-sm font-semibold text-white transition hover:bg-accent-hover"
          >
            <PhoneCall className="h-4 w-4" strokeWidth={2} />
            Make the right call
          </button>
          <MakeTheRightCallDrawer open={callOpen} onClose={() => setCallOpen(false)} />
        </>
      )}
    </div>
  );
}

// ── KPI hero (always dark midnight tile) ────────────────────────────
function KpiHero({
  loading,
  error,
  open,
  escalated,
  points,
  trendPct,
}: {
  loading: boolean;
  error: boolean;
  open: number;
  escalated: number;
  // 7-point daily-submitted series + week-over-week % (null = no prior week).
  points: number[];
  trendPct: number | null;
}) {
  // Map the 7 daily counts onto the 280×48 viewBox. Flat series → a flat line.
  const max = Math.max(1, ...points);
  const spark = points
    .map((v, i) => {
      const x = points.length > 1 ? (i / (points.length - 1)) * 280 : 0;
      const y = 44 - (v / max) * 40;
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
  const trendUp = trendPct !== null && trendPct > 0;
  const trendFlat = trendPct === null || trendPct === 0;

  return (
    <Link
      to="/admin/work-orders-v2"
      className="group relative overflow-hidden rounded-2xl p-5 text-white shadow-float lg:col-span-5"
      style={{ background: "linear-gradient(150deg, #224C70 0%, #15324B 100%)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-frost/80">
          Open Work Orders
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-frost/80">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-frost/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-frost" />
          </span>
          LIVE
        </span>
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="text-6xl font-bold tracking-tight tabular-nums">
          {loading ? "…" : error ? "—" : open}
        </div>
        {!loading && !error && !trendFlat && (
          <span
            className={cn(
              "mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              trendUp ? "bg-cherry/20 text-frost" : "bg-success/20 text-frost",
            )}
            title="New work orders this week vs last week"
          >
            {trendUp ? (
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {trendPct! > 0 ? "+" : ""}{trendPct}% wk
          </span>
        )}
      </div>

      {/* Real sparkline — work orders submitted per day over the last 7 days. */}
      <svg viewBox="0 0 280 48" className="mt-3 h-12 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline
          points={spark}
          fill="none"
          stroke="#74D2E7"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
      </svg>

      <div className="mt-3 flex items-center justify-between text-sm text-frost/80">
        <span>
          {escalated > 0 ? (
            <><span className="font-semibold text-white tabular-nums">{escalated}</span> escalated · needs review</>
          ) : (
            "Nothing escalated"
          )}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-white opacity-80 transition group-hover:opacity-100">
          View all <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
    </Link>
  );
}

// ── KPI stat card ───────────────────────────────────────────────────
const TONE_CHIP: Record<string, string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  err: "bg-cherry/10 text-cherry",
  sky: "bg-accent/10 text-accent",
};

function KpiCard({
  icon: Icon,
  title,
  sub,
  value,
  foot,
  tone,
  to,
}: {
  icon: typeof ShieldCheck;
  title: string;
  sub: string;
  value: string;
  foot: string;
  tone: "ok" | "warn" | "err" | "sky";
  to?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted dark:text-night-muted">
            {title}
          </div>
          {sub && <div className="mt-0.5 text-xs text-ink-subtle dark:text-night-muted/70">{sub}</div>}
        </div>
        <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-ink dark:text-night-ink">
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-muted dark:text-night-muted">{foot}</div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cn(PANEL, "block p-4 transition hover:border-accent/60")}>
        {inner}
      </Link>
    );
  }
  return <div className={cn(PANEL, "p-4")}>{inner}</div>;
}

// ── Action Queue ────────────────────────────────────────────────────
function ActionQueue({
  woApprovals,
  pafCount,
  cashCount,
  eaCount,
  loading,
}: {
  woApprovals: number;
  pafCount: number;
  cashCount: number;
  eaCount: number;
  loading: boolean;
}) {
  const items: ActionRowData[] = [];

  // One summary row per category: Cash, Employee actions, Work Order
  // Approvals, PAF Actions — each shown only when it has items, deep-linking
  // into that module to act.
  if (cashCount > 0) {
    items.push({
      id: "cash",
      icon: Wallet,
      tone: "warn",
      title: `${cashCount} cash item${cashCount === 1 ? "" : "s"} need attention`,
      meta: "Alerts & deposits to clear",
      action: { label: "Open", tone: "warn" },
      to: "/admin/cash-management",
      time: "",
    });
  }
  if (eaCount > 0) {
    items.push({
      id: "ea-approvals",
      icon: CalendarOff,
      tone: "sky",
      title: `${eaCount} employee action${eaCount === 1 ? "" : "s"} to approve`,
      meta: "Training credits & PTO requests",
      action: { label: "Review", tone: "sky" },
      to: "/employee-actions",
      time: "",
    });
  }
  if (woApprovals > 0) {
    items.push({
      id: "wo-approvals",
      icon: Hammer,
      tone: "warn",
      title: `${woApprovals} work order approval${woApprovals === 1 ? "" : "s"}`,
      meta: "Quotes awaiting your decision",
      action: { label: "Review", tone: "warn" },
      to: "/approvals",
      time: "",
    });
  }
  if (pafCount > 0) {
    items.push({
      id: "paf-actions",
      icon: FileText,
      tone: "sky",
      title: `${pafCount} PAF action${pafCount === 1 ? "" : "s"}`,
      meta: "Bonus PAFs awaiting approval",
      action: { label: "Review", tone: "sky" },
      to: "/paf",
      time: "",
    });
  }

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-night-line">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 text-cherry" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-semibold text-ink dark:text-night-ink">Action Queue</div>
            <div className="text-xs text-ink-muted dark:text-night-muted">Decisions waiting on you</div>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-cherry/10 px-2.5 py-1 text-xs font-semibold text-cherry tabular-nums">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {loading ? (
        <div className="px-5 py-8 text-sm text-ink-muted dark:text-night-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-sm font-medium text-ink dark:text-night-ink">Nothing in your queue</div>
          <div className="mt-1 text-xs text-ink-muted dark:text-night-muted">
            You're all caught up — new decisions will surface here.
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-night-line">
          {items.map((it) => (
            <ActionRow key={it.id} {...it} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ActionRowData {
  id: string;
  icon: typeof FileText;
  tone: "warn" | "sky" | "err";
  title: string;
  meta: string;
  action: { label: string; tone: "warn" | "sky" | "err" };
  to: string;
  time: string;
}

const ACTION_BTN: Record<string, string> = {
  warn: "bg-warning text-white hover:brightness-105",
  sky: "bg-accent text-white hover:bg-accent-hover",
  err: "bg-cherry text-white hover:bg-cherry-hover",
};

function ActionRow({ icon: Icon, tone, title, meta, action, to, time }: ActionRowData) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-white/5"
      >
        <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink dark:text-night-ink">{title}</div>
          <div className="truncate text-xs text-ink-muted dark:text-night-muted">{meta}</div>
        </div>
        {time && <span className="hidden shrink-0 text-xs text-ink-subtle dark:text-night-muted sm:block">{time}</span>}
        <span className={cn("inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition", ACTION_BTN[action.tone])}>
          {action.label}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle dark:text-night-muted" strokeWidth={2} />
      </Link>
    </li>
  );
}

// ── Secondary cards ─────────────────────────────────────────────────
function SecondaryHeader({ icon: Icon, title, hint }: { icon: typeof Gift; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent" strokeWidth={1.75} />
      <span className="text-sm font-semibold text-ink dark:text-night-ink">{title}</span>
      {hint && <span className="ml-auto text-[11px] font-medium text-ink-subtle dark:text-night-muted">{hint}</span>}
    </div>
  );
}

function CashSnapshot({
  loading,
  closeouts,
  alerts,
  verifiedToday,
}: {
  loading: boolean;
  closeouts: number;
  alerts: number;
  verifiedToday: number;
}) {
  return (
    <div className={cn(PANEL, "flex flex-col p-4")}>
      <SecondaryHeader icon={Banknote} title="Cash Management" />
      <dl className="space-y-2 text-sm">
        <SnapRow label="Closeouts to validate" value={loading ? "…" : closeouts} tone={closeouts > 0 ? "warn" : "muted"} />
        <SnapRow label="Open alerts" value={loading ? "…" : alerts} tone={alerts > 0 ? "warn" : "muted"} />
        <SnapRow label="Deposits verified today" value={loading ? "…" : verifiedToday} tone="muted" />
      </dl>
      <Link
        to="/admin/cash-management"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent dark:border-night-line dark:bg-night dark:text-night-ink dark:hover:text-frost"
      >
        Open Cash Management <ArrowRight className="h-4 w-4" strokeWidth={2} />
      </Link>
    </div>
  );
}

function SnapRow({ label, value, tone }: { label: string; value: number | string; tone: "warn" | "muted" }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted dark:text-night-muted">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", tone === "warn" ? "text-warning" : "text-ink dark:text-night-ink")}>
        {value}
      </dd>
    </div>
  );
}

function BirthdaysCard({ loading, entries }: { loading: boolean; entries: BirthdayEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.birthday.localeCompare(b.birthday)).slice(0, 6);
  return (
    <div className={cn(PANEL, "p-4")}>
      <SecondaryHeader icon={Gift} title="Birthdays" hint="2 wks" />
      {loading ? (
        <div className="text-sm text-ink-muted dark:text-night-muted">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-ink-muted dark:text-night-muted">No birthdays in the next two weeks.</div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                {e.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-night-ink">{e.name}</span>
              <span className="shrink-0 text-xs font-medium text-ink-muted dark:text-night-muted">
                {formatMonthDay(e.birthday)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WhosOutCard({ loading, rows }: { loading: boolean; rows: PtoRow[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);
  const out = rows
    .filter((p) => PTO_APPROVED.has(p.status) && p.pto_end_date >= today && p.pto_start_date <= horizon)
    .sort((a, b) => a.pto_start_date.localeCompare(b.pto_start_date))
    .slice(0, 6);
  const fmt = (s: string, e: string) => {
    const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const ss = new Date(`${s}T00:00:00`).toLocaleDateString("en-US", o);
    if (!e || e === s) return ss;
    return `${ss} – ${new Date(`${e}T00:00:00`).toLocaleDateString("en-US", o)}`;
  };
  return (
    <div className={cn(PANEL, "p-4")}>
      <SecondaryHeader icon={CalendarOff} title="Who's Out · PTO" />
      {loading ? (
        <div className="text-sm text-ink-muted dark:text-night-muted">Loading…</div>
      ) : out.length === 0 ? (
        <div className="text-sm text-ink-muted dark:text-night-muted">No approved time off coming up.</div>
      ) : (
        <ul className="space-y-2">
          {out.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-ink-muted dark:bg-white/10 dark:text-night-muted">
                {p.employee_name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink dark:text-night-ink">{p.employee_name}</div>
                <div className="truncate text-[11px] text-ink-muted dark:text-night-muted">
                  {fmt(p.pto_start_date, p.pto_end_date)}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-success">Approved</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Recent work-order messages ──────────────────────────────────────
function NewMessages({
  loading,
  error,
  messages,
}: {
  loading: boolean;
  error: boolean;
  messages: RecentMessage[];
}) {
  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-night-line">
        <div className="flex items-center gap-2.5">
          <MessageSquare className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <div>
            <div className="text-sm font-semibold text-ink dark:text-night-ink">New Work-Order Messages</div>
            <div className="text-xs text-ink-muted dark:text-night-muted">Last 48h</div>
          </div>
        </div>
        <Link to="/admin/work-orders-v2" className="text-xs font-semibold text-accent hover:underline">
          Open Work Orders →
        </Link>
      </div>
      {loading ? (
        <div className="px-5 py-8 text-sm text-ink-muted dark:text-night-muted">Loading…</div>
      ) : error ? (
        <div className="px-5 py-8 text-sm text-cherry">Couldn't load messages.</div>
      ) : messages.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-ink-muted dark:text-night-muted">
          No new messages — you're all caught up.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-night-line">
          {messages.slice(0, 6).map((m) => (
            <li key={m.id}>
              <MessageRow m={m} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MessageRow({ m }: { m: RecentMessage }) {
  const preview = m.message.length > 120 ? `${m.message.slice(0, 120).trim()}…` : m.message;
  return (
    <Link
      to={`/admin/work-orders-v2?ticket=${encodeURIComponent(m.ticket_id)}&thread=${encodeURIComponent(m.thread_type)}`}
      className="flex items-start gap-3 px-5 py-3 transition hover:bg-zinc-50 dark:hover:bg-white/5"
    >
      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle dark:text-night-muted" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted dark:text-night-muted">
          <span className="font-semibold text-ink dark:text-night-ink">{m.wo_number || "—"}</span>
          {m.store_number && <span>· Store {m.store_number}</span>}
          {m.thread_type === "vendor" && (
            <span className="rounded-full bg-accent/10 px-1.5 py-0.5 font-medium text-accent">Vendor</span>
          )}
          <span className="ml-auto">{relativeTime(m.created_at)}</span>
        </div>
        <div className="mt-0.5 truncate text-sm text-ink dark:text-night-ink">{preview}</div>
        <div className="mt-0.5 text-[11px] text-ink-muted dark:text-night-muted">{m.user_name || "Unknown"}</div>
      </div>
    </Link>
  );
}
