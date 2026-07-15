// Shared slide-out detail drawer for Employee Action requests (training + PTO).
// Shows the full record and is the action hub: approve / send back, the
// post-approval confirmations (entered / closed out / PAF submitted),
// edit & resubmit, and admin delete — whichever apply to the caller.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { StatusPill } from "@/shared/ui/StatusPill";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { confirmEmployeeAction, decideEmployeeAction, deleteEmployeeAction, fetchCreditBalance, withdrawEmployeeAction } from "./api";
import { statusKind, waitingOn } from "./statusMeta";
import type { ConfirmStep, PtoRow, TrainingCreditRow } from "./types";

type Kind = "training" | "pto";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const ROLE_RANK: Record<string, number> = { gm: 1, do: 2, sdo: 3, rvp: 4, vp: 5, coo: 6, admin: 7 };
const rankOf = (r: string) => ROLE_RANK[r] ?? 0;

// What the caller can do — mirrors the server's actionableStep exactly. A
// senior submitter (SDO/RVP/admin) may take every step on their OWN request,
// since they outrank every approver and nothing below can finish it for them.
function availableAction(
  kind: Kind,
  status: string,
  role: string,
  isOwner: boolean,
  overBank = false
): "decide" | ConfirmStep | null {
  const isApprover = role === "sdo" || role === "rvp" || role === "admin";
  const isDo = role === "do" || role === "admin";
  const canOps = isDo || (isOwner && isApprover);
  if (kind === "training") {
    // Approval is the only step now — DO within bank, RVP over bank.
    if (status === "Submitted") return rankOf(role) >= (overBank ? ROLE_RANK.rvp : ROLE_RANK.do) ? "decide" : null;
    return null;
  }
  if (status === "Submitted") return isDo || (isOwner && isApprover) ? "decide" : null;
  if (status === "DO Approved") return isApprover ? "decide" : null;
  if (status === "SDO/RVP Approved") return canOps ? "paf-submitted" : null;
  if (status === "PAF Submitted") return canOps ? "close" : null;
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="py-1.5">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-800">{children}</dd>
    </div>
  );
}

