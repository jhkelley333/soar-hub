// Unified action queue. Surfaces exactly four kinds of pending action:
//
//   1. Work order approvals — fetchOpenWorkOrderAlerts() "awaitingApproval"
//      (dollar-routed pay approvals). One card per quote.
//   2. PAF approvals        — listSdoQueue() (bonus PAFs awaiting SDO+).
//      One card per PAF.
//   3. Cash                 — fetchCashBadges() open alerts + pending
//      deposits, rolled up into a SINGLE summary row.
//   4. Employee actions     — listApprovalQueue() training credits + PTO
//      awaiting decision, rolled up into a SINGLE summary row.
//
// (Workspace audits/sign-offs were intentionally removed — they live on the
// Operations Tools surface, not the approvals/action queue.)
//
// Each source normalizes into one ApprovalItem shape so the page renders one
// tier-sorted list; each row deep-links to its native detail page. Role gating
// skips a source the caller can't act on so we don't burn the API call.

import { listSdoQueue } from "@/modules/paf/api";
import {
  fetchOpenWorkOrderAlerts,
  type OpenAlertItem,
} from "@/modules/work-orders-v2/api";
import { fetchCashBadges } from "@/modules/cash-management/api";
import { listApprovalQueue } from "@/modules/employee-actions/api";
import type { PafRow } from "@/modules/paf/types";
import type { UserRole } from "@/types/database";
import type { Tier } from "@/shared/ui/Tier";

export type ApprovalSource = "work_order" | "paf" | "cash" | "employee_action";

export interface ApprovalItem {
  /** Unique key across all sources (prefixed by source so React keys + de-dupe work). */
  id: string;
  source: ApprovalSource;
  sourceLabel: string;           // "Walkthrough" / "Bonus PAF" / "Work Order"
  title: string;                 // primary line (template name, employee, WO summary)
  subtitle: string;              // secondary line (workspace, category, vendor, etc.)
  submittedAt: string;           // ISO timestamp
  sdi: string | null;            // store number when known
  storeName: string | null;
  tier: Tier;                    // red / yellow / green
  score: number | null;          // 0-100 audit score, or null
  amount: number | null;         // dollar amount for PAF/WO, or null
  flagged: number;               // count of critical flags
  prior: string | null;          // "Resubmitted after revision" etc.
  deepLink: string;              // where tapping the row goes
}

export interface ApprovalsQueue {
  items: ApprovalItem[];
  counts: { all: number; green: number; yellow: number; red: number };
  bySource: { work_order: number; paf: number; cash: number; employee_action: number };
}

// ----------------------------------------------------------------------------
// Role gating — which sources each role can act on.
// ----------------------------------------------------------------------------

const PAF_APPROVER_ROLES = new Set<string>(["sdo", "rvp", "vp", "coo", "admin"]);
const WO_APPROVER_ROLES = new Set<string>(["do", "sdo", "rvp", "vp", "coo", "admin"]);
// Cash-capable roles (mirrors MobileHome's CASH_ROLES).
const CASH_ROLES = new Set<string>([
  "gm", "shift_manager", "first_assistant_manager", "associate_manager",
  "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting",
]);
// Employee-action approvers (mirrors employee-actions.js APPROVER_ROLES).
const EA_APPROVER_ROLES = new Set<string>(["do", "sdo", "rvp", "admin"]);

// ----------------------------------------------------------------------------
// Normalizers
// ----------------------------------------------------------------------------

// A single rolled-up summary row (used for Cash + Employee actions, which are
// categories rather than discrete approval cards).
function summaryRow(opts: {
  source: ApprovalSource;
  sourceLabel: string;
  title: string;
  subtitle: string;
  deepLink: string;
  at: string;
}): ApprovalItem {
  return {
    id: `${opts.source}:summary`,
    source: opts.source,
    sourceLabel: opts.sourceLabel,
    title: opts.title,
    subtitle: opts.subtitle,
    submittedAt: opts.at,
    sdi: null,
    storeName: null,
    tier: "yellow",
    score: null,
    amount: null,
    flagged: 0,
    prior: null,
    deepLink: opts.deepLink,
  };
}

function moneyToNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function pafRow(p: PafRow): ApprovalItem {
  const amount =
    moneyToNumber(p.reg_pay_rate) ??
    moneyToNumber(p.new_pay_rate) ??
    null;
  // PAF tier: any item in the SDO queue is awaiting a decision, but
  // none have audit-style critical failures. Yellow = "needs your
  // attention" without crying wolf.
  const tier: Tier = "yellow";
  return {
    id: `paf:${p.id}`,
    source: "paf",
    sourceLabel: "PAF",
    title: p.employee_name || p.category,
    subtitle: [p.category, p.store_name].filter(Boolean).join(" · "),
    submittedAt: p.pay_period_end,
    sdi: p.drive_in || null,
    storeName: p.store_name ?? null,
    tier,
    score: null,
    amount,
    flagged: 0,
    prior: null,
    deepLink: `/paf/queue?id=${encodeURIComponent(p.id)}`,
  };
}

// Over the top approval tier ($1,750) a quote can't be cleared in-app — it
// needs a recorded WhatsApp / Owner sign-off. Mirrors ApprovalSection's
// WHATSAPP_THRESHOLD_CENTS (175000). Such items still belong in the RVP's
// approvals list; we surface them red with a clear notice so they're not
// missed and the approver knows the WhatsApp step is required.
const WHATSAPP_THRESHOLD_DOLLARS = 1750;

