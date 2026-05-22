// /caps/:id — single CAP view. Top: source question + status. Below:
// proofs timeline + action card. Roles:
//   • assignee on open                  → Start (open → in_progress)
//   • assignee on in_progress/reopened  → Submit proof (notes + future attachments)
//   • verifier on proof_submitted       → Accept / Reject the latest proof
//   • viewer (anyone else)              → read-only

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Play, Send, Check, X, AlertOctagon, AlertTriangle,
  RefreshCw, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getCap, startCap, createCapProof, verifyCapProof,
} from "./api";
import type { CapStatus, CapProof, CorrectiveActionPlan } from "./types";

type RichCap = CorrectiveActionPlan & {
  assignee?: { id: string; full_name: string | null; email: string | null; role: string | null } | null;
  verifier?: { id: string; full_name: string | null; email: string | null; role: string | null } | null;
  store?: { id: string; store_number: string | null; name: string | null } | null;
  question?: {
    id: string; question_text: string; is_critical: boolean;
    weight: number | null; field_type: string;
  } | null;
  submission?: { id: string; submitted_at: string } | null;
  answer?: { id: string; audit_result: string | null; answer_text: string | null } | null;
};

type RichProof = CapProof & {
  submitter?: { id: string; full_name: string | null; email: string | null } | null;
  verifier?: { id: string; full_name: string | null; email: string | null } | null;
};

function statusTone(s: CapStatus): "neutral" | "info" | "warning" | "success" | "danger" {
  if (s === "verified" || s === "closed") return "success";
  if (s === "proof_submitted")            return "info";
  if (s === "reopened")                    return "danger";
  if (s === "in_progress")                return "info";
  return "warning";
}

