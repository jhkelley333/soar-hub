// Admin-only soft-delete for a PAF. Renders a Delete button that opens a modal
// requiring a reason. On confirm the PAF is archived (hidden from every queue)
// and the deletion is recorded in the audit log as "Deleted by System Admin".
// Gated to admins at the call site, but also defends server-side.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { deletePaf } from "./api";
import type { PafRow } from "./types";

export function DeletePafAction({
  paf,
  onComplete,
}: {
  paf: PafRow;
  onComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const toast = useToast();

  const del = useMutation({
    mutationFn: () => deletePaf(paf.id, reason.trim()),
    onSuccess: () => {
      toast.push("PAF deleted.", "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      qc.invalidateQueries({ queryKey: ["paf-sdo-queue"] });
      close();
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  function close() {
    setOpen(false);
    setReason("");
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        Delete
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Delete PAF — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => del.mutate()}
              disabled={del.isPending || !reason.trim()}
            >
              {del.isPending ? "Deleting…" : "Delete PAF"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            This removes the PAF from every queue. The record is kept and the
            deletion is logged in the PAF's history with your name and reason.
          </p>
          <div>
            <Label htmlFor="del-reason">Reason *</Label>
            <textarea
              id="del-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Why is this PAF being deleted? (e.g. duplicate, filed in error)"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
