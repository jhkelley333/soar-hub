// Today — the ranked, role-scoped worklist at the top of the dashboard.
// Fuses every signal the platform already computes into one prioritized queue
// with a one-tap action per row: escalated work orders, open disruptions, cash
// variances + closeouts, quote approvals, bonus PAFs, employee actions, the
// Team Pipeline talent signals, assessments awaiting rating, and required
// training. Critical first, then warnings — green silence when nothing needs
// you (the andon-board rule: the board only speaks when something is abnormal).
//
// Every query here reuses the SAME queryKey/queryFn as the dashboard cards and
// module pages, so TanStack shares the cache — this component adds at most
// three new requests (disruptions, talent review, training) per load.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Banknote, CalendarOff, CheckCircle2, ChevronRight, ClipboardCheck,
  FileText, GitBranch, GraduationCap, Hammer, MonitorOff, ShieldAlert, Siren, Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/types/database";
import { useFlag } from "@/lib/flags";
import { fetchOpenWorkOrderAlerts, fetchTickets } from "@/modules/work-orders-v2/api";
import { isOpenStatus } from "@/modules/work-orders-v2/types";
import type { Ticket } from "@/modules/work-orders-v2/types";
import { fetchCfmExpiring } from "@/modules/team/api";
import { listSdoQueue } from "@/modules/paf/api";
import { fetchCashBadges } from "@/modules/cash-management/api";
import { listApprovalQueue } from "@/modules/employee-actions/api";
import { fetchDisruptions } from "@/modules/business-disruptions/api";
import { fetchMonthlyReview } from "@/modules/team-pipeline/api";
import { fetchMyTraining } from "@/modules/qsr/api";
import { fetchNlaList } from "@/modules/nla/api";
import { fetchPortalAdminList } from "@/modules/store-portal/api";

const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

const WO_ROLES = new Set<UserRole>([
  "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader",
  "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin",
]);
const CASH_ROLES = new Set<UserRole>([
  "gm", "shift_manager", "first_assistant_manager", "associate_manager",
  "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting",
]);
const SDO_REVIEW_ROLES = new Set<UserRole>(["sdo", "rvp", "vp", "coo", "admin"]);
const EA_APPROVER_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "admin"]);
const DISRUPTION_REVIEW_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const TALENT_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);
const NLA_ROLES = new Set<UserRole>([
  "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader",
  "gm", "do", "sdo", "rvp", "vp", "coo", "admin",
]);

