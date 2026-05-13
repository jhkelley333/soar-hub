// Approval controls inside the expanded ticket card. Two flows:
//
//   1. Submit Approval — anyone with access can request approval for a
//      specific tier (DO / SDO / VP). Inline form (tier + notes + quote URL).
//      Backend logs the row + flips the ticket's approval_status to Pending.
//
//   2. Decide Approval — DO+ only. When the latest approval row is
//      Pending, show Approve/Reject buttons. Rejection requires a note.
//
// The backend `decideApproval` enforces the role gate (roleLevel <= 3),
// but we mirror it client-side so non-DO admins (e.g. payroll, GM) don't
// see the buttons at all.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { decideApproval, submitApproval } from "./api";
import {
  APPROVAL_TIERS,
  type ApprovalTier,
  type Ticket,
  type TicketApproval,
} from "./types";

interface Props {
  ticket: Ticket;
  callerRole: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}

// Role hierarchy from the backend. Mirrored here so the UI hides
// approve/reject buttons for users who can't actually use them.
const ROLE_LEVEL: Record<string, number> = {
  admin: 1, coo: 1, vp: 1,
  rvp: 2, sdo: 2,
  do: 3,
  gm: 4,
  shift_manager: 5,
  payroll: 6,
};

function isApprover(role: string): boolean {
  const lvl = ROLE_LEVEL[role.toLowerCase()] ?? 99;
  return lvl <= 3;
}

function badgeTone(status: TicketApproval["status"]) {
  if (status === "Approved") return "success" as const;
  if (status === "Rejected") return "danger" as const;
  return "warning" as const;
}

export function ApprovalSection({
  ticket,
  callerRole,
  onChanged,
  onError,
}: Props) {
  const approvals = ticket.ticket_approvals ?? [];
  const latest = approvals.length > 0 ? approvals[approvals.length - 1] : null;

  const [requesting, setRequesting] = useState(false);
  const [tier, setTier] = useState<ApprovalTier>(APPROVAL_TIERS[0].value);
  const [notes, setNotes] = useState("");
  const [quoteUrl, setQuoteUrl] = useState("");

  const submit = useMutation({
    mutationFn: () => {
      if (!notes.trim()) {
        return Promise.reject(new Error("Approval notes are required."));
      }
      return submitApproval({
        id: ticket.id,
        approvalTier: tier,
        approvalNotes: notes.trim(),
        quoteUrl: quoteUrl.trim() || undefined,
      });
    },
    onSuccess: () => {
      setRequesting(false);
      setNotes("");
      setQuoteUrl("");
      onChanged();
    },
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Submit failed."),
  });

  const decide = useMutation({
    mutationFn: (vars: { decision: "Approved" | "Rejected"; notes: string }) => {
      if (!latest) return Promise.reject(new Error("No pending approval."));
      if (vars.decision === "Rejected" && !vars.notes.trim()) {
        return Promise.reject(new Error("A reason is required to reject."));
      }
      return decideApproval({
        id: ticket.id,
        approvalId: latest.id,
        decision: vars.decision,
        notes: vars.notes.trim() || undefined,
      });
    },
    onSuccess: onChanged,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Decision failed."),
  });

  function handleDecide(decision: "Approved" | "Rejected") {
    const noteFromUser =
      decision === "Approved"
        ? window.prompt("Approval notes (optional):", "") ?? ""
        : window.prompt("Reason for rejection:", "") ?? "";
    if (decision === "Rejected" && !noteFromUser.trim()) {
      onError("A reason is required to reject.");
      return;
    }
    decide.mutate({ decision, notes: noteFromUser });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Approval
        </div>
        {!latest && !requesting && (
          <button
            type="button"
            onClick={() => setRequesting(true)}
            className="text-xs font-medium text-accent hover:underline"
          >
            Request approval →
          </button>
        )}
      </div>

      {latest && (
        <div className="rounded-md border border-zinc-100 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(latest.status)}>{latest.status}</Badge>
            <span className="text-xs text-zinc-500">{latest.approval_tier}</span>
            {latest.approved_by && (
              <span className="text-xs text-zinc-500">
                by <span className="font-medium text-zinc-700">{latest.approved_by}</span>
              </span>
            )}
            {latest.quote_url && (
              <a
                href={latest.quote_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-accent hover:underline"
              >
                Quote ↗
              </a>
            )}
          </div>
          {latest.notes && (
            <div className="mt-1.5 whitespace-pre-wrap text-xs text-zinc-700">
              {latest.notes}
            </div>
          )}
          {latest.status === "Pending" && isApprover(callerRole) && (
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                onClick={() => handleDecide("Approved")}
                disabled={decide.isPending}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Approve
              </Button>
              <Button
                variant="ghost"
                onClick={() => handleDecide("Rejected")}
                disabled={decide.isPending}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Reject
              </Button>
              {decide.isPending && (
                <Loader2 className="my-auto h-3.5 w-3.5 animate-spin text-zinc-400" />
              )}
            </div>
          )}
        </div>
      )}

      {requesting && (
        <div className="space-y-3 rounded-md border border-zinc-100 bg-white p-3">
          <div>
            <Label htmlFor={`appr-tier-${ticket.id}`}>Approval Tier *</Label>
            <select
              id={`appr-tier-${ticket.id}`}
              value={tier}
              onChange={(e) => setTier(e.target.value as ApprovalTier)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {APPROVAL_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor={`appr-notes-${ticket.id}`}>Request Notes *</Label>
            <textarea
              id={`appr-notes-${ticket.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Describe the work, cost, and reason for approval…"
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor={`appr-quote-${ticket.id}`}>Quote URL</Label>
            <Input
              id={`appr-quote-${ticket.id}`}
              value={quoteUrl}
              onChange={(e) => setQuoteUrl(e.target.value)}
              placeholder="https://drive.google.com/…  (optional)"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
            >
              {submit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Submit Request
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRequesting(false)}
              disabled={submit.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
