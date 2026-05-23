// Approvals queue — DO+ view of every pending sign-off across all
// workspaces the caller covers. Wraps the existing `listMySignoffs()`
// (which the server already scopes to candidate_user_ids for the
// caller) and maps each row into a display-friendly shape.
//
// Real data: store, template name, submitted_at, audit_score_percent,
// audit_outcome. Tier is derived from audit_outcome (pass → green,
// fail → yellow, fail_critical → red).

import { listMySignoffs } from "@/modules/workspaces/api";
import type { Tier } from "@/shared/ui/Tier";

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

export interface ApprovalRow {
  signoffId: string;
  submissionId: string;
  stepLabel: string;
  type: string;                  // template name, e.g. "Weekly Walkthrough"
  workspaceName: string;
  submittedAt: string;           // ISO
  sdi: string | null;            // store_number
  storeName: string | null;
  tier: Tier;
  score: number | null;          // 0-100, null when not audited
  flagged: number;               // 1 when audit_critical_failed, else 0
  prior: string | null;          // human-readable "prior action" hint
}

export interface ApprovalsQueue {
  rows: ApprovalRow[];
  counts: { all: number; green: number; yellow: number; red: number };
}

function tierFromOutcome(
  outcome: "pass" | "fail" | "fail_critical" | null,
): Tier {
  if (outcome === "fail_critical") return "red";
  if (outcome === "fail") return "yellow";
  // pass or null (no audit) — treat both as green; non-audit forms
  // have no critical failures, so they don't deserve a yellow flag.
  return "green";
}

function priorActionFor(status: string): string | null {
  if (status === "resubmitted") return "Resubmitted after revision";
  if (status === "needs_revision") return "Returned for revision";
  return null;
}

function mapRow(raw: RawSignoff): ApprovalRow | null {
  const s = raw.submission;
  if (!s) return null;
  const a = s.assignment;
  const tpl = a?.workspace_templates;
  return {
    signoffId: raw.id,
    submissionId: s.id,
    stepLabel: raw.step?.label ?? `Step ${raw.step_number}`,
    type: tpl?.name ?? "Submission",
    workspaceName: a?.workspaces?.name ?? "",
    submittedAt: s.submitted_at,
    sdi: a?.store?.store_number ?? null,
    storeName: a?.store?.name ?? null,
    tier: tierFromOutcome(s.audit_outcome),
    score: s.audit_score_percent,
    flagged: s.audit_critical_failed ? 1 : 0,
    prior: priorActionFor(s.signoff_status),
  };
}

export async function fetchApprovalsQueue(): Promise<ApprovalsQueue> {
  const res = await listMySignoffs();
  const raws = (res.signoffs ?? []) as unknown as RawSignoff[];
  const rows = raws.map(mapRow).filter((r): r is ApprovalRow => r != null);
  const counts = {
    all: rows.length,
    green: rows.filter((r) => r.tier === "green").length,
    yellow: rows.filter((r) => r.tier === "yellow").length,
    red: rows.filter((r) => r.tier === "red").length,
  };
  return { rows, counts };
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
