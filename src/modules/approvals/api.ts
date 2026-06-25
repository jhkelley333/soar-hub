// Unified approvals queue. Merges three sources that each have their
// own pending-decision pipeline today:
//
//   1. Workspace sign-offs   — listMySignoffs() (audits/forms/walkthroughs)
//   2. PAF approvals         — listSdoQueue()   (bonus PAFs awaiting SDO+)
//   3. Work order approvals  — fetchOpenWorkOrderAlerts() filtered to
//                              "awaitingApproval" only (dollar-routed
//                              pay approvals; emergencies are awareness
//                              reminders, not pay decisions)
//
// Each source's row gets normalized into a single ApprovalItem shape so
// the page can render them in one tier-sorted list. Each row deep-links
// back to its native detail page where the actual decision is made.
//
// RLS / role gating: every source is already scoped to what the caller
// can see at the server. We additionally skip the PAF and WO pulls when
// the caller's role doesn't approve those sources at all, so we don't
// burn API calls.

import { listMySignoffs } from "@/modules/workspaces/api";
import { listSdoQueue } from "@/modules/paf/api";
import {
  fetchOpenWorkOrderAlerts,
  type OpenAlertItem,
} from "@/modules/work-orders-v2/api";
import type { PafRow } from "@/modules/paf/types";
import type { UserRole } from "@/types/database";
import type { Tier } from "@/shared/ui/Tier";

export type ApprovalSource = "workspace" | "paf" | "work_order";

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
  bySource: { workspace: number; paf: number; work_order: number };
}

// ----------------------------------------------------------------------------
// Source-specific raw types (narrow inline rather than widen each module's
// canonical types, mirroring the existing pattern in SignoffQueuePage).
// ----------------------------------------------------------------------------

type RawSignoff = {
  id: string;
  submission_id: string;
  step_number: number;
  created_at: string;
  step: { label: string | null } | null;
  submission: {
    id: string;
    submitted_at: string;
    signoff_status: string;
    audit_outcome: "pass" | "fail" | "fail_critical" | null;
    audit_score_percent: number | null;
    audit_critical_failed: boolean | null;
    assignment: {
      id: string;
      workspaces: { id: string; name: string } | null;
      workspace_templates: { id: string; name: string; type: "form" | "audit" } | null;
      store: { id: string; store_number: string | null; name: string | null } | null;
    } | null;
  } | null;
};

// ----------------------------------------------------------------------------
// Role gating
// ----------------------------------------------------------------------------

const PAF_APPROVER_ROLES = new Set<UserRole>(["sdo", "rvp", "vp", "coo", "admin"]);
const WO_APPROVER_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);

// ----------------------------------------------------------------------------
// Normalizers
// ----------------------------------------------------------------------------

function tierFromOutcome(
  outcome: "pass" | "fail" | "fail_critical" | null,
): Tier {
  if (outcome === "fail_critical") return "red";
  if (outcome === "fail") return "yellow";
  return "green";
}

function priorActionFor(status: string): string | null {
  if (status === "resubmitted") return "Resubmitted after revision";
  if (status === "needs_revision") return "Returned for revision";
  return null;
}

function workspaceRow(raw: RawSignoff): ApprovalItem | null {
  const s = raw.submission;
  if (!s) return null;
  const a = s.assignment;
  const tpl = a?.workspace_templates;
  return {
    id: `workspace:${raw.id}`,
    source: "workspace",
    sourceLabel: "Submission",
    title: tpl?.name ?? "Submission",
    subtitle: a?.workspaces?.name ?? "",
    submittedAt: s.submitted_at,
    sdi: a?.store?.store_number ?? null,
    storeName: a?.store?.name ?? null,
    tier: tierFromOutcome(s.audit_outcome),
    score: s.audit_score_percent,
    amount: null,
    flagged: s.audit_critical_failed ? 1 : 0,
    prior: priorActionFor(s.signoff_status),
    deepLink: `/submissions/${s.id}`,
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

function woRow(item: OpenAlertItem, tier: Tier): ApprovalItem {
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
    tier,
    score: null,
    amount: item.cost_estimate ?? null,
    flagged: item.is_business_critical ? 1 : 0,
    prior: null,
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
  // Run all three sources in parallel. Each falls back to an empty
  // list on error so one broken source doesn't take down the queue.
  const wantPaf = callerRole != null && PAF_APPROVER_ROLES.has(callerRole);
  const wantWo = callerRole != null && WO_APPROVER_ROLES.has(callerRole);

  const [signoffsRes, pafRes, woRes] = await Promise.allSettled([
    listMySignoffs(),
    wantPaf ? listSdoQueue() : Promise.resolve({ pafs: [] as PafRow[] }),
    wantWo ? fetchOpenWorkOrderAlerts() : Promise.resolve(null),
  ]);

  const items: ApprovalItem[] = [];

  // Workspace sign-offs
  if (signoffsRes.status === "fulfilled") {
    const raws = (signoffsRes.value.signoffs ?? []) as unknown as RawSignoff[];
    for (const r of raws) {
      const row = workspaceRow(r);
      if (row) items.push(row);
    }
  }

  // PAFs
  if (pafRes.status === "fulfilled") {
    for (const p of pafRes.value.pafs ?? []) items.push(pafRow(p));
  }

  // Work orders — ONLY the awaitingApproval group belongs in this queue.
  // Those are the rows where someone requested approval to pay, routed to
  // the caller's tier by dollar amount (tierForAmount: <$500 DO, $500-1000
  // SDO, >$1000 RVP). The other OpenAlerts groups — emergencies, new24h,
  // stuck — are awareness reminders, not pay decisions, and were polluting
  // the queue with work orders that don't need an approval at all.
  if (woRes.status === "fulfilled" && woRes.value) {
    for (const g of woRes.value.groups) {
      if (g.key === "awaitingApproval") {
        for (const it of g.items) items.push(woRow(it, "yellow"));
      }
    }
  }

  const counts = {
    all: items.length,
    green: items.filter((i) => i.tier === "green").length,
    yellow: items.filter((i) => i.tier === "yellow").length,
    red: items.filter((i) => i.tier === "red").length,
  };

  const bySource = {
    workspace: items.filter((i) => i.source === "workspace").length,
    paf: items.filter((i) => i.source === "paf").length,
    work_order: items.filter((i) => i.source === "work_order").length,
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
