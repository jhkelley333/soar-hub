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
  createWorkOrder,
  listWorkOrders,
  updateWorkOrder,
  uploadAttachment,
} from "../api";

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  Open: "info",
  "In Progress": "warning",
  "Awaiting Approval": "warning",
  Completed: "success",
  Closed: "neutral",
  Cancelled: "danger",
};

function statusTone(status: unknown): "neutral" | "info" | "warning" | "success" | "danger" {
  return STATUS_TONE[String(status ?? "")] ?? "neutral";
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

export function ListTab() {
  const query = useQuery({
    queryKey: ["work-orders"],
    queryFn: listWorkOrders,
  });

  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

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
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          {rows.length} {rows.length === 1 ? "ticket" : "tickets"} in your scope
          {data.user.canSeeAllStores
            ? " (all stores)"
            : data.user.storeNumbers.length > 0
              ? ` across ${data.user.storeNumbers.length} ${data.user.storeNumbers.length === 1 ? "store" : "stores"}`
              : ""}
        </div>
        <Button onClick={() => setCreating(true)}>New work order</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No work orders yet"
          description="When tickets are submitted from your stores they'll appear here."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Store</th>
                <th className="px-5 py-3 font-medium">Issue</th>
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
                  <td className="px-5 py-3">
                    <Badge tone={statusTone(row["Status"])}>{display(row["Status"])}</Badge>
                  </td>
                  <td className="px-5 py-3 text-zinc-600">{display(row["Vendor"])}</td>
                  <td className="px-5 py-3 text-zinc-500 tabular-nums">
                    {row.modifiedAt ? new Date(row.modifiedAt).toLocaleDateString() : "—"}
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
        </Card>
      )}

      {opened && (
        <DetailDrawer
          row={opened}
          onClose={() => setOpenId(null)}
        />
      )}

      {creating && (
        <CreateDrawer
          onClose={() => setCreating(false)}
          allowedStores={data.user.canSeeAllStores ? null : data.user.storeNumbers}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail / edit / upload drawer
// ---------------------------------------------------------------------------

function DetailDrawer({ row, onClose }: { row: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(String(row["Status"] ?? ""));
  const [vendor, setVendor] = useState(String(row["Vendor"] ?? ""));
  const [notes, setNotes] = useState(String(row["Notes"] ?? ""));
  const fileRef = useRef<HTMLInputElement>(null);

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => updateWorkOrder(row.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(row.id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-orders"] }),
  });

  const editableFields = useMemo(
    () => [
      ["Status", status, setStatus],
      ["Vendor", vendor, setVendor],
      ["Notes", notes, setNotes],
    ] as const,
    [status, vendor, notes]
  );

  function save() {
    update.mutate({ Status: status, Vendor: vendor, Notes: notes });
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
        <Field label="Submitted by" value={display(row["Submitted By"])} />
        <Field label="Issue" value={display(row["Issue"])} className="col-span-2" />
      </div>

      <div className="mt-6 space-y-4">
        {editableFields.map(([label, value, setValue]) => (
          <div key={label}>
            <Label htmlFor={`f-${label}`}>{label}</Label>
            <Input
              id={`f-${label}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        ))}
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
// Create drawer
// ---------------------------------------------------------------------------

function CreateDrawer({
  onClose,
  allowedStores,
}: {
  onClose: () => void;
  allowedStores: string[] | null;
}) {
  const qc = useQueryClient();
  const [storeNumber, setStoreNumber] = useState(allowedStores?.[0] ?? "");
  const [issue, setIssue] = useState("");
  const [vendor, setVendor] = useState("");
  const [priority, setPriority] = useState("Normal");

  const create = useMutation({
    mutationFn: () =>
      createWorkOrder({
        "Store Number": storeNumber,
        Issue: issue,
        Vendor: vendor,
        Priority: priority,
        Status: "Open",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      onClose();
    },
  });

  return (
    <Drawer onClose={onClose} title="New work order">
      <div className="space-y-4">
        <div>
          <Label htmlFor="c-store">Store number</Label>
          {allowedStores ? (
            <select
              id="c-store"
              value={storeNumber}
              onChange={(e) => setStoreNumber(e.target.value)}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
            >
              {allowedStores.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="c-store"
              value={storeNumber}
              onChange={(e) => setStoreNumber(e.target.value)}
              placeholder="e.g. 4421"
            />
          )}
        </div>
        <div>
          <Label htmlFor="c-issue">Issue</Label>
          <Input
            id="c-issue"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="What's broken?"
          />
        </div>
        <div>
          <Label htmlFor="c-vendor">Vendor</Label>
          <Input
            id="c-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label htmlFor="c-priority">Priority</Label>
          <select
            id="c-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
          >
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
        </div>
      </div>

      {create.isError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(create.error as Error).message}
        </div>
      )}

      <div className="mt-8 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || !storeNumber || !issue}
        >
          {create.isPending ? "Submitting…" : "Submit work order"}
        </Button>
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
