import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  type WorkOrder,
  type WorkOrderMeta,
  type SessionUser,
  listWorkOrders,
  updateWorkOrder,
  uploadAttachment,
} from "../api";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

// Verbatim values from the Smartsheet "Approval Level" dropdown. The label is
// what we show; the value is what we write. Match the Smartsheet column
// configuration EXACTLY or the auto-routing won't fire.
const APPROVAL_TIERS = [
  { label: "Regional VP — under $1,750", value: "Regional VP < $1750" },
  { label: "VP — $1,751 to $2,500", value: "VP $1751 -$2500" },
  { label: "COO — over $2,500", value: "COO > $2500" },
] as const;

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

// Roles that act as "Store" — limited status options + photo upload section.
const STORE_ROLES = new Set(["shift_manager", "gm"]);
const APPROVER_ROLES = new Set(["rvp", "vp", "coo", "admin"]);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function statusTone(status: unknown): "neutral" | "info" | "warning" | "success" | "danger" {
  return STATUS_TONE[String(status ?? "")] ?? "neutral";
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const d = parseDateLoose(value);
  if (!d) return String(value);
  return d.toLocaleDateString();
}

// Smartsheet sometimes returns "07/02/25 9:57 AM" style strings the native
// Date constructor doesn't parse. Try a few fallbacks before giving up.
function parseDateLoose(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i);
  if (m) {
    let yr = parseInt(m[3], 10);
    if (yr < 100) yr += 2000;
    let hr = m[4] ? parseInt(m[4], 10) : 0;
    const mn = m[5] ? parseInt(m[5], 10) : 0;
    if (m[6]) {
      const pm = m[6].toUpperCase() === "PM";
      if (pm && hr < 12) hr += 12;
      if (!pm && hr === 12) hr = 0;
    }
    d = new Date(yr, parseInt(m[1], 10) - 1, parseInt(m[2], 10), hr, mn);
    if (!Number.isNaN(d.getTime())) return d;
  }
  d = new Date(s.replace("T", " ").replace("Z", ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysOpen(row: WorkOrder): number | null {
  const raw = row._submittedDate || row.createdAt || "";
  const d = parseDateLoose(raw);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function ageBucket(days: number | null): "neutral" | "success" | "warning" | "danger" {
  if (days == null) return "neutral";
  if (days <= 7) return "success";
  if (days <= 14) return "warning";
  return "danger";
}

function isClosed(row: WorkOrder): boolean {
  return String(row["Status"] ?? "").toLowerCase() === "closed";
}

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

// ----------------------------------------------------------------------------
// List
// ----------------------------------------------------------------------------

interface Filters {
  openOnly: boolean;
  status: string; // "All" or a status value
  search: string;
  store: string; // "" = all visible stores
}

const DEFAULT_FILTERS: Filters = {
  openOnly: false,
  status: "All",
  search: "",
  store: "",
};

export function ListTab() {
  const query = useQuery({
    queryKey: ["work-orders"],
    queryFn: listWorkOrders,
  });

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // All hooks must run on every render (rules of hooks). Compute against safe
  // defaults during loading/error states; the early-return JSX won't read these.
  const allRows = query.data?.workOrders ?? [];

  const storeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      const s = String(r["Store Number"] ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [allRows]);

  const filtered = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);

  // Stats are computed on the store-scoped (pre-filter-bar) list so users see
  // the bigger picture even after narrowing.
  const stats = useMemo(() => computeStats(allRows), [allRows]);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
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

  function setStatusFilter(status: string) {
    setFilters((f) => ({ ...f, status, openOnly: status === "All" ? f.openOnly : false }));
  }

  return (
    <>
      <StatsRow stats={stats} active={filters.status} onPick={setStatusFilter} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        storeOptions={storeOptions}
        showStorePicker={!STORE_ROLES.has(data.user.role) && !data.user.canSeeAllStores}
        canSeeAllStores={data.user.canSeeAllStores}
      />

      <div className="mt-4 mb-3 text-xs uppercase tracking-wider text-zinc-500">
        {filtered.length} {filtered.length === 1 ? "ticket" : "tickets"}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No tickets match your filters"
          description="Adjust the filters above or clear them to see everything in your scope."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => (
            <TicketCard
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
              user={data.user}
              meta={data.meta}
            />
          ))}
        </div>
      )}
    </>
  );
}

