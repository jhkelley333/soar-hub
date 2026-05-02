import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import {
  type WorkOrder,
  type WorkOrderMeta,
  type SessionUser,
  listWorkOrders,
  updateWorkOrder,
  uploadAttachment,
} from "../api";

// ----------------------------------------------------------------------------
// Status display
// ----------------------------------------------------------------------------

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  Received: "info",
  "Pending Approval": "warning",
  Approved: "success",
  "Rejected - See Notes": "danger",
  Scheduled: "info",
  "In Progress": "warning",
  "On Hold": "warning",
  "Part on Order": "warning",
  "New Equipment Ordered": "warning",
  Closed: "neutral",
};

function statusTone(status: unknown): "neutral" | "info" | "warning" | "success" | "danger" {
  return STATUS_TONE[String(status ?? "")] ?? "neutral";
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function truncate(value: unknown, n = 80): string {
  const s = display(value);
  if (s === "—") return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

// ----------------------------------------------------------------------------
// Approval permissions (mirrors server-side rules in work-orders.js)
// ----------------------------------------------------------------------------

function tierFromApprovalLevel(value: string | undefined | null): "rvp" | "vp" | "coo" | null {
  const v = String(value ?? "").trim();
  if (v.startsWith("Regional VP")) return "rvp";
  if (v.startsWith("VP")) return "vp";
  if (v.startsWith("COO")) return "coo";
  return null;
}

function canApproveRow(role: string, approvalLevel: string | undefined | null): boolean {
  const tier = tierFromApprovalLevel(approvalLevel);
  if (!tier) return false;
  if (role === "admin" || role === "coo") return true;
  if (role === "vp") return tier === "rvp" || tier === "vp";
  if (role === "rvp") return tier === "rvp";
  return false;
}

function canEditApprovalNotes(role: string): boolean {
  return role === "admin" || role === "rvp" || role === "vp" || role === "coo";
}

// ----------------------------------------------------------------------------
// List
// ----------------------------------------------------------------------------

export function ListTab() {
  const query = useQuery({
    queryKey: ["work-orders"],
    queryFn: listWorkOrders,
  });

  const [openId, setOpenId] = useState<number | null>(null);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load work orders"
        description={(query.error as Error)?.message ?? "Try again in a moment."}
      />
    );
  }

  const data = query.data!;
  const rows = data.workOrders;
  const opened = openId == null ? null : rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="mb-4 text-sm text-zinc-500">
        {rows.length} {rows.length === 1 ? "ticket" : "tickets"} in your scope
        {data.user.canSeeAllStores
          ? " (all stores)"
          : data.user.storeNumbers.length > 0
            ? ` across ${data.user.storeNumbers.length} ${data.user.storeNumbers.length === 1 ? "store" : "stores"}`
            : ""}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No work orders yet"
          description="When tickets are submitted from your stores they'll appear here."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Store</th>
                  <th className="px-5 py-3 font-medium">Issue</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-midnight tabular-nums">
                      {display(row["Store Number"])}
                    </td>
                    <td className="px-5 py-3 text-zinc-700">{display(row["Issue"])}</td>
                    <td
                      className="px-5 py-3 text-zinc-500"
                      title={display(row._issueDescription)}
                    >
                      {truncate(row._issueDescription, 60)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(row["Status"])}>{display(row["Status"])}</Badge>
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{display(row["Vendor"])}</td>
                    <td className="px-5 py-3 text-zinc-500 tabular-nums">
                      {formatDate(row.modifiedAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenId(row.id)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {opened && (
        <DetailDrawer
          row={opened}
          user={data.user}
          meta={data.meta}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail / edit / upload drawer
// ---------------------------------------------------------------------------

function DetailDrawer({
  row,
  user,
  meta,
  onClose,
}: {
  row: WorkOrder;
  user: SessionUser;
  meta: WorkOrderMeta;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(String(row["Status"] ?? ""));
  const [vendor, setVendor] = useState(String(row["Vendor"] ?? ""));
  const [notes, setNotes] = useState(String(row["Notes"] ?? ""));
  const [approvalNotes, setApprovalNotes] = useState(
    String(row._approvalNotes ?? "")
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => updateWorkOrder(row.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(row.id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  const approvalLevel = String(row._approvalLevel ?? "");
  const approverForThisRow = canApproveRow(user.role, approvalLevel);
  const notesEditable = canEditApprovalNotes(user.role);
  const currentStatus = String(row["Status"] ?? "");
  const alreadyDecided =
    currentStatus === "Approved" || currentStatus === "Rejected - See Notes";

  // Status options: union of statuses the user can change to plus the
  // current value (so the dropdown doesn't drop the row's existing value
  // even if the user can't transition to it).
  const statusOptions = useMemo(() => {
    const allowed = new Set<string>(meta.allowedStatusChanges);
    if (currentStatus) allowed.add(currentStatus);
    // Preserve canonical order
    return meta.statusOrder.filter((s) => allowed.has(s));
  }, [meta, currentStatus]);

  function save() {
    const payload: Record<string, unknown> = {
      Status: status,
      Vendor: vendor,
      Notes: notes,
    };
    if (notesEditable) payload["Approval Notes"] = approvalNotes;
    update.mutate(payload);
  }

  function decide(decision: "Approved" | "Rejected - See Notes") {
    if (!approvalNotes.trim()) {
      window.alert("Approval Notes are required to Approve or Reject.");
      return;
    }
    update.mutate({
      Status: decision,
      "Approval Notes": approvalNotes,
    });
    setStatus(decision);
  }

  function pickFile() {
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  }

  return (
    <Drawer onClose={onClose} title={`Work order #${row.id}`}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Store" value={display(row["Store Number"])} />
        <Field label="Submitted" value={formatDate(row._submittedDate)} />
        <Field label="Submitted by" value={display(row["Submitted By"])} />
        <Field label="Priority" value={display(row["Priority"])} />
        <Field label="Issue" value={display(row["Issue"])} className="col-span-2" />
        <ReadOnlyTextArea
          label="Issue Description"
          value={display(row._issueDescription)}
          className="col-span-2"
        />
        <Field
          label="Approval Level"
          value={display(approvalLevel)}
          className="col-span-2"
        />
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="f-status">Status</Label>
          <select
            id="f-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {statusOptions.length === 1 && (
            <p className="mt-1 text-xs text-zinc-500">
              Your role can't change this ticket's status from the current value.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="f-vendor">Vendor</Label>
          <Input
            id="f-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="f-notes">Notes</Label>
          <textarea
            id="f-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <Label htmlFor="f-approval-notes">
            Approval Notes
            {!notesEditable && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                (read-only — approvers only)
              </span>
            )}
          </Label>
          <textarea
            id="f-approval-notes"
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            readOnly={!notesEditable}
            rows={3}
            className={
              notesEditable
                ? "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
                : "block w-full rounded-md border-0 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-200 outline-none"
            }
          />
        </div>
      </div>

      {update.isError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(update.error as Error).message}
        </div>
      )}
      {upload.isError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(upload.error as Error).message}
        </div>
      )}
      {Boolean(row["Quote URL"]) && (
        <div className="mt-4 text-sm">
          <span className="text-zinc-500">Quote URL: </span>
          <a
            href={String(row["Quote URL"])}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:underline"
          >
            {String(row["Quote URL"])}
          </a>
        </div>
      )}

      {/* Approve / Reject — only for approver-of-this-tier and not yet decided */}
      {approverForThisRow && !alreadyDecided && (
        <div className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4">
          <div className="text-sm font-medium text-midnight">Approval decision</div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Tier: <span className="font-medium">{display(approvalLevel)}</span>.
            Approval Notes are required.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={() => decide("Approved")}
              disabled={update.isPending}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              onClick={() => decide("Rejected - See Notes")}
              disabled={update.isPending}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onFile}
          />
          <Button variant="secondary" onClick={pickFile} disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload photo / quote"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-midnight">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-sm font-medium text-zinc-500 transition hover:text-midnight"
          >
            Close
          </button>
        </div>
        <div className="flex-1 px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-zinc-800">{value}</div>
    </div>
  );
}

function ReadOnlyTextArea({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
        {value}
      </div>
    </div>
  );
}
