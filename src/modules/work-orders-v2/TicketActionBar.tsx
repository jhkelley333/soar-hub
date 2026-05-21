// Contextual action buttons rendered below the StatusBar. Reads the
// current ticket state + decides which transitions are offered based
// on the locked transition matrix from the design doc.
//
// Mutations go through transitionTicket (single state-machine entry
// point on the backend). 422s bubble up as toast errors with the
// machine's reason. Successful transitions invalidate the tickets
// query so the parent re-renders.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Pause, RotateCcw, Truck, XCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { transitionTicket, uploadPhoto } from "./api";
import type { TicketStatus, TransitionPayload, UploadPhotoBody } from "./types";
import { ReasonModal, type ReasonModalConfig } from "./ReasonModal";

// Reads a File into a base64 string (sans the data: prefix) so it
// can ride along on the uploadPhoto JSON body.
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// Visible action button definition. `payload` is set directly for
// no-payload transitions (Confirm Fix, Mark On Site). `modalConfig`
// triggers a ReasonModal flow. One of the two is required.
interface ActionDef {
  key:        string;
  label:      string;
  to:         TicketStatus;
  variant?:   "primary" | "ghost" | "danger";
  icon?:      "check" | "x" | "truck" | "rotate" | "pause";
  payload?:   TransitionPayload;
  modal?:     ReasonModalConfig;
  // When true, only show when isSubmitter prop is also true (the
  // caller is the original submitter of this ticket). Used for the
  // submitter-cancel action.
  submitterOnly?: boolean;
}