export function RequestDetailDrawer({
  kind,
  row,
  open,
  onClose,
  onEdit,
}: {
  kind: Kind;
  row: TrainingCreditRow | PtoRow | null;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const role = profile?.role ?? "";
  const isAdmin = role === "admin";
  const isOwner = !!row && row.submitter_id === profile?.id;
  const action = row ? availableAction(kind, row.status, role, isOwner, "over_bank" in row ? !!(row as { over_bank?: boolean }).over_bank : false) : null;
  const canEdit = !!row && row.status === "Changes Requested" && (isOwner || isAdmin) && !!onEdit;

  // DO & above can correct/withdraw any in-flight (non-terminal) request.
  const isDoPlus = role === "do" || role === "sdo" || role === "rvp" || role === "admin";
  const terminal = !!row && (row.status === "Completed" || row.status === "Closed" || row.status === "Withdrawn");
  // Correct = direct edit by DO+ (training only; resets approval on save).
  // Suppressed when the owner-resubmit "Edit & Resubmit" already shows.
  const showCorrect = kind === "training" && isDoPlus && !!row && !terminal && !!onEdit && !canEdit;
  const canWithdraw = isDoPlus && !!row && !terminal;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["ea-queue"] });
    qc.invalidateQueries({ queryKey: ["ea-list"] });
  }
  function done(msg: string) {
    toast.push(msg, "success");
    invalidate();
    setNote("");
    onClose();
  }
  function fail(e: unknown) {
    toast.push(e instanceof Error ? e.message : "Action failed.", "error");
  }

  const decideMut = useMutation({
    mutationFn: decideEmployeeAction,
    onSuccess: (r) => done(r.status === "Changes Requested" ? "Sent back for changes." : `Marked ${r.status}.`),
    onError: fail,
  });
  const confirmMut = useMutation({
    mutationFn: confirmEmployeeAction,
    onSuccess: (r) => done(`Marked ${r.status}.`),
    onError: fail,
  });
  const withdrawMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      withdrawEmployeeAction(kind, id, reason),
    onSuccess: () => done("Request withdrawn."),
    onError: fail,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteEmployeeAction(kind, id),
    onSuccess: () => done("Request deleted."),
    onError: fail,
  });

  const busy = decideMut.isPending || confirmMut.isPending || delMut.isPending || withdrawMut.isPending;

  const confirmLabel: Record<ConfirmStep, string> = {
    entered: "Mark on weekly sheet",
    "closed-out": "Mark completed",
    "paf-submitted": "Confirm PAF submitted",
    close: "Mark closed",
  };

  const footer = row ? (
    <>
      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Delete this request? This can't be undone.")) delMut.mutate(row.id);
          }}
          className="mr-auto rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}
      {canEdit && (
        <Button type="button" disabled={busy} onClick={() => onEdit?.()}>
          Edit &amp; Resubmit
        </Button>
      )}
      {canWithdraw && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt(
              "Withdraw this request (e.g. employee resigned)?\nAdd an optional reason, or leave blank:"
            );
            if (reason === null) return; // cancelled
            withdrawMut.mutate({ id: row.id, reason: reason.trim() || undefined });
          }}
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
        >
          Withdraw
        </button>
      )}
      {showCorrect && (
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onEdit?.()}>
          Correct
        </Button>
      )}
      {action === "decide" && (
        <>
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => decideMut.mutate({ type: kind, id: row.id, action: "reject", note: note.trim() })}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-50 disabled:opacity-50"
          >
            Send back
          </button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => decideMut.mutate({ type: kind, id: row.id, action: "approve", note: note.trim() })}
          >
            Approve
          </Button>
        </>
      )}
      {action && action !== "decide" && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => confirmMut.mutate({ type: kind, id: row.id, step: action })}
        >
          {confirmLabel[action]}
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={row ? `${row.employee_name}` : "Request"}
      footer={footer}
    >
      {row && (
        <dl className="divide-y divide-zinc-100">
          <div className="flex items-center gap-2 pb-2">
            <StatusPill kind={statusKind(row.status)}>{row.status}</StatusPill>
            {waitingOn(kind, row.status, !!(row as { over_bank?: boolean }).over_bank) && (
              <span className="text-xs font-medium text-sonic-700">→ Waiting on {waitingOn(kind, row.status, !!(row as { over_bank?: boolean }).over_bank)}</span>
            )}
            {kind === "training" && !!(row as { over_bank?: boolean }).over_bank && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Over bank</span>
            )}
            {kind === "pto" && (row as PtoRow).position && (
              <span className="text-xs text-zinc-400">{(row as PtoRow).position}</span>
            )}
          </div>

          <Field label="Store">
            #{row.store_number}
            {row.store_name ? ` — ${row.store_name}` : ""}
          </Field>
          <Field label="Submitted by">{row.submitter_name || row.submitter_email}</Field>
          <Field label="Submitted">{new Date(row.created_at).toLocaleString()}</Field>

          {kind === "training" && <TrainingDetail row={row as TrainingCreditRow} />}
          {kind === "pto" && <PtoDetail row={row as PtoRow} />}

          {row.rejection_reason && row.status === "Changes Requested" && (
            <Field label="Changes requested">
              <span className="text-amber-700">{row.rejection_reason}</span>
            </Field>
          )}

          {row.status === "Withdrawn" && (
            <Field label="Withdrawn">
              <span className="text-zinc-600">{row.withdrawn_reason || "No reason given"}</span>
            </Field>
          )}

          {action === "decide" && (
            <div className="pt-3">
              <label className="text-[11px] uppercase tracking-wide text-zinc-400">
                Note (optional to approve, required to send back)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Add context, or say what needs to change…"
              />
            </div>
          )}

        </dl>
      )}
    </Drawer>
  );
}