function applyFilters(rows: WorkOrder[], f: Filters): WorkOrder[] {
  let list = rows;
  if (f.store) list = list.filter((r) => String(r["Store Number"] ?? "").trim() === f.store);
  if (f.openOnly) list = list.filter((r) => !isClosed(r));
  if (f.status !== "All") list = list.filter((r) => String(r["Status"] ?? "") === f.status);
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    list = list.filter((r) =>
      [
        r["Issue"],
        r._issueDescription,
        r["Store Number"],
        r["Vendor"],
        r["Notes"],
        r["Status"],
        r._approvalLevel,
        r._submittedBy,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .some((s) => s.includes(q))
    );
  }
  return list;
}

interface Stats {
  open: number;
  onHold: number;
  inProgress: number;
  partOnOrder: number;
  aged15: number;
}

function computeStats(rows: WorkOrder[]): Stats {
  let open = 0,
    onHold = 0,
    inProgress = 0,
    partOnOrder = 0,
    aged15 = 0;
  for (const r of rows) {
    const closed = isClosed(r);
    if (!closed) open++;
    const status = String(r["Status"] ?? "").toLowerCase();
    if (status === "on hold") onHold++;
    else if (status === "in progress") inProgress++;
    else if (status === "part on order") partOnOrder++;
    if (!closed) {
      const d = daysOpen(r);
      if (d != null && d >= 15) aged15++;
    }
  }
  return { open, onHold, inProgress, partOnOrder, aged15 };
}

// ----------------------------------------------------------------------------
// Stats strip
// ----------------------------------------------------------------------------