// Same escalation rule as the WO queue: open AND (business-critical or 15d+).
function ticketDaysOpen(t: Ticket): number {
  const d = new Date(t.date_submitted);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
const isEscalated = (t: Ticket) => isOpenStatus(t.status) && (t.is_business_critical || ticketDaysOpen(t) >= 15);

type Tone = "err" | "warn" | "sky";
interface TodayItem {
  id: string;
  icon: typeof FileText;
  tone: Tone;
  title: string;
  meta: string;
  action: string;
  to: string;
}

const TONE_CHIP: Record<Tone, string> = {
  err: "bg-cherry/10 text-cherry",
  warn: "bg-warning/10 text-warning",
  sky: "bg-accent/10 text-accent",
};
const ACTION_BTN: Record<Tone, string> = {
  err: "bg-cherry text-white hover:bg-cherry-hover",
  warn: "bg-warning text-white hover:brightness-105",
  sky: "bg-accent text-white hover:bg-accent-hover",
};

const plural = (n: number, s: string, p?: string) => `${n} ${n === 1 ? s : p ?? `${s}s`}`;

export function TodayQueue({ role }: { role: UserRole }) {
  const teamPipelineOn = useFlag("team_pipeline");
  const canWo = WO_ROLES.has(role);
  const canCash = CASH_ROLES.has(role);
  const isSdoReviewer = SDO_REVIEW_ROLES.has(role);
  const isEaApprover = EA_APPROVER_ROLES.has(role);
  const canDisruptions = DISRUPTION_REVIEW_ROLES.has(role);
  const canTalent = TALENT_ROLES.has(role) && (teamPipelineOn || role === "admin");
  const canNla = NLA_ROLES.has(role);

  const dashQ = { staleTime: 3 * 60_000, refetchOnWindowFocus: false as const };

  // Shared-cache queries (same keys as the dashboard KPI cards).
  const ticketsQ = useQuery({ queryKey: ["wo2", "tickets"], queryFn: fetchTickets, enabled: canWo, ...dashQ });
  const woAlertsQ = useQuery({ queryKey: ["wo2", "alerts"], queryFn: fetchOpenWorkOrderAlerts, enabled: canWo, ...dashQ });
  const cashQ = useQuery({ queryKey: ["cash", "badges"], queryFn: fetchCashBadges, enabled: canCash, ...dashQ });
  const sdoQ = useQuery({ queryKey: ["paf-sdo-queue"], queryFn: listSdoQueue, enabled: isSdoReviewer, ...dashQ });
  const eaQ = useQuery({ queryKey: ["ea-queue"], queryFn: listApprovalQueue, enabled: isEaApprover, ...dashQ });
  const cfmQ = useQuery({ queryKey: ["cfm-expiring", 60], queryFn: () => fetchCfmExpiring(60), ...dashQ });
  // Today-specific queries (also shared with their module pages).
  const disruptQ = useQuery({ queryKey: ["disruptions"], queryFn: fetchDisruptions, enabled: canDisruptions, ...dashQ });
  const talentQ = useQuery({ queryKey: ["tp-monthly-review"], queryFn: fetchMonthlyReview, enabled: canTalent, ...dashQ });
  const trainQ = useQuery({ queryKey: ["qsr-my-training"], queryFn: fetchMyTraining, ...dashQ });
  const nlaQ = useQuery({ queryKey: ["nla-list"], queryFn: fetchNlaList, enabled: canNla, ...dashQ });
  const screensQ = useQuery({ queryKey: ["store-portal-admin"], queryFn: fetchPortalAdminList, enabled: role === "admin", ...dashQ });

  const items: TodayItem[] = [];

  // ── Critical — money, compliance lapses, and things on fire ──
  const openDisruptions = (disruptQ.data?.reports ?? []).filter((r) => r.status === "open").length;
  if (openDisruptions > 0) {
    items.push({
      id: "disruptions", icon: Siren, tone: "err",
      title: `${plural(openDisruptions, "business disruption")} open`,
      meta: "Stores impacted — review and close the loop",
      action: "Review", to: "/business-disruptions",
    });
  }
  const escalatedWo = (ticketsQ.data?.tickets ?? []).filter(isEscalated).length;
  if (escalatedWo > 0) {
    items.push({
      id: "wo-escalated", icon: Hammer, tone: "err",
      title: `${plural(escalatedWo, "escalated work order")}`,
      meta: "Business-critical or open 15+ days",
      action: "Open", to: "/admin/work-orders-v2",
    });
  }
  const cashAlerts = cashQ.data?.open_alerts ?? 0;
  if (cashAlerts > 0) {
    items.push({
      id: "cash-alerts", icon: Wallet, tone: "err",
      title: `${plural(cashAlerts, "cash variance")} over tolerance`,
      meta: "Open alerts awaiting resolution",
      action: "Resolve", to: "/admin/cash-management",
    });
  }
  const cfmExpired = cfmQ.data?.team.count_expired ?? 0;
  if (cfmExpired > 0) {
    items.push({
      id: "cfm-expired", icon: ShieldAlert, tone: "err",
      title: `${plural(cfmExpired, "CFM certification")} expired`,
      meta: "Compliance lapse — renew now",
      action: "Fix", to: "/cfm-expiring",
    });
  }

  // ── Warnings — decisions and deadlines waiting on you ──
  const closeouts = cashQ.data?.pending_deposits ?? 0;
  if (closeouts > 0) {
    items.push({
      id: "cash-closeouts", icon: Banknote, tone: "warn",
      title: `${plural(closeouts, "deposit")} to validate`,
      meta: "Night closeouts awaiting verification",
      action: "Validate", to: "/admin/cash-management",
    });
  }
  const woApprovals = woAlertsQ.data?.groups.find((g) => g.key === "awaitingApproval")?.count ?? 0;
  if (woApprovals > 0) {
    items.push({
      id: "wo-approvals", icon: Hammer, tone: "warn",
      title: `${plural(woApprovals, "work order approval")}`,
      meta: "Quotes awaiting your decision",
      action: "Review", to: "/approvals",
    });
  }
  // Fleet heartbeat: a bound Command Center screen refreshes every 5 minutes,
  // so 24h of silence means the desktop is dark.
  const offlineScreens = (screensQ.data?.stores ?? []).filter((s) =>
    s.token?.bound && s.token.last_used_at && Date.now() - new Date(s.token.last_used_at).getTime() > 86_400_000).length;
  if (offlineScreens > 0) {
    items.push({
      id: "screens-offline", icon: MonitorOff, tone: "warn",
      title: `${plural(offlineScreens, "store screen")} offline`,
      meta: "Command Center not seen in 24+ hours",
      action: "Check", to: "/admin/store-portal",
    });
  }
  const bonusPafs = sdoQ.data?.pafs.length ?? 0;
  if (bonusPafs > 0) {
    items.push({
      id: "pafs", icon: FileText, tone: "warn",
      title: `${plural(bonusPafs, "PAF")} awaiting your approval`,
      meta: "Bonuses and pay adjustments — clear before payroll",
      action: "Review", to: "/paf",
    });
  }
  const eaCount = (eaQ.data?.trainingCredits.length ?? 0) + (eaQ.data?.ptoRequests.length ?? 0);
  if (eaCount > 0) {
    items.push({
      id: "ea", icon: CalendarOff, tone: "warn",
      title: `${plural(eaCount, "employee action")} to approve`,
      meta: "Training credits & PTO requests",
      action: "Approve", to: "/employee-actions",
    });
  }
  const talentOpen = talentQ.data?.open_total ?? 0;
  if (talentOpen > 0) {
    const parts = (talentQ.data?.items ?? []).filter((i) => i.count > 0).slice(0, 3)
      .map((i) => `${i.count} ${i.label.toLowerCase()}`);
    items.push({
      id: "talent", icon: GitBranch, tone: "warn",
      title: `${plural(talentOpen, "talent item")} to work`,
      meta: parts.join(" · ") || "Succession, development and risk queues",
      action: "Open", to: "/team-pipeline",
    });
  }
  const needsRating = (nlaQ.data?.assessments ?? [])
    .filter((a) => a.my_role && !a.my_submitted && a.status === "awaiting_responses").length;
  if (needsRating > 0) {
    items.push({
      id: "nla", icon: ClipboardCheck, tone: "warn",
      title: `${plural(needsRating, "assessment")} awaiting your rating`,
      meta: "The comparison unlocks once both sides submit",
      action: "Rate", to: "/training?tab=assessments",
    });
  }
  const trainingDue = (trainQ.data?.courses ?? []).filter((c) => c.outstanding).length;
  if (trainingDue > 0) {
    items.push({
      id: "training", icon: GraduationCap, tone: "warn",
      title: `${plural(trainingDue, "required course")} due`,
      meta: "Complete before the window closes",
      action: "Start", to: "/training",
    });
  }

  // Critical first, then warnings — order within a band is the push order above.
  const rank: Record<Tone, number> = { err: 0, warn: 1, sky: 2 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone]);

  const settling = [ticketsQ, woAlertsQ, cashQ, sdoQ, eaQ, cfmQ, disruptQ, talentQ, trainQ, nlaQ]
    .some((q) => q.isLoading && q.fetchStatus !== "idle");
  const critical = items.filter((i) => i.tone === "err").length;

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-night-line">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className={cn("h-5 w-5", critical > 0 ? "text-cherry" : "text-accent")} strokeWidth={1.75} />
          <div>
            <div className="text-sm font-semibold text-ink dark:text-night-ink">Today</div>
            <div className="text-xs text-ink-muted dark:text-night-muted">Everything that needs you, ranked</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {settling && <span className="text-[11px] text-ink-subtle dark:text-night-muted">checking…</span>}
          {items.length > 0 && (
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
              critical > 0 ? "bg-cherry/10 text-cherry" : "bg-warning/10 text-warning")}>
              {plural(items.length, "item")}
            </span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        settling ? (
          <div className="px-5 py-8 text-sm text-ink-muted dark:text-night-muted">Checking your queues…</div>
        ) : (
          <div className="flex items-center gap-3 px-5 py-8">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-success" strokeWidth={1.75} />
            <div>
              <div className="text-sm font-medium text-ink dark:text-night-ink">All clear</div>
              <div className="mt-0.5 text-xs text-ink-muted dark:text-night-muted">
                Nothing needs you right now — new work surfaces here the moment it appears.
              </div>
            </div>
          </div>
        )
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-night-line">
          {items.map((it) => (
            <li key={it.id}>
              <Link to={it.to} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-white/5">
                <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_CHIP[it.tone])}>
                  <it.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink dark:text-night-ink">{it.title}</div>
                  <div className="truncate text-xs text-ink-muted dark:text-night-muted">{it.meta}</div>
                </div>
                <span className={cn("inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition", ACTION_BTN[it.tone])}>
                  {it.action}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle dark:text-night-muted" strokeWidth={2} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
