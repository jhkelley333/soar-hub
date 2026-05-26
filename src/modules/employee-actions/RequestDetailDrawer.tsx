// Shared slide-out detail drawer for Employee Action requests (training + PTO).
// Shows the full record and is the action hub: approve / send back, the
// post-approval confirmations (entered / closed out / PAF submitted),
// edit & resubmit, and admin delete — whichever apply to the caller.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { StatusPill, type StatusPillKind } from "@/shared/ui/StatusPill";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { confirmEmployeeAction, decideEmployeeAction, deleteEmployeeAction } from "./api";
import type { ConfirmStep, PtoRow, TrainingCreditRow } from "./types";

type Kind = "training" | "pto";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Fallback link to the DO closeout Google Form, shown in the drawer in case
// the alert email isn't handy. Keep in sync with the function default.
const CLOSEOUT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeovlvWNQiJ2UDd5rlIqTkf7UEIVeZ88VkrJgdKUAd9Vso5Xw/viewform";

function statusKind(status: string): StatusPillKind {
  if (status === "Approved" || status === "Completed" || status === "PAF Submitted") return "approved";
  if (status === "Changes Requested") return "revision";
  if (status === "DO Approved" || status === "On Weekly Sheet") return "pending";
  return "submitted";
}

// What the caller can do, mirroring the server's actionableStep + self rule.
function availableAction(
  kind: Kind,
  status: string,
  role: string,
  isOwner: boolean
): "decide" | ConfirmStep | null {
  const isApprover = role === "sdo" || role === "rvp" || role === "admin";
  const isDo = role === "do" || role === "admin";
  if (kind === "training") {
    if (status === "Submitted") return isApprover && !isOwner ? "decide" : null;
    if (status === "Approved") return isApprover ? "entered" : null;
    if (status === "On Weekly Sheet") return isDo ? "closed-out" : null;
    return null;
  }
  if (status === "Submitted") return isDo && !isOwner ? "decide" : null;
  if (status === "DO Approved") return isApprover && !isOwner ? "decide" : null;
  if (status === "Approved") return isDo ? "paf-submitted" : null;
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
  const action = row ? availableAction(kind, row.status, role, isOwner) : null;
  const canEdit = !!row && row.status === "Changes Requested" && (isOwner || isAdmin) && !!onEdit;

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
  const delMut = useMutation({
    mutationFn: (id: string) => deleteEmployeeAction(kind, id),
    onSuccess: () => done("Request deleted."),
    onError: fail,
  });

  const busy = decideMut.isPending || confirmMut.isPending || delMut.isPending;

  const confirmLabel: Record<ConfirmStep, string> = {
    entered: "Mark on weekly sheet",
    "closed-out": "Mark completed",
    "paf-submitted": "Confirm PAF submitted",
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

          {action === "closed-out" && (
            <p className="pt-3 text-xs text-zinc-500">
              Complete the closeout form, then mark it completed.{" "}
              <a
                href={CLOSEOUT_FORM_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent underline"
              >
                Open the closeout form
              </a>{" "}
              (also linked in your email).
            </p>
          )}
        </dl>
      )}
    </Drawer>
  );
}

function TrainingDetail({ row }: { row: TrainingCreditRow }) {
  return (
    <>
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
        <Field label="Days used">{row.days_used ?? 0} day(s)</Field>
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
    </>
  );
}