function TrainingDetail({ row }: { row: TrainingCreditRow }) {
  // The store's credit bank balance — approvers see whether the store can
  // afford this request before deciding.
  const balQ = useQuery({
    queryKey: ["ea-credit-balance", row.store_number],
    queryFn: () => fetchCreditBalance(row.store_number),
    staleTime: 60_000,
  });
  const bal = balQ.data;
  return (
    <>
      {bal && (
        <Field label="Store credit bank">
          <span className={Number(bal.remaining) < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
            {fmtMoney(bal.remaining)}
          </span>{" "}
          of {fmtMoney(bal.budget)} left for {bal.year}
        </Field>
      )}
      <Field label="Training">
        {row.training_type}
        {row.training_other ? ` — ${row.training_other}` : ""}
      </Field>
      <Field label="Hourly wage">{fmtMoney(row.hourly_wage)}</Field>
      <Field label="Start date">{row.start_date ?? "—"}</Field>
      <Field label="Last training day">{row.last_day_date ?? "—"}</Field>
      <Field label="Training days">
        <ul className="mt-0.5 space-y-0.5">
          {row.training_days.map((d, i) => (
            <li key={i} className="tabular-nums">
              {d.day}: {d.start_time}–{d.end_time} ({d.hours} hrs) = {fmtMoney(d.amount)}
            </li>
          ))}
        </ul>
      </Field>
      <Field label="Requested credit">
        <span className="font-semibold">{fmtMoney(row.requested_amount)}</span>
      </Field>
      {row.approved_at && (
        <Field label="Approved">
          {new Date(row.approved_at).toLocaleString()}
          {row.approved_by_email ? ` · ${row.approved_by_email}` : ""}
          {row.decision_note ? ` — ${row.decision_note}` : ""}
        </Field>
      )}
      {row.entered_at && <Field label="On weekly sheet">{new Date(row.entered_at).toLocaleString()}</Field>}
      {row.closed_out_at && <Field label="Completed">{new Date(row.closed_out_at).toLocaleString()}</Field>}
    </>
  );
}

function PtoDetail({ row }: { row: PtoRow }) {
  const isHourly = row.position === "Associate Manager" || row.position === "First Assistant";
  return (
    <>
      {row.over_quota && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
          Over the one-week-per-quarter allowance — final approval must come from the RVP.
        </div>
      )}
      <Field label="Dates">
        {row.pto_start_date} → {row.pto_end_date}
      </Field>
      {isHourly ? (
        <>
          <Field label="Hourly wage">{fmtMoney(row.hourly_wage)}</Field>
          <Field label="Vacation days">
            <ul className="mt-0.5 space-y-0.5">
              {row.vacation_days.map((d, i) => (
                <li key={i} className="tabular-nums">
                  {d.date}: {d.hours} hrs = {fmtMoney(d.amount)}
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Hours worked this week">{row.hours_worked ?? 0} hrs</Field>
          <Field label="Total">
            <span className="font-semibold">
              {row.vacation_hours ?? 0} hrs · {fmtMoney(row.amount)}
            </span>
          </Field>
        </>
      ) : (
        <>
          <Field label="Days used">{row.days_used ?? 0} day(s)</Field>
          {(row.vacation_days?.length ?? 0) > 0 && (
            <Field label="Days out">
              <ul className="mt-0.5 space-y-0.5">
                {row.vacation_days.map((d, i) => (
                  <li key={i} className="tabular-nums">{d.date}</li>
                ))}
              </ul>
            </Field>
          )}
        </>
      )}
      {row.do_approved_at && (
        <Field label="DO approved">
          {new Date(row.do_approved_at).toLocaleString()}
          {row.do_note ? ` — ${row.do_note}` : ""}
        </Field>
      )}
      {row.approved_at && (
        <Field label="Approved">
          {new Date(row.approved_at).toLocaleString()}
          {row.approved_by_email ? ` · ${row.approved_by_email}` : ""}
          {row.decision_note ? ` — ${row.decision_note}` : ""}
        </Field>
      )}
      {row.paf_submitted_at && (
        <Field label="PAF submitted">{new Date(row.paf_submitted_at).toLocaleString()}</Field>
      )}
      {row.closed_at && (
        <Field label="Closed">{new Date(row.closed_at).toLocaleString()}</Field>
      )}
    </>
  );
}
