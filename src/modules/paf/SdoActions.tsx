// Approve / Reject buttons for the assigned approver (SDO/RVP bonus review,
// or VP pay-adjustment review — same machinery). Inline on the
// SDO queue table. Each action opens a small modal.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { sdoApprovePaf, sdoRejectPaf } from "./api";

const kindLabel = (p: { category: string }) =>
  p.category === "Pay Adjustment (Salary)" ? "Pay adjustment" : "Bonus";
import type { PafRow } from "./types";

type Mode = null | "approve" | "reject";

export function SdoActions({
  paf,
  onComplete,
}: {
  paf: PafRow;
  /** Called after a successful action (e.g. to close a parent drawer). */
  onComplete?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const toast = useToast();

  const approve = useMutation({
    mutationFn: () => sdoApprovePaf(paf.id, note || undefined),
    onSuccess: () => {
      toast.push(`${kindLabel(paf)} approved — moved to Payroll queue.`, "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      qc.invalidateQueries({ queryKey: ["paf-sdo-queue"] });
      close();
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Approve failed.", "error"),
  });

  const reject = useMutation({
    mutationFn: () => sdoRejectPaf(paf.id, reason),
    onSuccess: () => {
      toast.push(`${kindLabel(paf)} rejected.`, "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      qc.invalidateQueries({ queryKey: ["paf-sdo-queue"] });
      close();
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Reject failed.", "error"),
  });

  function close() {
    setMode(null);
    setNote("");
    setReason("");
  }

  if (paf.status !== "Pending SDO Approval") return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setMode("reject")}
        className="text-red-700"
      >
        Reject
      </Button>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => setMode("approve")}
      >
        Approve
      </Button>

      <Modal
        open={mode === "approve"}
        onClose={close}
        title={`Approve ${kindLabel(paf).toLowerCase()} — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
            >
              {approve.isPending ? "Approving…" : "Confirm approve"}
            </Button>
          </>
        }
      >
        <div>
          <p className="text-sm text-zinc-700">
            Approving moves this PAF into the Payroll queue.
          </p>
          <div className="mt-3">
            <Label htmlFor="sdo-note">Note (optional)</Label>
            <textarea
              id="sdo-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Optional context for Payroll…"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={mode === "reject"}
        onClose={close}
        title={`Reject ${kindLabel(paf).toLowerCase()} — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => reject.mutate()}
              disabled={reject.isPending || !reason.trim()}
            >
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </>
        }
      >
        <div>
          <Label htmlFor="sdo-reason">Rejection reason *</Label>
          <textarea
            id="sdo-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Explain why…"
          />
          <p className="mt-1 text-xs text-zinc-500">
            The submitter will receive this verbatim once email delivery
            ships.
          </p>
        </div>
      </Modal>
    </>
  );
}