export function CapDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [proofNotes, setProofNotes] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["cap", id],
    queryFn: () => getCap(id!),
    enabled: !!id,
  });

  const startMut = useMutation({
    mutationFn: () => startCap(id!),
    onSuccess: () => { setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Failed."),
  });

  const proofMut = useMutation({
    mutationFn: () => createCapProof({ cap_id: id!, notes: proofNotes.trim() || undefined }),
    onSuccess: () => { setProofNotes(""); setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Submit proof failed."),
  });

  const verifyMut = useMutation({
    mutationFn: (args: { proof_id: string; accepted: boolean }) =>
      verifyCapProof({
        proof_id: args.proof_id,
        accepted: args.accepted,
        verifier_notes: verifyNotes.trim() || undefined,
      }),
    onSuccess: () => { setVerifyNotes(""); setActionError(null); query.refetch(); },
    onError: (e) => setActionError((e as Error)?.message ?? "Verify failed."),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load CAP: {(query.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/caps">
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
      </Card>
    );
  }

  const cap = query.data.cap as RichCap;
  const proofs = query.data.proofs as RichProof[];

  const isAssignee = profile?.id === cap.assignee_id;
  const isVerifier = profile?.id === cap.verifier_id;

  const canStart = isAssignee && cap.status === "open";
  const canSubmitProof = isAssignee && (cap.status === "in_progress" || cap.status === "reopened");
  // Verifier acts on the *latest* proof when status is proof_submitted.
  const latestPendingProof = [...proofs]
    .reverse()
    .find((p) => p.verified_status == null);
  const canVerify = isVerifier && cap.status === "proof_submitted" && !!latestPendingProof;

  return (
    <div className="space-y-4">
      <Link
        to="/caps"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> My CAPs
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-gray-400" />
            {cap.question?.question_text ?? "(question deleted)"}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(cap.status)}>{cap.status.replace("_", " ")}</Badge>
            {cap.reopened_count > 0 && (
              <Badge tone="danger">
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> reopened ×{cap.reopened_count}
                </span>
              </Badge>
            )}
            {cap.question?.is_critical && (
              <Badge tone="warning">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> critical
                </span>
              </Badge>
            )}
          </div>
        }
      />

      {/* Details */}
      <Card className="p-5 space-y-2 text-sm">
        <Row
          label="Workspace"
          value={
            <Link to={`/workspaces/${cap.workspace_id}`} className="text-blue-600 hover:underline">
              open workspace
            </Link>
          }
        />
        {cap.store && (
          <Row
            label="Store"
            value={
              cap.store.store_number
                ? `#${cap.store.store_number}${cap.store.name ? ` — ${cap.store.name}` : ""}`
                : cap.store.name || "—"
            }
          />
        )}
        <Row
          label="Assignee"
          value={cap.assignee?.full_name || cap.assignee?.email || "—"}
        />
        <Row
          label="Verifier"
          value={cap.verifier?.full_name || cap.verifier?.email || "—"}
        />
        <Row
          label="Due"
          value={cap.due_at ? new Date(cap.due_at).toLocaleString() : "—"}
        />
        {cap.submission && (
          <Row
            label="Source submission"
            value={
              <Link to={`/submissions/${cap.submission.id}`} className="text-blue-600 hover:underline">
                {new Date(cap.submission.submitted_at).toLocaleDateString()}
              </Link>
            }
          />
        )}
        {cap.template_instructions && (
          <div className="pt-2 border-t">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Instructions
            </div>
            <p className="whitespace-pre-line">{cap.template_instructions}</p>
          </div>
        )}
        {cap.failure_notes && (
          <div className="pt-2 border-t">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
              Failure notes (from submitter)
            </div>
            <p className="whitespace-pre-line italic text-gray-700">{cap.failure_notes}</p>
          </div>
        )}
      </Card>

      {/* Action card */}
      {canStart && (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">Ready to start?</h3>
          <p className="text-sm text-gray-600 mb-3">
            Starting marks this CAP in-progress. You can submit proof of
            completion once you've made the fix.
          </p>
          <Button onClick={() => startMut.mutate()} disabled={startMut.isPending}>
            <Play className="h-4 w-4 mr-1" />
            {startMut.isPending ? "Starting..." : "Start"}
          </Button>
        </Card>
      )}

      {canSubmitProof && (
        <Card className="p-5 space-y-3 border-blue-300 bg-blue-50/30">
          <div>
            <h3 className="font-semibold text-sm">Submit proof of fix</h3>
            <p className="text-xs text-gray-600 mt-1">
              Describe what was done. The verifier will accept or reject. If
              rejected, the CAP reopens for another attempt.
            </p>
          </div>
          <textarea
            value={proofNotes}
            onChange={(e) => setProofNotes(e.target.value)}
            rows={3}
            placeholder="What did you fix? Anything the verifier should know?"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
            Attaching photos / files ships in a follow-up slice. For now,
            describe the fix in notes.
          </div>
          <Button
            onClick={() => proofMut.mutate()}
            disabled={proofMut.isPending || !proofNotes.trim()}
          >
            <Send className="h-4 w-4 mr-1" />
            {proofMut.isPending ? "Submitting..." : "Submit proof"}
          </Button>
        </Card>
      )}

      {canVerify && latestPendingProof && (
        <Card className="p-5 space-y-3 border-blue-300 bg-blue-50/30">
          <div>
            <h3 className="font-semibold text-sm">Verify the latest proof</h3>
            <p className="text-xs text-gray-600 mt-1">
              Accept to close the CAP. Reject to send it back for another
              attempt — assignee gets it as a reopened CAP.
            </p>
          </div>
          <textarea
            value={verifyNotes}
            onChange={(e) => setVerifyNotes(e.target.value)}
            rows={2}
            placeholder="Verifier notes (required for reject)"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => verifyMut.mutate({ proof_id: latestPendingProof.id, accepted: true })}
              disabled={verifyMut.isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              {verifyMut.isPending ? "Working..." : "Accept"}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!verifyNotes.trim()) {
                  setActionError("Notes are required when rejecting a proof.");
                  return;
                }
                verifyMut.mutate({ proof_id: latestPendingProof.id, accepted: false });
              }}
              disabled={verifyMut.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </div>
        </Card>
      )}

      {actionError && (
        <Card className="p-3 text-sm text-red-600 bg-red-50 border-red-200">
          {actionError}
        </Card>
      )}

      {/* Proofs timeline */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Proofs ({proofs.length})
        </h3>
        {proofs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-gray-500">
            No proofs submitted yet.
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-gray-200">
              {proofs.map((p) => <ProofRow key={p.id} proof={p} />)}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ProofRow({ proof }: { proof: RichProof }) {
  let Icon = Clock;
  let cls = "text-amber-600";
  if (proof.verified_status === "accepted") { Icon = CheckCircle2; cls = "text-green-600"; }
  if (proof.verified_status === "rejected") { Icon = XCircle;      cls = "text-red-600"; }

  const submitter = proof.submitter?.full_name || proof.submitter?.email || "—";
  const verifier = proof.verifier?.full_name || proof.verifier?.email || null;

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${cls}`} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{submitter}</span>
          <span className="text-xs text-gray-500">
            {new Date(proof.submitted_at).toLocaleString()}
          </span>
          {proof.verified_status && (
            <Badge tone={proof.verified_status === "accepted" ? "success" : "danger"}>
              {proof.verified_status}
            </Badge>
          )}
        </div>
        {proof.notes && (
          <div className="text-sm text-gray-800 whitespace-pre-line">{proof.notes}</div>
        )}
        {proof.attachment_ids?.length ? (
          <div className="text-xs text-gray-500">
            {proof.attachment_ids.length} attachment(s) — viewer ships in a follow-up
          </div>
        ) : null}
        {proof.verified_at && (
          <div className="text-xs text-gray-500 pt-1 border-t">
            {proof.verified_status === "accepted" ? "Accepted" : "Rejected"} by{" "}
            {verifier ?? "—"} on {new Date(proof.verified_at).toLocaleString()}
            {proof.verifier_notes && (
              <div className="italic text-gray-700 mt-0.5">"{proof.verifier_notes}"</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}
