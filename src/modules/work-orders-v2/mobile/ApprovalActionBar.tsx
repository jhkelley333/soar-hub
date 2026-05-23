// Sticky approval action bar from the WO Approval design: Reject /
// Request info / Approve·$amount. Shown only when the viewer can decide
// the pending approval (DO+ with a Pending row). Wires to the real
// decideApproval endpoint.
//
// "Request info" has no email/needs_info backend yet (that's a separate
// slice), so it posts the question into the ticket's internal chat
// thread — honest about what it does. Reject opens the same sheet for a
// required reason.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, MessageSquarePlus, Loader2, Send, PhoneCall } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { BottomBar } from "@/shared/ui/BottomBar";
import { Drawer } from "@/shared/ui/Drawer";
import { Avatar } from "@/shared/ui/Avatar";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { decideApproval, sendMessage, fetchApprovalThresholds } from "../api";
import type { Ticket, TicketApproval } from "../types";
import { canApprove, isOverTopTier, requiredApprover } from "../approval";
import { formatDollars } from "./woMobile";

type Sheet = "reject" | "info";

export function ApprovalActionBar({
  ticket,
  approval,
  quoteId,
  amountCents,
  onChanged,
}: {
  ticket: Ticket;
  approval: TicketApproval;
  // The quote being committed on approve (recommended one). null when
  // the WO carries no quotes yet.
  quoteId?: string | null;
  // Amount under review (recommended quote total, else cost_estimate).
  amountCents: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [text, setText] = useState("");

  const thrQ = useQuery({
    queryKey: ["wo2", "approval-thresholds"],
    queryFn: () => fetchApprovalThresholds().then((r) => r.thresholds),
    staleTime: 5 * 60_000,
  });
  const thresholds = thrQ.data ?? [];

  // While thresholds load (or none configured), don't block — fall back
  // to allowing the action; the server re-checks the gate regardless.
  const overTop = thresholds.length > 0 && isOverTopTier(amountCents, thresholds);
  const allowed =
    thresholds.length === 0 || canApprove(profile?.role, amountCents, thresholds);
  const required = thresholds.length ? requiredApprover(amountCents, thresholds) : null;

  const decide = useMutation({
    mutationFn: (vars: { decision: "Approved" | "Rejected"; notes?: string; verbal?: boolean }) =>
      decideApproval({
        id: ticket.id,
        approvalId: approval.id,
        decision: vars.decision,
        notes: vars.notes,
        quoteId: vars.decision === "Approved" ? quoteId ?? undefined : undefined,
        verbal: vars.verbal,
      }),
    onSuccess: (_d, vars) => {
      toast.push(
        vars.decision === "Approved" ? "Approved." : "Request rejected.",
        "success",
      );
      setSheet(null);
      setText("");
      onChanged();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Decision failed.", "error"),
  });

  const askInfo = useMutation({
    mutationFn: () =>
      sendMessage({
        ticketId: ticket.id,
        message: text.trim(),
        threadType: "internal",
      }),
    onSuccess: () => {
      toast.push("Question posted to the ticket thread.", "success");
      setSheet(null);
      setText("");
      onChanged();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't post.", "error"),
  });

  const amount = formatDollars(amountCents > 0 ? amountCents / 100 : ticket.cost_estimate);
  const busy = decide.isPending || askInfo.isPending;

  function send() {
    if (!text.trim()) {
      toast.push(
        sheet === "reject" ? "A reason is required to reject." : "Enter a question.",
        "error",
      );
      return;
    }
    if (sheet === "reject") decide.mutate({ decision: "Rejected", notes: text.trim() });
    else askInfo.mutate();
  }

  return (
    <>
      <BottomBar>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="flex-none"
            onClick={() => { setSheet("reject"); setText(""); }}
            disabled={busy}
          >
            Reject
          </Button>
          <Button
            variant="secondary"
            className="flex-none"
            onClick={() => { setSheet("info"); setText(""); }}
            disabled={busy}
          >
            <MessageSquarePlus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            Request info
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => decide.mutate({ decision: "Approved", verbal: overTop })}
            disabled={busy || !allowed}
          >
            {decide.isPending && decide.variables?.decision === "Approved" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : overTop ? (
              <PhoneCall className="mr-1 h-4 w-4" strokeWidth={2} />
            ) : (
              <Check className="mr-1 h-4 w-4" strokeWidth={2.5} />
            )}
            {overTop
              ? "Record verbal approval"
              : `Approve${amount ? ` · ${amount}` : ""}`}
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-midnight-400">
          {allowed
            ? overTop
              ? "Above the top tier — record the verbal / Owner approval here."
              : "Approving records your decision and commits the recommended quote."
            : overTop
              ? `${amount ?? "This"} needs a verbal / Owner approval recorded by a higher tier.`
              : `${amount ?? "This"} is above your limit${required ? ` — needs ${required.label}` : ""}.`}
        </p>
      </BottomBar>

      <Drawer
        open={sheet !== null}
        onClose={() => { if (!busy) setSheet(null); }}
        title={sheet === "reject" ? "Reject request" : "Ask the requester"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheet(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={sheet === "reject" ? "danger" : "primary"}
              onClick={send}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : sheet === "reject" ? null : (
                <Send className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
              )}
              {sheet === "reject" ? "Reject" : "Send"}
            </Button>
          </>
        }
      >
        {sheet === "info" && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-frost-100 px-3 py-2">
            <Avatar name={ticket.submitted_by || ""} size={28} />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-midnight-400">
                To
              </div>
              <div className="text-[13px] font-medium text-midnight-900 truncate">
                {ticket.submitted_by || "Requester"}
              </div>
            </div>
          </div>
        )}
        <label className="text-[11px] font-semibold uppercase tracking-wider text-midnight-500">
          {sheet === "reject" ? "Reason for rejection" : "Your question"}
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          autoFocus
          placeholder={
            sheet === "reject"
              ? "Why is this being rejected? The requester will see this."
              : "What do you need clarified before approving?"
          }
          className="mt-1.5 block w-full rounded-lg border border-midnight-200 bg-white px-3 py-2 text-sm text-midnight-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {sheet === "info" && (
          <p className="mt-2 text-[11.5px] text-midnight-400">
            Posts to this work order's internal thread so the back-and-forth
            stays tied to the ticket.
          </p>
        )}
      </Drawer>
    </>
  );
}