function woRow(item: OpenAlertItem, tier: Tier): ApprovalItem {
  const amount = item.cost_estimate ?? null;
  const needsWhatsapp = amount != null && amount > WHATSAPP_THRESHOLD_DOLLARS;
  return {
    id: `work_order:${item.id}`,
    source: "work_order",
    sourceLabel: "Work Order",
    title: item.summary || item.wo_number || "Work order",
    subtitle: [item.priority, item.vendor_name].filter(Boolean).join(" · "),
    submittedAt: item.timestamp,
    sdi: item.store_number || null,
    // OpenAlertItem only carries store_number; the full store name
    // isn't in the payload. The row falls back to showing SDI alone,
    // which matches what the WO2 alerts widget does already.
    storeName: null,
    tier: needsWhatsapp ? "red" : tier,
    score: null,
    amount,
    flagged: item.is_business_critical ? 1 : 0,
    prior: needsWhatsapp ? "Over $1,750 — needs WhatsApp approval" : null,
    // WO2 routes deep-link via ?ticket=<id>
    deepLink: `/admin/work-orders-v2?ticket=${encodeURIComponent(item.id)}`,
  };
}

// ----------------------------------------------------------------------------
// Public: fetch + merge
// ----------------------------------------------------------------------------

export async function fetchApprovalsQueue(
  callerRole: UserRole | null,
): Promise<ApprovalsQueue> {
  // Run all four sources in parallel, gated to what the caller can act on.
  // Each degrades to empty/null on error so one broken source never blanks
  // the queue.
  const role = callerRole ?? "";
  const wantPaf = PAF_APPROVER_ROLES.has(role);
  const wantWo = WO_APPROVER_ROLES.has(role);
  const wantCash = CASH_ROLES.has(role);
  const wantEa = EA_APPROVER_ROLES.has(role);

  const [pafRes, woRes, cashRes, eaRes] = await Promise.allSettled([
    wantPaf ? listSdoQueue() : Promise.resolve({ pafs: [] as PafRow[] }),
    wantWo ? fetchOpenWorkOrderAlerts() : Promise.resolve(null),
    wantCash ? fetchCashBadges() : Promise.resolve(null),
    wantEa ? listApprovalQueue() : Promise.resolve(null),
  ]);

  const items: ApprovalItem[] = [];
  const nowIso = new Date().toISOString();

  // Work order approvals — only the awaitingApproval bucket (dollar-routed pay
  // approvals). One card per quote.
  if (woRes.status === "fulfilled" && woRes.value) {
    for (const g of woRes.value.groups) {
      if (g.key === "awaitingApproval") {
        for (const it of g.items) items.push(woRow(it, "yellow"));
      }
    }
  }

  // PAF approvals — one card per bonus PAF awaiting the caller's decision.
  if (pafRes.status === "fulfilled") {
    for (const p of pafRes.value.pafs ?? []) items.push(pafRow(p));
  }

  // Cash — one summary row for open alerts + pending deposits to clear.
  if (cashRes.status === "fulfilled" && cashRes.value) {
    const deposits = cashRes.value.pending_deposits ?? 0;
    const alerts = cashRes.value.open_alerts ?? 0;
    const total = deposits + alerts;
    if (total > 0) {
      items.push(
        summaryRow({
          source: "cash",
          sourceLabel: "Cash",
          title: `${total} cash item${total === 1 ? "" : "s"} need attention`,
          subtitle: [
            deposits > 0 ? `${deposits} deposit${deposits === 1 ? "" : "s"} to validate` : null,
            alerts > 0 ? `${alerts} open alert${alerts === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          deepLink: "/admin/cash-management",
          at: nowIso,
        }),
      );
    }
  }

  // Employee actions — one summary row for training credits + PTO to approve.
  if (eaRes.status === "fulfilled" && eaRes.value) {
    const ea =
      (eaRes.value.trainingCredits?.length ?? 0) + (eaRes.value.ptoRequests?.length ?? 0);
    if (ea > 0) {
      items.push(
        summaryRow({
          source: "employee_action",
          sourceLabel: "Employee Actions",
          title: `${ea} employee action${ea === 1 ? "" : "s"} to approve`,
          subtitle: "Training credits & PTO requests",
          deepLink: "/employee-actions",
          at: nowIso,
        }),
      );
    }
  }

  const counts = {
    all: items.length,
    green: items.filter((i) => i.tier === "green").length,
    yellow: items.filter((i) => i.tier === "yellow").length,
    red: items.filter((i) => i.tier === "red").length,
  };

  const bySource = {
    work_order: items.filter((i) => i.source === "work_order").length,
    paf: items.filter((i) => i.source === "paf").length,
    cash: items.filter((i) => i.source === "cash").length,
    employee_action: items.filter((i) => i.source === "employee_action").length,
  };

  return { items, counts, bySource };
}

// "2h ago" / "Yesterday" / "May 12" — pure presentational helper, kept
// next to the data layer so the page doesn't have to know about date math.
export function relativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Dollar formatter for PAF / WO rows. Shows "$3,840" — same shape as
// the design canvas.
export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
