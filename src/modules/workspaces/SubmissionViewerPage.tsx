// /submissions/:id — read-only submission viewer + sign-off chain
// + decision UI. Visible to: submitter, assignee, any candidate
// signer, or workspace member with view_submissions (backend enforces).
//
// Decision UI only renders if (a) there's a pending sign-off row
// (b) on which the current user appears in candidate_user_ids
// (c) at the *current* step (skip if a lower step is still pending).

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, ClipboardCheck, FileText, Check, X, CornerUpLeft,
  CheckCircle2, XCircle, Circle, AlertTriangle, MessageSquare,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getSubmission, approveSignoff, rejectSignoff, requestRevision,
} from "./api";
import type {
  AuditResult, AuditOutcome, SignoffStepStatus, SignoffStatus,
} from "./types";

// The backend joins question metadata onto each answer row. The
// canonical SubmissionAnswer type doesn't include this — narrow inline.
type AnswerWithQ = {
  id: string;
  question_id: string;
  answer_text: string | null;
  answer_number: number | null;
  answer_boolean: boolean | null;
  answer_date: string | null;
  answer_json: unknown;
  attachment_ids: string[] | null;
  audit_result: AuditResult | null;
  audit_was_critical: boolean | null;
  question: {
    id: string;
    section_label: string | null;
    question_text: string;
    field_type: string;
    is_required: boolean;
    is_critical: boolean;
    position: number;
  } | null;
};

type SignoffRow = {
  id: string;
  step_id: string;
  step_number: number;
  status: SignoffStepStatus;
  acted_by_id: string | null;
  acted_at: string | null;
  notes: string | null;
  candidate_user_ids: string[];
};

function submissionTone(s: SignoffStatus): "neutral" | "info" | "warning" | "success" | "danger" {
  if (s === "approved")          return "success";
  if (s === "rejected")          return "danger";
  if (s === "revision_requested") return "warning";
  if (s === "in_review")          return "info";
  return "warning";
}

function auditTone(o: AuditOutcome | null): "success" | "warning" | "danger" | "neutral" {
  if (o === "pass")           return "success";
  if (o === "fail")           return "warning";
  if (o === "fail_critical")  return "danger";
  return "neutral";
}

