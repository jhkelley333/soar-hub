// Reject / Needs Approval / Mark Processed buttons. Inline on the
// payroll queue table. Each action opens a small modal.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, MailQuestion, X } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import {
  markProcessedPaf,
  needsApprovalPaf,
  rejectPaf,
} from "./api";
import type { PafRow } from "./types";

type Mode = null | "reject" | "needs" | "process";

export function ProcessActions({
  paf,
  onComplete,
}: {
  paf: PafRow;
  /** Called after a successful action (e.g. to close a parent drawer). */
  onComplete?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const [reason, setReason] = useState("");
  const [approvalEmail, setApprovalEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [approvalLink, setApprovalLink] = useState<string | null>(null);

  const reject = useMutation({
    mutationFn: () => rejectPaf(paf.id, reason),
    onSuccess: () => {
      toast.push("PAF rejected.", "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      close();
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Reject failed.", "error"),
  });

  const needs = useMutation({
    mutationFn: () => needsApprovalPaf(paf.id, approvalEmail, notes),
    onSuccess: (res) => {
      setApprovalLink(res.approval_link);
      qc.invalidateQueries({ queryKey: ["paf-list"] });
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const process = useMutation({
    mutationFn: () => markProcessedPaf(paf.id),
    onSuccess: () => {
      toast.push("PAF marked processed.", "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      close();
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  function close() {
    setMode(null);
    setReason("");
    setApprovalEmail("");
    setNotes("");
    setApprovalLink(null);
  }

  const terminal = paf.status === "Processed" || paf.status === "Rejected";

  return (
    <>
      {!terminal && (
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setMode("reject")}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.25} />
            Reject
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMode("needs")}
            className="ring-amber-300 text-amber-800 hover:bg-amber-50"
          >
            <MailQuestion className="h-3.5 w-3.5" strokeWidth={2} />
            Needs approval
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setMode("process")}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
            Mark processed
          </Button>
        </>
      )}

      {/* Reject modal */}
      <Modal
        open={mode === "reject"}
        onClose={close}
        title={`Reject PAF — ${paf.employee_name}`}
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
          <Label htmlFor="rej-reason">Rejection reason *</Label>
          <textarea
            id="rej-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Explain why…"
          />
          <p className="mt-1 text-xs text-zinc-500">
            The submitter will receive this verbatim once email delivery
            ships in PR B-2.
          </p>
        </div>
      </Modal>

      {/* Needs approval modal */}
      <Modal
        open={mode === "needs"}
        onClose={close}
        title={`Send for approval — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            {!approvalLink && (
              <Button
                onClick={() => needs.mutate()}
                disabled={needs.isPending || !approvalEmail.includes("@")}
              >
                {needs.isPending ? "Generating…" : "Generate link"}
              </Button>
            )}
          </>
        }
      >
        {approvalLink ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-700">
              Approval link generated. Email delivery isn't wired up yet —
              copy the link below and send to{" "}
              <span className="font-mono">{approvalEmail}</span>:
            </p>
            <div className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
              <code className="text-[11px] text-zinc-700">{approvalLink}</code>
            </div>
            <p className="text-xs text-zinc-500">
              Link expires in 72 hours. Single-use.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="appr-email">Approver email *</Label>
              <Input
                id="appr-email"
                type="email"
                value={approvalEmail}
                onChange={(e) => setApprovalEmail(e.target.value)}
                placeholder="approver@sonic.com"
              />
            </div>
            <div>
              <Label htmlFor="appr-notes">Notes for approver</Label>
              <textarea
                id="appr-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Context…"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Mark processed modal */}
      <Modal
        open={mode === "process"}
        onClose={close}
        title={`Mark processed — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => process.mutate()}
              disabled={process.isPending}
            >
              {process.isPending ? "Saving…" : "Confirm processed"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-700">
          Mark this PAF as fully processed by Payroll. The 90-day archive
          clock starts now (archive job ships in PR B-3).
        </p>
      </Modal>
    </>
  );
}