// Actions per current state — encoded straight from §J of the locked
// design doc. Flat permission model: anyone scoped to the ticket can
// trigger any of these. Approval-tier checks live elsewhere.
const ACTIONS_BY_STATE: Record<TicketStatus, ActionDef[]> = {
  submitted: [
    { key: "start",
      label: "Start Working",
      to: "in_progress",
      icon: "rotate",
      variant: "primary",
      payload: {} },
    { key: "schedule",
      label: "Schedule Vendor",
      to: "scheduled",
      icon: "truck",
      modal: { kind: "vendor_schedule" } },
    // Skip-forwards for vendor-walked-in-cold cases.
    { key: "on_site_direct",
      label: "Vendor On Site",
      to: "on_site",
      icon: "check",
      variant: "ghost",
      payload: {} },
    { key: "complete_direct",
      label: "Already Completed",
      to: "completed",
      icon: "check",
      variant: "ghost",
      modal: { kind: "resolution_only", optional: true } },
    { key: "false_alarm",
      label: "Close — False Alarm",
      to: "closed",
      icon: "x",
      variant: "ghost",
      modal: { kind: "store_close" } },
    // Replace rather than repair. Reachable from every active state
    // because the call can be made at any point.
    { key: "order_replacement",
      label: "Order Replacement",
      to: "awaiting_equipment",
      icon: "truck",
      variant: "ghost",
      modal: { kind: "order_replacement" } },
    // Submitter cancellation — only the GM who created this ticket
    // sees it. Distinct from "Close — False Alarm" (which a DO can
    // also use); this is "I shouldn't have submitted this" by the
    // person who did. Goes to cancelled (terminal), not closed.
    { key: "submitter_cancel",
      label: "Cancel my ticket",
      to: "cancelled",
      icon: "x",
      variant: "ghost",
      modal: { kind: "submitter_cancellation" },
      submitterOnly: true },
  ],
  in_progress: [
    { key: "schedule",
      label: "Schedule Vendor",
      to: "scheduled",
      icon: "truck",
      modal: { kind: "vendor_schedule" } },
    { key: "on_site",
      label: "Mark On Site",
      to: "on_site",
      icon: "check",
      variant: "primary",
      payload: {} },
    { key: "complete",
      label: "Mark Complete",
      to: "completed",
      icon: "check",
      variant: "primary",
      modal: { kind: "resolution_only", optional: true } },
    { key: "order_replacement",
      label: "Order Replacement",
      to: "awaiting_equipment",
      icon: "truck",
      variant: "ghost",
      modal: { kind: "order_replacement" } },
    { key: "false_alarm",
      label: "Close — False Alarm",
      to: "closed",
      icon: "x",
      variant: "ghost",
      modal: { kind: "store_close" } },
    { key: "admin_close",
      label: "Close (admin)",
      to: "closed",
      icon: "x",
      variant: "ghost",
      modal: { kind: "admin_close", requireResolutionCategory: true } },
  ],
  scheduled: [
    { key: "on_site",
      label: "Mark On Site",
      to: "on_site",
      icon: "check",
      variant: "primary",
      payload: {} },
    { key: "complete_direct",
      label: "Already Completed",
      to: "completed",
      icon: "check",
      variant: "ghost",
      modal: { kind: "resolution_only", optional: true } },
    { key: "order_replacement",
      label: "Order Replacement",
      to: "awaiting_equipment",
      icon: "truck",
      variant: "ghost",
      modal: { kind: "order_replacement" } },
    { key: "back_to_progress",
      label: "Pause — Back to In Progress",
      to: "in_progress",
      icon: "pause",
      variant: "ghost",
      payload: {} },
  ],
  on_site: [
    { key: "complete",
      label: "Mark Complete",
      to: "completed",
      icon: "check",
      variant: "primary",
      modal: { kind: "resolution_only", optional: true } },
    { key: "order_replacement",
      label: "Order Replacement",
      to: "awaiting_equipment",
      icon: "truck",
      variant: "ghost",
      modal: { kind: "order_replacement" } },
    { key: "step_away",
      label: "Step Away — Back to In Progress",
      to: "in_progress",
      icon: "pause",
      variant: "ghost",
      payload: {} },
  ],
  // The team is waiting on ordered replacement equipment to arrive.
  // Three exits: equipment arrived → in_progress (scheduling install),
  // equipment installed → completed, or cancel the whole branch.
  awaiting_equipment: [
    { key: "mark_installed",
      label: "Mark Installed",
      to: "completed",
      icon: "check",
      variant: "primary",
      modal: { kind: "resolution_only", optional: true } },
    { key: "equipment_arrived",
      label: "Equipment Arrived — Resume",
      to: "in_progress",
      icon: "rotate",
      variant: "ghost",
      payload: {} },
    { key: "cancel_replacement",
      label: "Cancel — Won't Replace",
      to: "cancelled",
      icon: "x",
      variant: "ghost",
      modal: { kind: "cancellation" } },
  ],
  completed: [
    { key: "confirm",
      label: "Confirm Fix",
      to: "closed",
      icon: "check",
      variant: "primary",
      payload: {} },
    { key: "reopen_not_fixed",
      label: "Reopen — Not Fixed",
      to: "in_progress",
      icon: "rotate",
      variant: "danger",
      modal: { kind: "reopen" } },
  ],
  closed: [
    { key: "reopen",
      label: "Reopen",
      to: "in_progress",
      icon: "rotate",
      variant: "ghost",
      modal: { kind: "reopen" } },
  ],
  cancelled: [],
};

function iconFor(name: ActionDef["icon"]) {
  switch (name) {
    case "check":  return <CheckCircle2 className="mr-1 h-3.5 w-3.5" strokeWidth={2} />;
    case "x":      return <XCircle      className="mr-1 h-3.5 w-3.5" strokeWidth={2} />;
    case "truck":  return <Truck        className="mr-1 h-3.5 w-3.5" strokeWidth={2} />;
    case "rotate": return <RotateCcw    className="mr-1 h-3.5 w-3.5" strokeWidth={2} />;
    case "pause":  return <Pause        className="mr-1 h-3.5 w-3.5" strokeWidth={2} />;
    default:       return null;
  }
}

interface Props {
  ticketId:   string;
  status:     TicketStatus;
  closedAt?:  string | null;
  // Store number for the ticket — passed through to ReasonModal so
  // the Schedule Vendor flow can render a store-scoped vendor
  // typeahead instead of a free-text input.
  storeNumber?: string;
  // Adds the admin-close affordance for higher-tier callers. Backend
  // accepts admin_close from any tier (flat permissions) — this is
  // purely a UI hint so store users aren't shown the deeper modal
  // when the false-alarm version is what they want.
  showAdminCloseFromInProgress?: boolean;
  // True if the caller is the original submitter of this ticket.
  // Unlocks submitter-only actions (currently: "Cancel my ticket"
  // for submitted state).
  isSubmitter?: boolean;
}