function StatsRow({
  stats,
  active,
  onPick,
}: {
  stats: Stats;
  active: string;
  onPick: (status: string) => void;
}) {
  const items: { key: string; label: string; value: number; alert?: boolean; filter: string }[] = [
    { key: "open", label: "Open", value: stats.open, filter: "All" },
    { key: "on-hold", label: "On Hold", value: stats.onHold, filter: "On Hold" },
    { key: "in-progress", label: "In Progress", value: stats.inProgress, filter: "In Progress" },
    { key: "part-on-order", label: "Part on Order", value: stats.partOnOrder, filter: "Part on Order" },
    { key: "aged", label: "15+ days", value: stats.aged15, filter: "All", alert: stats.aged15 > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {items.map((item) => {
        const isActive = active === item.filter && item.filter !== "All";
        return (
          <button
            key={item.key}
            onClick={() => onPick(item.filter)}
            className={cn(
              "flex flex-col items-start rounded-lg border bg-white px-4 py-3 text-left transition",
              isActive
                ? "border-accent ring-2 ring-accent/30"
                : "border-zinc-200 hover:border-frost",
              item.alert && "border-red-300"
            )}
          >
            <div
              className={cn(
                "text-2xl font-semibold tracking-tight tabular-nums",
                item.alert ? "text-red-600" : "text-midnight"
              )}
            >
              {item.value}
            </div>
            <div
              className={cn(
                "mt-0.5 text-[11px] font-medium uppercase tracking-wider",
                item.alert ? "text-red-600" : "text-zinc-500"
              )}
            >
              {item.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Filter bar
// ----------------------------------------------------------------------------

function FilterBar({
  filters,
  onChange,
  storeOptions,
  showStorePicker,
  canSeeAllStores,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  storeOptions: string[];
  showStorePicker: boolean;
  canSeeAllStores: boolean;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-3">
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={filters.openOnly}
          onChange={(e) => onChange({ ...filters, openOnly: e.target.checked })}
        />
        Open only
      </label>

      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className="rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="All">All statuses</option>
        <option>Received</option>
        <option>Pending Approval</option>
        <option>Approved</option>
        <option>Rejected - See Notes</option>
        <option>Scheduled</option>
        <option>In Progress</option>
        <option>On Hold</option>
        <option>Part on Order</option>
        <option>New Equipment Ordered</option>
        <option>Closed</option>
      </select>

      {(showStorePicker || canSeeAllStores) && storeOptions.length > 1 && (
        <select
          value={filters.store}
          onChange={(e) => onChange({ ...filters, store: e.target.value })}
          className="rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All stores</option>
          {storeOptions.map((s) => (
            <option key={s} value={s}>
              Store {s}
            </option>
          ))}
        </select>
      )}

      <div className="relative flex-1 min-w-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          strokeWidth={1.75}
        />
        <input
          type="search"
          placeholder="Search title, vendor, notes, store…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="block w-full rounded-md border-0 bg-white pl-9 pr-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Ticket card
// ----------------------------------------------------------------------------

function TicketCard({
  row,
  expanded,
  onToggle,
  user,
  meta,
}: {
  row: WorkOrder;
  expanded: boolean;
  onToggle: () => void;
  user: SessionUser;
  meta: WorkOrderMeta;
}) {
  const days = daysOpen(row);
  const closed = isClosed(row);
  const aged = !closed && days != null && days >= 15;

  const issueText =
    String(row["Issue"] ?? "").trim() ||
    String(row["Primary Column"] ?? "").trim() ||
    "Work Order";
  const status = String(row["Status"] ?? "Received");
  const storeNum = String(row["Store Number"] ?? "—");
  const vendor = String(row["Vendor"] ?? "");
  const submittedDate = formatDate(row._submittedDate);
  const approvalLevel = String(row._approvalLevel ?? "");

  return (
    <Card
      className={cn(
        "overflow-hidden transition",
        aged && "border-l-4 border-l-red-500",
        closed && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 sm:px-5 sm:py-4"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(status)}>{status}</Badge>
            {approvalLevel && (
              <Badge tone="warning" className="normal-case">
                ⏳ {approvalLevel}
              </Badge>
            )}
          </div>
          <div className="text-sm font-semibold tracking-tight text-midnight sm:text-base">
            {issueText}
          </div>
          <div className="text-xs text-zinc-500">
            Store {storeNum}
            {vendor ? ` · ${vendor}` : ""}
            {submittedDate !== "—" ? ` · ${submittedDate}` : ""}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <Badge tone={ageBucket(days)} className="normal-case">
            {days == null ? "—" : `${days}d`}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />
          )}
        </div>
      </button>

      {expanded && <CardBody row={row} user={user} meta={meta} />}
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Card body — detail + edit + photo + approval
// ----------------------------------------------------------------------------

function CardBody({
  row,
  user,
  meta,
}: {
  row: WorkOrder;
  user: SessionUser;
  meta: WorkOrderMeta;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const isStore = STORE_ROLES.has(user.role);
  const isApprover = APPROVER_ROLES.has(user.role);

  const [status, setStatus] = useState(String(row["Status"] ?? ""));
  const [vendor, setVendor] = useState(String(row["Vendor"] ?? ""));
  const [notes, setNotes] = useState(String(row["Notes"] ?? ""));

  // Approval-request state (only used when triggering)
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [approvalTier, setApprovalTier] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);

  const approvalLevel = String(row._approvalLevel ?? "");
  const hasApprovalRequest = approvalLevel !== "";
  const currentStatus = String(row["Status"] ?? "");
  const alreadyDecided =
    currentStatus === "Approved" || currentStatus === "Rejected - See Notes";
  const canDecide = isApprover && hasApprovalRequest && !alreadyDecided && canApproveRow(user.role, approvalLevel);

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => updateWorkOrder(row.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      toast.push("Saved.", "success");
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Save failed.", "error"),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(row.id, file),
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Upload failed.", "error"),
  });

  const statusOptions = useMemo(() => {
    const allowed = new Set<string>(meta.allowedStatusChanges);
    if (currentStatus) allowed.add(currentStatus);
    return meta.statusOrder.filter((s) => allowed.has(s));
  }, [meta, currentStatus]);

  function saveTicket() {
    if (status === "Closed" && notes.trim().length < 3) {
      toast.push("Notes are required before closing a ticket.", "error");
      return;
    }
    if (status === "Closed") {
      if (!window.confirm("Mark this ticket as Closed?")) return;
    }
    update.mutate({
      Status: status,
      Vendor: vendor,
      Notes: notes,
    });
  }

  async function pickPhoto() {
    fileRef.current?.click();
  }
  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.push("File must be under 10 MB.", "error");
      return;
    }
    upload.mutate(f, {
      onSuccess: () => {
        toast.push("Photo uploaded.", "success");
        qc.invalidateQueries({ queryKey: ["work-orders"] });
      },
    });
  }

  async function submitApproval() {
    if (!approvalTier) {
      toast.push("Choose an approval tier.", "error");
      return;
    }
    if (approvalNotes.trim().length < 3) {
      toast.push("Approval notes are required.", "error");
      return;
    }
    if (!quoteFile) {
      toast.push("Vendor quote attachment is required.", "error");
      return;
    }
    try {
      // 1. Upload quote first; the function writes the URL into Smartsheet's
      //    "Quote URL" column as part of the upload, so by the time we issue
      //    the update below the row already has a quote URL.
      await upload.mutateAsync(quoteFile);
      // 2. Send the approval-request fields. Server enforces required notes
      //    + quote presence, and auto-bumps Status to "Pending Approval".
      await update.mutateAsync({
        "Approval Level": approvalTier,
        "Approval Notes": approvalNotes,
      });
      toast.push("Approval request submitted.", "success");
      setShowApprovalForm(false);
    } catch {
      // Errors already toasted by the mutation handlers.
    }
  }

  function decide(decision: "Approved" | "Rejected - See Notes") {
    update.mutate({ Status: decision });
  }

  return (
    <div className="border-t border-zinc-100 px-4 py-4 sm:px-5 sm:py-5">
      {/* Detail grid */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <FieldRow label="Submitted by" value={display(row._submittedBy)} />
        <FieldRow label="Submitted" value={formatDate(row._submittedDate)} />
        <FieldRow label="Priority" value={display(row["Priority"])} />
        <FieldRow label="Approval level" value={display(approvalLevel)} />
        <FieldRow
          label="Issue description"
          value={display(row._issueDescription)}
          fullWidth
        />
      </dl>

      {/* Update Ticket */}
      <Section title="Update ticket">
        <div className="space-y-3">
          {isStore && (
            <div>
              <Label htmlFor={`vendor-${row.id}`}>Vendor</Label>
              <Input
                id={`vendor-${row.id}`}
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Vendor handling this work"
              />
            </div>
          )}
          <div>
            <Label htmlFor={`notes-${row.id}`}>Notes</Label>
            <textarea
              id={`notes-${row.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 transition outline-none focus:ring-2 focus:ring-accent"
              placeholder="Updates, parts ordered, ETA, etc."
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent sm:flex-1"
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button onClick={saveTicket} disabled={update.isPending} size="md">
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {statusOptions.length === 1 && (
            <p className="text-xs text-zinc-500">
              Your role can't change this ticket's status from the current value.
            </p>
          )}
        </div>
      </Section>

      {/* Photo upload (Store + GM) */}
      {isStore && (
        <Section title="Attach photo">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={onPhoto}
            />
            <Button
              variant="secondary"
              onClick={pickPhoto}
              disabled={upload.isPending}
            >
              {upload.isPending ? "Uploading…" : "Choose file"}
            </Button>
            <span className="text-xs text-zinc-500">
              Up to 10 MB · image or PDF
            </span>
          </div>
        </Section>
      )}

      {/* Quote URL (existing attachment) */}
      {Boolean(row["Quote URL"]) && (
        <Section title="Attached quote">
          <a
            href={String(row["Quote URL"])}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline break-all"
          >
            {String(row["Quote URL"])}
          </a>
        </Section>
      )}

      {/* Existing approval status */}
      {hasApprovalRequest && (
        <Section title="Approval request">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="font-medium text-amber-900">⏳ {approvalLevel}</div>
            {row._approvalNotes && (
              <div className="mt-1 text-amber-900 whitespace-pre-wrap">
                {row._approvalNotes}
              </div>
            )}
            {alreadyDecided && (
              <div className="mt-2 text-xs font-medium text-amber-900">
                Decision: {currentStatus}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Approver decision buttons */}
      {canDecide && (
        <Section title="Approver decision">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => decide("Approved")} disabled={update.isPending}>
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
        </Section>
      )}

      {/* Request approval (any role with edit access, only if not already requested) */}
      {!hasApprovalRequest && currentStatus === "Received" && (
        <Section title="Request approval">
          {!showApprovalForm ? (
            <Button variant="secondary" onClick={() => setShowApprovalForm(true)}>
              Request approval
            </Button>
          ) : (
            <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div>
                <Label htmlFor={`tier-${row.id}`}>Approval tier *</Label>
                <select
                  id={`tier-${row.id}`}
                  value={approvalTier}
                  onChange={(e) => setApprovalTier(e.target.value)}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">— Select tier —</option>
                  {APPROVAL_TIERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`anotes-${row.id}`}>Approval notes *</Label>
                <textarea
                  id={`anotes-${row.id}`}
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  rows={3}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="Describe the work, vendor, cost, why it's needed…"
                />
              </div>
              <QuotePicker file={quoteFile} onPick={setQuoteFile} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={submitApproval}
                  disabled={update.isPending || upload.isPending}
                >
                  {update.isPending || upload.isPending
                    ? "Submitting…"
                    : "Submit approval request"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowApprovalForm(false);
                    setApprovalTier("");
                    setApprovalNotes("");
                    setQuoteFile(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function QuotePicker({
  file,
  onPick,
}: {
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  return (
    <div>
      <Label>Vendor quote *</Label>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (f && f.size > 10 * 1024 * 1024) {
            toast.push("File must be under 10 MB.", "error");
            return;
          }
          onPick(f);
        }}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={() => ref.current?.click()} size="sm">
          {file ? "Replace file" : "Choose file"}
        </Button>
        <span className="truncate text-xs text-zinc-600">
          {file ? `${file.name} (${formatBytes(file.size)})` : "PDF or image, up to 10 MB"}
        </span>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// ----------------------------------------------------------------------------
// Tiny presentational helpers
// ----------------------------------------------------------------------------

function FieldRow({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-800">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 border-t border-zinc-100 pt-4">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </div>
      {children}
    </div>
  );
}

