// Sticky approval action bar from the WO Approval design: Reject /
// Request info / Approve·$amount. Shown only when the viewer can decide
// the pending approval (DO+ with a Pending row). Wires to the real
// decideApproval endpoint.
//
// "Request info" posts the question to the ticket's internal thread AND
// fires an outbound Resend alert to the submitter (requestInfo action).
// No inbound parsing — the reply comes back on the thread. Reject opens
// the same sheet for a required reason.

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, MessageSquarePlus, Loader2, Send, PhoneCall, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { BottomBar } from "@/shared/ui/BottomBar";
import { Drawer } from "@/shared/ui/Drawer";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { decideApproval, requestInfo, fetchApprovalThresholds } from "../api";
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

  // "Ask the requester" sheet fields.
  const [subject, setSubject] = useState("");
  const [ccList, setCcList] = useState<string[]>([]);
  const [bccList, setBccList] = useState<string[]>([]);
  const [openThread, setOpenThread] = useState(true);
  const [pauseClock, setPauseClock] = useState(true);
  const [notifySdo, setNotifySdo] = useState(false);

  const defaultSubject = `Info needed on ${ticket.wo_number || "this WO"}${ticket.work_requested ? ` — ${ticket.work_requested}` : ""}`;

  function openInfo() {
    setText("");
    setSubject(defaultSubject);
    setCcList(profile?.email ? [profile.email] : []);
    setBccList([]);
    setOpenThread(true);
    setPauseClock(true);
    setNotifySdo(false);
    setSheet("info");
  }

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
      requestInfo({
        ticketId: ticket.id,
        question: text.trim(),
        subject: subject.trim() || undefined,
        cc: ccList,
        bcc: bccList,
        openThread,
        pauseClock,
        notifySdo,
      }),
    onSuccess: (res) => {
      toast.push(
        res.emailed
          ? `Sent to ${res.recipients.to[0] ?? "the requester"}${pauseClock ? " · moved to Needs info" : ""}.`
          : "Posted to the work order thread.",
        "success",
      );
      setSheet(null);
      setText("");
      onChanged();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't send.", "error"),
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
            onClick={openInfo}
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
        {sheet === "reject" ? (
          <>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-midnight-500">
              Reason for rejection
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              autoFocus
              placeholder="Why is this being rejected? The requester will see this."
              className="mt-1.5 block w-full rounded-lg border border-midnight-200 bg-white px-3 py-2 text-sm text-midnight-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-midnight-500">
              Sends an email + posts to the work order.
              {pauseClock ? " Moves the WO to " : " "}
              {pauseClock && <span className="font-semibold text-amber-700">Needs info</span>}
              {pauseClock ? "." : ""}
            </p>

            {/* Recipients */}
            <div className="rounded-lg ring-1 ring-midnight-100 divide-y divide-midnight-100">
              <RecipientRow label="To">
                <Chip>{ticket.submitted_by || "Requester"} · Requester</Chip>
              </RecipientRow>
              <RecipientRow label="Cc">
                <EmailChips
                  emails={ccList}
                  onChange={setCcList}
                  placeholder="Add email…"
                />
              </RecipientRow>
              <RecipientRow label="Bcc">
                <EmailChips
                  emails={bccList}
                  onChange={setBccList}
                  placeholder="Add emails (vendor, maintenance…)"
                />
              </RecipientRow>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-midnight-500">
                Subject
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-midnight-200 bg-white px-3 py-2 text-sm text-midnight-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-midnight-500">
                  Your question
                </label>
                <span className="text-[10px] text-midnight-400">{text.length}/2000</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                rows={5}
                placeholder="What do you need clarified before approving?"
                className="mt-1.5 block w-full rounded-lg border border-midnight-200 bg-white px-3 py-2 text-sm text-midnight-900 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Options */}
            <div className="rounded-lg ring-1 ring-midnight-100 divide-y divide-midnight-100">
              <OptionRow
                checked={openThread}
                onToggle={() => setOpenThread((v) => !v)}
                title="Open a chat thread"
                hint="Keeps the back-and-forth tied to this WO."
              />
              <OptionRow
                checked={pauseClock}
                onToggle={() => setPauseClock((v) => !v)}
                title="Pause approval clock until they reply"
                hint="Marks the WO Needs info so it isn't flagged as stuck."
              />
              <OptionRow
                checked={notifySdo}
                onToggle={() => setNotifySdo((v) => !v)}
                title="Also notify the SDO"
                hint="Use if this might escalate above your authority."
              />
            </div>

            <p className="text-[11px] text-midnight-400">
              Sent from your SOAR address with reply-to set to this WO — replies
              post back into the thread automatically once inbound is live.
            </p>
          </div>
        )}
      </Drawer>
    </>
  );
}

function RecipientRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="w-7 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-midnight-400">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// A multi-email entry: existing emails render as removable chips; typing
// + Enter / comma / space (or blur) commits a new one. Module-level so it
// keeps a stable identity and never remounts mid-typing.
function EmailChips({
  emails,
  onChange,
  placeholder,
}: {
  emails: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...emails];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {emails.map((e) => (
        <span
          key={e}
          className="inline-flex items-center gap-1 rounded-full bg-frost-100 px-2 py-0.5 text-[12px] font-medium text-midnight-800 ring-1 ring-midnight-100"
        >
          {e}
          <button
            type="button"
            onClick={() => onChange(emails.filter((x) => x !== e))}
            className="text-midnight-400 hover:text-midnight-700"
            aria-label={`Remove ${e}`}
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === "," || ev.key === " ") {
            ev.preventDefault();
            commit(draft);
          } else if (ev.key === "Backspace" && !draft && emails.length) {
            onChange(emails.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={emails.length ? "" : placeholder}
        inputMode="email"
        className="min-w-[8ch] flex-1 bg-transparent text-[13px] text-midnight-900 placeholder:text-midnight-400 focus:outline-none"
      />
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-frost-100 px-2 py-0.5 text-[12px] font-medium text-midnight-800 ring-1 ring-midnight-100">
      {children}
    </span>
  );
}

function OptionRow({
  checked,
  onToggle,
  title,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors",
          checked ? "justify-end bg-accent" : "justify-start bg-midnight-200",
        )}
      >
        <span className="h-4 w-4 rounded-full bg-white" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-midnight-900">{title}</span>
        <span className="block text-[11.5px] text-midnight-400">{hint}</span>
      </span>
    </button>
  );
}