// Closed → in_progress is allowed only within the 30-day reopen grace
// window. After that we hide the Reopen button (Phase 3.2 will add
// "Create Related Ticket" in its place).
const REOPEN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export function TicketActionBar({
  ticketId, status, closedAt,
  storeNumber,
  showAdminCloseFromInProgress = true,
  isSubmitter = false,
}: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const [modalAction, setModalAction] = useState<ActionDef | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const actionsRaw = (ACTIONS_BY_STATE[status] || [])
    .filter((a) => !a.submitterOnly || isSubmitter);

  // Filter rules:
  //   - Closed: hide Reopen if past the grace window.
  //   - In Progress: optionally hide admin_close for store-tier callers.
  const actions = actionsRaw.filter((a) => {
    if (status === "closed" && a.key === "reopen") {
      if (!closedAt) return true;
      const ms = new Date(closedAt).getTime();
      if (!Number.isFinite(ms)) return true;
      return Date.now() - ms <= REOPEN_GRACE_MS;
    }
    if (status === "in_progress" && a.key === "admin_close" && !showAdminCloseFromInProgress) {
      return false;
    }
    return true;
  });

  const mut = useMutation({
    mutationFn: async ({ to, payload }: { to: TicketStatus; payload: TransitionPayload }) => {
      return transitionTicket({ id: ticketId, to, payload });
    },
    onSuccess: (_data, { to }) => {
      toast.push(`Moved to ${to.replace("_", " ")}.`, "success");
      qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
      qc.invalidateQueries({ queryKey: ["wo2", "ticket-activities", ticketId] });
      setModalAction(null);
      setModalError(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Transition failed.";
      if (modalAction) setModalError(msg);
      else toast.push(msg, "error");
    },
  });

  function trigger(action: ActionDef) {
    if (action.modal) {
      setModalAction(action);
      setModalError(null);
      return;
    }
    mut.mutate({ to: action.to, payload: action.payload || {} });
  }

  if (actions.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.key}
            variant={a.variant === "danger" ? "ghost" : (a.variant || "ghost")}
            onClick={() => trigger(a)}
            disabled={mut.isPending}
            className={a.variant === "danger" ? "text-red-700 hover:bg-red-50" : undefined}
          >
            {mut.isPending && mut.variables?.to === a.to
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              : iconFor(a.icon)}
            {a.label}
          </Button>
        ))}
      </div>

      {modalAction && (
        <ReasonModal
          open={true}
          config={modalAction.modal!}
          storeNumber={storeNumber}
          submitting={mut.isPending}
          error={modalError}
          onClose={() => {
            if (mut.isPending) return;
            setModalAction(null);
            setModalError(null);
          }}
          onSubmit={async (payload, attachment) => {
            try {
              await mut.mutateAsync({ to: modalAction.to, payload });
              // Transition succeeded — now best-effort upload any
              // attachment (currently only Order Replacement attaches
              // a receipt). A failed upload doesn't roll back the
              // transition: the ticket has already moved, we just
              // surface a non-blocking warning and the user can
              // re-attach via Update Ticket.
              if (attachment) {
                try {
                  const base64 = await fileToBase64(attachment.file);
                  const body: UploadPhotoBody = {
                    id: ticketId,
                    photoData: base64,
                    photoType: attachment.file.type || "application/octet-stream",
                    photoName: attachment.file.name,
                    uploadType: attachment.uploadType as UploadPhotoBody["uploadType"],
                  };
                  await uploadPhoto(body);
                  qc.invalidateQueries({ queryKey: ["wo2", "tickets"] });
                } catch (upErr) {
                  toast.push(
                    "Ticket updated, but receipt upload failed. Re-attach from the ticket.",
                    "error",
                  );
                  console.error("receipt upload failed:", upErr);
                }
              }
            } catch {
              /* error surfaced via mut.onError → modalError */
            }
          }}
        />
      )}
    </>
  );
}