export function SubmissionViewerPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [decisionNotes, setDecisionNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmission(id!),
    enabled: !!id,
  });

  const approveMut = useMutation({
    mutationFn: (signoffId: string) =>
      approveSignoff(signoffId, decisionNotes.trim() || undefined),
    onSuccess: () => { setDecisionNotes(""); setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Approve failed."),
  });

  const rejectMut = useMutation({
    mutationFn: (signoffId: string) => rejectSignoff(signoffId, decisionNotes.trim()),
    onSuccess: () => { setDecisionNotes(""); setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Reject failed."),
  });

  const reviseMut = useMutation({
    mutationFn: (signoffId: string) => requestRevision(signoffId, decisionNotes.trim()),
    onSuccess: () => { setDecisionNotes(""); setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Request revision failed."),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load submission: {(query.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/signoffs">
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
      </Card>
    );
  }

  const sub = query.data.submission;
  const answers = query.data.answers as unknown as AnswerWithQ[];
  const signoffs = query.data.signoffs as unknown as SignoffRow[];

  // The "actionable" sign-off for the current user, if any.
  // Skip if any *earlier* step is still pending — only the current
  // step in the chain is actionable.
  const sortedSignoffs = [...signoffs].sort((a, b) => a.step_number - b.step_number);
  const firstPendingIdx = sortedSignoffs.findIndex((s) => s.status === "pending");
  const currentStep = firstPendingIdx >= 0 ? sortedSignoffs[firstPendingIdx] : null;
  const canDecide = !!currentStep
    && !!profile
    && currentStep.candidate_user_ids.includes(profile.id);

  // Group answers by section.
  const grouped = groupBySection(answers);

  const isAudit = sub.audit_outcome != null || sub.audit_score_possible != null;

  return (
    <div className="space-y-4">
      <Link
        to="/signoffs"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign-off queue
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {isAudit ? (
              <ClipboardCheck className="h-5 w-5 text-gray-400" />
            ) : (
              <FileText className="h-5 w-5 text-gray-400" />
            )}
            Submission · v{sub.version_number}
          </span>
        }
        description={`Submitted ${new Date(sub.submitted_at).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={submissionTone(sub.signoff_status)}>{sub.signoff_status.replace("_", " ")}</Badge>
            {sub.audit_outcome && (
              <Badge tone={auditTone(sub.audit_outcome)}>
                {sub.audit_outcome.replace("_", " ")}
              </Badge>
            )}
          </div>
        }
      />

      {/* Audit summary */}
      {isAudit && (
        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <div>
              <span className="text-gray-500">Score:</span>{" "}
              <strong>
                {sub.audit_score_total ?? 0} / {sub.audit_score_possible ?? 0}
              </strong>
              {sub.audit_score_percent != null && (
                <span> ({sub.audit_score_percent}%)</span>
              )}
            </div>
            {sub.audit_critical_failed && (
              <div className="inline-flex items-center gap-1 text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                One or more critical questions failed.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Sign-off chain */}
      {sortedSignoffs.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 text-sm">Sign-off chain</h3>
          <div className="space-y-2">
            {sortedSignoffs.map((s) => <StepRow key={s.id} step={s} />)}
          </div>
        </Card>
      )}

      {/* Decision UI (only for the current pending step's candidates) */}
      {canDecide && currentStep && (
        <Card className="p-4 space-y-3 border-blue-300 bg-blue-50/30">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Your decision · step {currentStep.step_number}
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              You're a candidate signer for this step. Approve to advance,
              reject to terminate, or request a revision to send back to the
              submitter for changes.
            </p>
          </div>
          <textarea
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
            rows={2}
            placeholder="Notes (required for reject and revision)"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => approveMut.mutate(currentStep.id)}
              disabled={approveMut.isPending || rejectMut.isPending || reviseMut.isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              {approveMut.isPending ? "Approving..." : "Approve"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!decisionNotes.trim()) {
                  setActionError("Notes are required when requesting a revision.");
                  return;
                }
                reviseMut.mutate(currentStep.id);
              }}
              disabled={approveMut.isPending || rejectMut.isPending || reviseMut.isPending}
            >
              <CornerUpLeft className="h-4 w-4 mr-1" />
              {reviseMut.isPending ? "Requesting..." : "Request revision"}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!decisionNotes.trim()) {
                  setActionError("Notes are required when rejecting.");
                  return;
                }
                rejectMut.mutate(currentStep.id);
              }}
              disabled={approveMut.isPending || rejectMut.isPending || reviseMut.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              {rejectMut.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </div>
          {actionError && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {actionError}
            </div>
          )}
        </Card>
      )}

      {/* Answers, grouped by section */}
      <div className="space-y-4">
        {grouped.map((section, sIdx) => (
          <div key={sIdx} className="space-y-2">
            {section.label && (
              <h3 className="text-sm font-semibold text-gray-700">{section.label}</h3>
            )}
            <Card className="p-0 overflow-hidden">
              <div className="divide-y divide-gray-200">
                {section.items.map((a) => <AnswerRow key={a.id} answer={a} />)}
              </div>
            </Card>
          </div>
        ))}
        {grouped.length === 0 && (
          <Card className="p-6 text-center text-sm text-gray-500">
            No answers recorded.
          </Card>
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: SignoffRow }) {
  let Icon = Circle;
  let cls = "text-gray-400";
  if (step.status === "approved")  { Icon = CheckCircle2; cls = "text-green-600"; }
  if (step.status === "rejected")  { Icon = XCircle;      cls = "text-red-600"; }
  if (step.status === "skipped")   { Icon = Circle;       cls = "text-gray-300"; }
  // pending stays default

  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${cls}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">Step {step.step_number}</span>
          <Badge tone={
            step.status === "approved" ? "success"
            : step.status === "rejected" ? "danger"
            : step.status === "skipped" ? "neutral"
            : "warning"
          }>
            {step.status}
          </Badge>
        </div>
        {step.acted_at && (
          <div className="text-xs text-gray-500">
            Actioned {new Date(step.acted_at).toLocaleString()}
          </div>
        )}
        {step.notes && (
          <div className="text-xs mt-1 italic text-gray-700">
            "{step.notes}"
          </div>
        )}
      </div>
    </div>
  );
}

function AnswerRow({ answer }: { answer: AnswerWithQ }) {
  const q = answer.question;
  if (!q) return null;

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {q.question_text}
          {q.is_required && <span className="text-red-600 ml-1">*</span>}
        </div>
        <div className="text-sm text-gray-800 mt-1">
          {renderAnswerValue(answer)}
        </div>
      </div>
      {q.field_type === "pass_fail_na" && answer.audit_result && (
        <AuditPill result={answer.audit_result} critical={!!answer.audit_was_critical} />
      )}
    </div>
  );
}

function renderAnswerValue(a: AnswerWithQ): React.ReactNode {
  const ft = a.question?.field_type;
  if (ft === "pass_fail_na") return null; // shown as pill in AnswerRow

  if (a.answer_text != null && a.answer_text !== "") return a.answer_text;
  if (a.answer_number != null) return String(a.answer_number);
  if (a.answer_boolean != null) return a.answer_boolean ? "Yes" : "No";
  if (a.answer_date) return a.answer_date;
  if (Array.isArray(a.answer_json)) return (a.answer_json as string[]).join(", ") || <em className="text-gray-400">—</em>;
  if (a.answer_json != null) return <code className="text-xs">{JSON.stringify(a.answer_json)}</code>;
  if (a.attachment_ids?.length) {
    return <span className="text-xs text-gray-500">{a.attachment_ids.length} attachment(s) — viewer ships in a follow-up</span>;
  }
  return <em className="text-gray-400">— (no answer)</em>;
}

function AuditPill({ result, critical }: { result: AuditResult; critical: boolean }) {
  const cls = result === "pass"
    ? "bg-green-100 text-green-700 border-green-200"
    : result === "fail"
    ? "bg-red-100 text-red-700 border-red-200"
    : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <div className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {result.toUpperCase()}
      {critical && result === "fail" && (
        <span title="Critical question" className="ml-0.5">⚠</span>
      )}
    </div>
  );
}

function groupBySection(answers: AnswerWithQ[]) {
  const sorted = [...answers].sort(
    (a, b) => (a.question?.position ?? 0) - (b.question?.position ?? 0),
  );
  const out: Array<{ label: string | null; items: AnswerWithQ[] }> = [];
  let cur: { label: string | null; items: AnswerWithQ[] } | null = null;
  for (const a of sorted) {
    const lbl = a.question?.section_label ?? null;
    if (!cur || cur.label !== lbl) {
      cur = { label: lbl, items: [] };
      out.push(cur);
    }
    cur.items.push(a);
  }
  return out;
}
