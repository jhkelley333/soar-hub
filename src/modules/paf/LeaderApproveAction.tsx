// In-app Approve button for a "Needs Approval" PAF — for region+ leadership
// (RVP/VP/COO/Admin). The "Needs Approval" status is Payroll's external-token
// flow; when the emailed link goes to the wrong inbox the PAF is stuck with no
// in-app way to move it. This unblocks it: one confirm → Approved → Payroll.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { leaderApprovePaf } from "./api";
import type { PafRow } from "./types";

export function LeaderApproveAction({
  paf,
  onComplete,
}: {
  paf: PafRow;
  /** Called after a successful approve (e.g. to close a parent drawer). */
  onComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const approve = useMutation({
    mutationFn: () => leaderApprovePaf(paf.id),
    onSuccess: () => {
      toast.push("PAF approved — moved to the Payroll queue.", "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      setOpen(false);
      onComplete?.();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Approve failed.", "error"),
  });

  if (paf.status !== "Needs Approval") return null;

  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        Approve
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Approve PAF — ${paf.employee_name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
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
        <p className="text-sm text-zinc-700">
          This PAF was sent for external approval. Approving it here signs off in
          your name and moves it into the Payroll queue — no email link needed.
        </p>
      </Modal>
    </>
  );
}
