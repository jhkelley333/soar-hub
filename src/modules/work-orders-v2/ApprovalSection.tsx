// Approval controls inside the expanded ticket card. Two flows:
//
//   1. Submit Approval — anyone with access can request approval for a
//      specific tier (DO / SDO / VP). Inline form (tier + notes + quote
//      file). The quote file goes through the same wo2-ticket-photos
//      bucket with upload_type='quote'; the resulting public URL is
//      written into the approval row's quote_url column.
//
//   2. Decide Approval — DO+ only. When the latest approval row is
//      Pending, show Approve/Reject buttons. Rejection requires a note.
//
// The backend `decideApproval` enforces the role gate (roleLevel <= 3),
// but we mirror it client-side so non-DO admins (e.g. payroll, GM) don't
// see the buttons at all.

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, Paperclip, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { decideApproval, fileToBase64, submitApproval, uploadPhoto } from "./api";
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
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!notes.trim()) {
        throw new Error("Approval notes are required.");
      }
      // If a file is attached, upload it first via the photos endpoint
      // with upload_type='quote'. Same bucket as ticket photos — the
      // upload_type column keeps them straight.
      let finalUrl: string | undefined = undefined;
      if (quoteFile) {
        const photoData = await fileToBase64(quoteFile);
        const result = await uploadPhoto({
          id: ticket.id,
          photoData,
          photoType: quoteFile.type || "application/octet-stream",
          photoName: quoteFile.name,
          uploadType: "quote",
        });
        if (result.photo?.file_url) finalUrl = result.photo.file_url;
      }
      return submitApproval({
        id: ticket.id,
        approvalTier: tier,
        approvalNotes: notes.trim(),
        quoteUrl: finalUrl,
      });
    },
    onSuccess: () => {
      setRequesting(false);
      setNotes("");
      setQuoteFile(null);
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
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Approval
      </div>

      {/* Prominent CTA when no approval has been requested yet. */}
      {!latest && !requesting && (
        <button
          type="button"
          onClick={() => setRequesting(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100"
        >
          <FileText className="h-4 w-4" strokeWidth={1.75} />
          Request Approval
        </button>
      )}

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
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
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
          {/* Allow another approval round on an already-decided ticket. */}
          {latest.status !== "Pending" && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setRequesting(true)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Submit another approval request →
              </button>
            </div>
          )}
        </div>
      )}

      {requesting && (
        <div className="mt-2 space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
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

          {/* Quote attachment — file only. Uploads via the photo
              endpoint with upload_type='quote' before submit. */}
          <div>
            <Label>Attach Quote</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submit.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 transition hover:border-accent hover:bg-accent/5 hover:text-midnight disabled:opacity-50"
            >
              <Paperclip className="h-4 w-4" strokeWidth={1.75} />
              {quoteFile ? quoteFile.name : "Tap to attach image or PDF"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setQuoteFile(f);
                e.target.value = "";
              }}
            />
            {quoteFile && (
              <button
                type="button"
                onClick={() => setQuoteFile(null)}
                className="mt-1 text-[11px] text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
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
              onClick={() => {
                setRequesting(false);
                setQuoteFile(null);
              }}
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
