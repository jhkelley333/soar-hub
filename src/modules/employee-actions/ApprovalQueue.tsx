// Approver queue for Employee Actions. Lists requests awaiting the signed-in
// approver (own submissions excluded server-side) and lets them approve or
// send back for changes. Training = single SDO/RVP step; PTO = DO then SDO/RVP.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { decideEmployeeAction, listApprovalQueue } from "./api";
import type { DecideInput, PtoRow, TrainingCreditRow } from "./types";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function stepLabel(type: "training" | "pto", status: string): string {
  if (type === "training") return "Awaiting SDO/RVP";
  if (status === "Submitted") return "Awaiting DO";
  return "Awaiting SDO/RVP";
}

type Pending = {
  type: "training" | "pto";
  id: string;
  action: "approve" | "reject";
  title: string;
};

export function ApprovalQueue() {
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);

  const query = useQuery({ queryKey: ["ea-queue"], queryFn: listApprovalQueue });

  const decide = useMutation({
    mutationFn: (input: DecideInput) => decideEmployeeAction(input),
    onSuccess: (res) => {
      toast.push(
        res.status === "Changes Requested" ? "Sent back for changes." : `Marked ${res.status}.`,
        "success"
      );
      qc.invalidateQueries({ queryKey: ["ea-queue"] });
      qc.invalidateQueries({ queryKey: ["ea-list"] });
      setPending(null);
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Action failed.", "error"),
  });

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load the approval queue"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </Card>
    );
  }

  const { trainingCredits, ptoRequests } = query.data;
  const total = trainingCredits.length + ptoRequests.length;

  if (!total) {
    return (
      <Card>
        <EmptyState
          title="Nothing awaiting your approval"
          description="Requests that need your sign-off will show up here."
        />
      </Card>
    );
  }

  function openDecision(p: Pending) {
    setPending(p);
  }

  return (
    <div className="space-y-6">
      {trainingCredits.length > 0 && (
        <Section title="Training Credit" count={trainingCredits.length}>
          {trainingCredits.map((r) => (
            <TrainingQueueRow key={r.id} row={r} onAct={openDecision} />
          ))}
        </Section>
      )}
      {ptoRequests.length > 0 && (
        <Section title="PTO" count={ptoRequests.length}>
          {ptoRequests.map((r) => (
            <PtoQueueRow key={r.id} row={r} onAct={openDecision} />
          ))}
        </Section>
      )}

      {pending && (
        <DecisionModal
          pending={pending}
          busy={decide.isPending}
          onCancel={() => setPending(null)}
          onConfirm={(note) =>
            decide.mutate({ type: pending.type, id: pending.id, action: pending.action, note })
          }
        />
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold tracking-tight text-midnight">
        {title} <span className="text-zinc-400">({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ActionButtons({
  onApprove,
  onReject,
}: {
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onReject}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-50"
      >
        Send back
      </button>
      <Button type="button" onClick={onApprove} className="px-3 py-1 text-xs">
        Approve
      </Button>
    </div>
  );
}

function TrainingQueueRow({
  row,
  onAct,
}: {
  row: TrainingCreditRow;
  onAct: (p: Pending) => void;
}) {
  const title = `${row.employee_name} — ${row.training_type}`;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            <Badge tone="neutral">{stepLabel("training", row.status)}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>
              Store #{row.store_number}
              {row.store_name ? ` — ${row.store_name}` : ""}
            </span>
            <span>{row.training_type}</span>
            <span>{fmtMoney(row.requested_amount)}</span>
          </div>
        </div>
        <ActionButtons
          onApprove={() => onAct({ type: "training", id: row.id, action: "approve", title })}
          onReject={() => onAct({ type: "training", id: row.id, action: "reject", title })}
        />
      </CardBody>
    </Card>
  );
}

function PtoQueueRow({ row, onAct }: { row: PtoRow; onAct: (p: Pending) => void }) {
  const isHourly = row.position === "Associate Manager" || row.position === "First Assistant";
  const title = `${row.employee_name} (${row.position})`;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            <span className="text-xs text-zinc-400">{row.position}</span>
            <Badge tone="neutral">{stepLabel("pto", row.status)}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>
              Store #{row.store_number}
              {row.store_name ? ` — ${row.store_name}` : ""}
            </span>
            <span>
              {row.pto_start_date} → {row.pto_end_date}
            </span>
            {isHourly ? (
              <span>
                {row.vacation_hours ?? 0} hrs
                {row.amount != null ? ` · ${fmtMoney(row.amount)}` : ""}
              </span>
            ) : (
              <span>{row.days_used ?? 0} day(s)</span>
            )}
          </div>
        </div>
        <ActionButtons
          onApprove={() => onAct({ type: "pto", id: row.id, action: "approve", title })}
          onReject={() => onAct({ type: "pto", id: row.id, action: "reject", title })}
        />
      </CardBody>
    </Card>
  );
}

function DecisionModal({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const isReject = pending.action === "reject";
  const canConfirm = !isReject || note.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md">
        <CardBody>
          <h3 className="text-sm font-semibold text-midnight">
            {isReject ? "Send back for changes" : "Approve request"}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">{pending.title}</p>
          <label className="mt-3 block text-xs font-medium text-zinc-600">
            {isReject ? "Reason (required)" : "Note (optional)"}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={isReject ? "What needs to change?" : "Add context for the record…"}
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <Button
              type="button"
              onClick={() => onConfirm(note.trim())}
              disabled={busy || !canConfirm}
            >
              {busy ? "Saving…" : isReject ? "Send back" : "Approve"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
