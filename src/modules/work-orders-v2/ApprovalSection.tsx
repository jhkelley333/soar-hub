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
import { CheckCircle2, FileText, Loader2, MessageSquarePlus, Paperclip, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { decideApproval, fileToBase64, requestInfo, submitApproval, uploadPhoto } from "./api";
import { tierForAmount } from "./approval";
import {
  APPROVAL_TIERS,
  type ApprovalTier,
  type Ticket,
  type TicketApproval,
} from "./types";

const tierLabelOf = (v: ApprovalTier) =>
  APPROVAL_TIERS.find((t) => t.value === v)?.label ?? v;

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
  // Newest approval by requested_at, not array position — PostgREST embed
  // order isn't guaranteed and an UPDATE (rejection) can reshuffle it,
  // which left the panel stuck on a stale "Rejected" after a resubmit.
  const latest =
    approvals.length > 0
      ? [...approvals].sort(
          (a, b) =>
            new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime(),
        )[approvals.length - 1]
      : null;

  // Justification follows the recommended quote so it tracks whichever
  // quote is committed, falling back to the approval row's notes.
  const recommendedQuote =
    (ticket.ticket_quotes ?? []).find((qz) => qz.is_recommended) ??
    (ticket.ticket_quotes ?? [])[0] ??
    null;
  const justification = recommendedQuote?.note || latest?.notes || null;

  const [requesting, setRequesting] = useState(false);
  // Amount drives the approver, mirroring the vendor side — no manual tier
  // picker. Dollars as typed; the tier is derived via tierForAmount.
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const derivedTier = tierForAmount(Number(amount));

  // Above the top approval tier ($1,750), an approval must be recorded as a
  // WhatsApp / Owner sign-off. The backend enforces this (verbal=true); here
  // we surface the required checkbox so the approver can confirm it.
  const WHATSAPP_THRESHOLD_CENTS = 175000;
  const approvalAmountCents =
    recommendedQuote?.amount_cents ?? Math.round((Number(ticket.cost_estimate) || 0) * 100);
  const needsWhatsapp = approvalAmountCents > WHATSAPP_THRESHOLD_CENTS;
  const [approvingWhatsapp, setApprovingWhatsapp] = useState(false);
  const [whatsappChecked, setWhatsappChecked] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");

  // Open the request form, prefilling the amount from the recommended quote
  // when there is one so the approver is pre-routed.
  function openRequest() {
    if (recommendedQuote?.amount_cents) {
      setAmount((recommendedQuote.amount_cents / 100).toFixed(2));
    }
    setRequesting(true);
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!derivedTier) {
        throw new Error("Enter a positive dollar amount.");
      }
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
        approvalTier: derivedTier,
        approvalNotes: notes.trim(),
        quoteUrl: finalUrl,
      });
    },
    onSuccess: () => {
      setRequesting(false);
      setAmount("");
      setNotes("");
      setQuoteFile(null);
      onChanged();
    },
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Submit failed."),
  });

  const decide = useMutation({
    mutationFn: (vars: { decision: "Approved" | "Rejected"; notes: string; verbal?: boolean }) => {
      if (!latest) return Promise.reject(new Error("No pending approval."));
      if (vars.decision === "Rejected" && !vars.notes.trim()) {
        return Promise.reject(new Error("A reason is required to reject."));
      }
      return decideApproval({
        id: ticket.id,
        approvalId: latest.id,
        decision: vars.decision,
        notes: vars.notes.trim() || undefined,
        verbal: vars.verbal,
      });
    },
    onSuccess: () => {
      setApprovingWhatsapp(false);
      setWhatsappChecked(false);
      setApproveNotes("");
      onChanged();
    },
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Decision failed."),
  });

  const { profile } = useAuth();
  const [askingInfo, setAskingInfo] = useState(false);
  const [infoText, setInfoText] = useState("");
  const [infoNotifySdo, setInfoNotifySdo] = useState(false);
  const askInfo = useMutation({
    mutationFn: () =>
      requestInfo({
        ticketId: ticket.id,
        question: infoText.trim(),
        cc: profile?.email ? [profile.email] : [],
        notifySdo: infoNotifySdo,
        openThread: true,
        pauseClock: true,
      }),
    onSuccess: () => {
      setAskingInfo(false);
      setInfoText("");
      setInfoNotifySdo(false);
      onChanged();
    },
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Couldn't send."),
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
          onClick={openRequest}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100"
        >
          <FileText className="h-4 w-4" strokeWidth={1.75} />
          Request Approval
        </button>
      )}

      {latest && (
        <div className="rounded-md border border-zinc-100 bg-white p-3">
          {ticket.work_requested && (
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Request
              </div>
              <div className="text-sm font-semibold text-midnight">
                {ticket.work_requested}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(latest.status)}>{latest.status}</Badge>
            {ticket.awaiting_info && <Badge tone="warning">Needs info</Badge>}
            <span className="text-xs text-zinc-500">{latest.approval_tier}</span>
            {latest.approved_by && (
              <span className="text-xs text-zinc-500">
                by <span className="font-medium text-zinc-700">{latest.approved_by}</span>
              </span>
            )}
            {latest.approved_via_whatsapp && (
              <Badge tone="success">WhatsApp ✓</Badge>
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
          {justification && (
            <div className="mt-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Justification
              </div>
              <div className="whitespace-pre-wrap text-xs text-zinc-700">
                {justification}
              </div>
            </div>
          )}
          {latest.status === "Pending" && isApprover(callerRole) && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => (needsWhatsapp ? setApprovingWhatsapp((v) => !v) : handleDecide("Approved"))}
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
              <Button
                variant="ghost"
                onClick={() => setAskingInfo((v) => !v)}
                disabled={decide.isPending}
              >
                <MessageSquarePlus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Request info
              </Button>
              {decide.isPending && (
                <Loader2 className="my-auto h-3.5 w-3.5 animate-spin text-zinc-400" />
              )}
            </div>
          )}

          {/* Over $1,750 → record the WhatsApp / Owner approval explicitly. */}
          {latest.status === "Pending" && isApprover(callerRole) && needsWhatsapp && approvingWhatsapp && (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
              <div className="text-[11px] font-semibold text-emerald-900">
                ${(approvalAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} is over $1,750 — record the out-of-system approval.
              </div>
              <textarea
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder="Approval notes (optional)…"
                className="mt-1.5 block w-full rounded-md border border-emerald-200 bg-white px-2.5 py-2 text-sm"
              />
              <label className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-emerald-900">
                <input
                  type="checkbox"
                  checked={whatsappChecked}
                  onChange={(e) => setWhatsappChecked(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-600"
                />
                Approved in WhatsApp (Owner / above top tier)
              </label>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => decide.mutate({ decision: "Approved", notes: approveNotes, verbal: true })}
                  disabled={decide.isPending || !whatsappChecked}
                >
                  {decide.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Confirm approval
                </Button>
                <Button variant="ghost" onClick={() => setApprovingWhatsapp(false)} disabled={decide.isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {latest.status === "Pending" && isApprover(callerRole) && askingInfo && (
            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
              <Label htmlFor="info-q">Ask the requester</Label>
              <textarea
                id="info-q"
                value={infoText}
                onChange={(e) => setInfoText(e.target.value.slice(0, 2000))}
                rows={3}
                placeholder="What do you need clarified before approving? Emails the requester; reply syncs back here."
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm"
              />
              <label className="mt-1.5 flex items-center gap-2 text-[12px] text-zinc-600">
                <input
                  type="checkbox"
                  checked={infoNotifySdo}
                  onChange={(e) => setInfoNotifySdo(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Also notify the SDO
              </label>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    if (!infoText.trim()) { onError("Enter a question."); return; }
                    askInfo.mutate();
                  }}
                  disabled={askInfo.isPending}
                >
                  {askInfo.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Send · moves to Needs info
                </Button>
                <Button variant="ghost" onClick={() => setAskingInfo(false)} disabled={askInfo.isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {/* Allow another approval round on an already-decided ticket. */}
          {latest.status !== "Pending" && (
            <div className="mt-2">
              <button
                type="button"
                onClick={openRequest}
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
            <Label htmlFor={`appr-amount-${ticket.id}`}>Approval Amount *</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-zinc-500">$</span>
              <input
                id={`appr-amount-${ticket.id}`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {derivedTier ? (
                <>Routes to: <strong className="text-zinc-700">{tierLabelOf(derivedTier)}</strong></>
              ) : (
                "Enter the amount to route this to the right approver."
              )}
            </div>
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
              disabled={submit.isPending || !derivedTier}
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
