// Work Orders V2 — admin-only test page at /admin/work-orders-v2.
// Four-tab UI (Tickets / Vendors / Issue Library / Email Templates)
// backed by netlify/functions/facilities-v2. Lives on the v2 branch only.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  fetchStats,
  fetchTickets,
  fileToBase64,
  updateTicket,
  uploadPhoto,
} from "./api";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isOpenStatus,
  statusLabel,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from "./types";
import { NewTicketModal } from "./NewTicketModal";
import { ApprovalSection } from "./ApprovalSection";
import { TicketChat } from "./TicketChat";
import { VendorsTab } from "./VendorsTab";
import { IssueLibraryTab } from "./IssueLibraryTab";
import { TroubleshootingTipsTab } from "./TroubleshootingTipsTab";
import { EmailTemplatesTab } from "./EmailTemplatesTab";

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "danger" | "neutral"> = {
  "submitted":   "info",
  "in_progress": "warning",
  "scheduled":   "info",
  "on_site":     "warning",
  "completed":   "success",
  "closed":      "neutral",
  "cancelled":   "neutral",
};

const PRIORITY_TONE: Record<TicketPriority, "danger" | "warning" | "neutral"> = {
  Emergency: "danger",
  Urgent:    "warning",
  Standard:  "neutral",
  Planned:   "neutral",
};

const CATEGORIES = [
  "Facilities & Infrastructure",
  "Equipment Type",
  "POS & POPS",
  "Beverage",
  "Other",
];

type TabId = "tickets" | "vendors" | "library" | "troubleshooting" | "email-templates";
const TABS: { id: TabId; label: string }[] = [
  { id: "tickets", label: "Tickets" },
  { id: "vendors", label: "Vendors" },
  { id: "library", label: "Issue Library" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "email-templates", label: "Email Templates" },
];

// Route is admin-only, so we can treat the caller as admin for any
// child-component role checks. If the gate is widened later, replace
// this with a real auth context lookup.
const CALLER_ROLE = "admin";

function daysOpen(t: Ticket): number | null {
  if (!t.date_submitted) return null;
  const d = new Date(t.date_submitted);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtMoney(v: number | string | null) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function WorkOrdersV2Page() {
  const [tab, setTab] = useState<TabId>("tickets");

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Work Orders V2
            <Badge tone="warning">BETA</Badge>
          </span>
        }
        description="Facilities ticketing on Supabase — open BETA. Please report issues so we can iterate before rolling this out as the primary work-orders flow."
      />

      <div className="mb-4 flex border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium tracking-tight transition",
              tab === t.id
                ? "border-accent text-midnight"
                : "border-transparent text-zinc-500 hover:text-midnight",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tickets" && <TicketsTab />}
      {tab === "vendors" && <VendorsTab callerRole={CALLER_ROLE} />}
      {tab === "library" && <IssueLibraryTab />}
      {tab === "troubleshooting" && <TroubleshootingTipsTab />}
      {tab === "email-templates" && <EmailTemplatesTab />}
    </>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────

function TicketsTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const ticketsQ = useQuery({
    queryKey: ["wo2", "tickets"],
    queryFn: fetchTickets,
    staleTime: 30_000,
  });
  const statsQ = useQuery({
    queryKey: ["wo2", "stats"],
    queryFn: fetchStats,
    staleTime: 30_000,
  });

  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const tickets = ticketsQ.data?.tickets ?? [];
  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (openOnly && !isOpenStatus(t.status)) return false;
      if (status && t.status !== status) return false;
      if (priority && t.priority !== priority) return false;
      if (category && t.category !== category) return false;
      if (search) {
        const hay = [
          t.wo_number, t.store_number, t.store_name, t.asset_type,
          t.issue_description, t.vendor_name, t.submitted_by,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [tickets, status, priority, category, search, openOnly]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["wo2"] });
  }

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          New Ticket
        </Button>
        <Button variant="ghost" onClick={refetchAll}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          Refresh
        </Button>
      </div>

      <StatsRow loading={statsQ.isLoading} stats={statsQ.data?.stats} />

      <FilterBar
        status={status} setStatus={setStatus}
        priority={priority} setPriority={setPriority}
        category={category} setCategory={setCategory}
        search={search} setSearch={setSearch}
        openOnly={openOnly} setOpenOnly={setOpenOnly}
      />

      {ticketsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {ticketsQ.isError && (
        <EmptyState
          title="Couldn't load tickets"
          description={(ticketsQ.error as Error)?.message ?? "Try again."}
        />
      )}

      {!ticketsQ.isLoading && !ticketsQ.isError && filtered.length === 0 && (
        <EmptyState
          title={tickets.length === 0 ? "No tickets yet" : "No tickets match these filters"}
          description={
            tickets.length === 0
              ? "Click “New Ticket” above to submit a test request."
              : "Try clearing a filter or the search box."
          }
        />
      )}

      <div className="space-y-3">
        {filtered.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            expanded={expanded.has(t.id)}
            onToggle={() => toggleExpand(t.id)}
            onUpdated={() => {
              toast.push("Ticket updated.", "success");
              refetchAll();
            }}
            onPhotoUploaded={(count) => {
              toast.push(`${count} photo${count === 1 ? "" : "s"} uploaded.`, "success");
              refetchAll();
            }}
            onApprovalChanged={() => {
              toast.push("Approval saved.", "success");
              refetchAll();
            }}
            onError={(e) => toast.push(e, "error")}
          />
        ))}
      </div>

      <NewTicketModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(woNumber) => {
          setModalOpen(false);
          toast.push(`Ticket ${woNumber} created.`, "success");
          refetchAll();
        }}
        onError={(msg) => toast.push(msg, "error")}
      />
    </>
  );
}

// ── Stats Row ─────────────────────────────────────────────────────

function StatsRow({
  loading,
  stats,
}: {
  loading: boolean;
  stats?: {
    open: number;
    critical: number;
    aged: number;
    byStatus: Partial<Record<TicketStatus, number>>;
  };
}) {
  const cards = [
    { label: "Open", value: stats?.open ?? 0, tone: "" as const },
    { label: "In Progress", value: stats?.byStatus?.["in_progress"] ?? 0, tone: "" as const },
    { label: "On Site", value: stats?.byStatus?.["on_site"] ?? 0, tone: "" as const },
    { label: "Business Critical", value: stats?.critical ?? 0, tone: (stats?.critical ?? 0) > 0 ? "alert" : "" as const },
    { label: "15+ Days Open", value: stats?.aged ?? 0, tone: (stats?.aged ?? 0) > 0 ? "alert" : "" as const },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className={cn("p-4 text-center", c.tone === "alert" && "border-red-200 bg-red-50")}>
          {loading ? (
            <Skeleton className="mx-auto h-7 w-12" />
          ) : (
            <div className={cn("text-2xl font-semibold tracking-tight", c.tone === "alert" ? "text-red-600" : "text-midnight")}>
              {c.value}
            </div>
          )}
          <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-wide", c.tone === "alert" ? "text-red-600" : "text-zinc-500")}>
            {c.label}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────

function FilterBar({
  status, setStatus,
  priority, setPriority,
  category, setCategory,
  search, setSearch,
  openOnly, setOpenOnly,
}: {
  status: TicketStatus | "";
  setStatus: (s: TicketStatus | "") => void;
  priority: TicketPriority | "";
  setPriority: (p: TicketPriority | "") => void;
  category: string;
  setCategory: (c: string) => void;
  search: string;
  setSearch: (q: string) => void;
  openOnly: boolean;
  setOpenOnly: (b: boolean) => void;
}) {
  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
      <FilterField label="Status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TicketStatus | "")}
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All Statuses</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </FilterField>
      <FilterField label="Priority">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority | "")}
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All Priorities</option>
          {TICKET_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </FilterField>
      <FilterField label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </FilterField>
      <div className="flex-1 min-w-[200px]">
        <Label htmlFor="wo2-search">Search</Label>
        <Input
          id="wo2-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="WO#, store, asset…"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer pb-2">
        <input
          type="checkbox"
          checked={openOnly}
          onChange={(e) => setOpenOnly(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Open only
      </label>
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

// ── Ticket Card ───────────────────────────────────────────────────

function TicketCard({
  ticket,
  expanded,
  onToggle,
  onUpdated,
  onPhotoUploaded,
  onApprovalChanged,
  onError,
}: {
  ticket: Ticket;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: () => void;
  onPhotoUploaded: (count: number) => void;
  onApprovalChanged: () => void;
  onError: (msg: string) => void;
}) {
  const days = daysOpen(ticket);
  const open = isOpenStatus(ticket.status);
  const aged = open && days !== null && days >= 15;
  const ageTone =
    days === null || !open ? "neutral" :
    days <= 7  ? "success" :
    days <= 14 ? "warning" :
    "danger";

  return (
    <Card
      className={cn(
        "overflow-hidden",
        aged && "border-l-4 border-l-red-500",
        ticket.is_business_critical && !aged && "border-l-4 border-l-amber-500",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-zinc-500">
            {ticket.wo_number} · Store {ticket.store_number} · {fmtDate(ticket.date_submitted)}
            {ticket.is_business_critical && (
              <span className="ml-1 inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-amber-600">
                <AlertTriangle className="h-3 w-3" strokeWidth={1.75} /> CRITICAL
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-midnight">
            {ticket.asset_type || ticket.category || "Work Order"}
          </div>
          <div className="line-clamp-1 text-xs text-zinc-500">
            {ticket.issue_description || ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"}>{statusLabel(ticket.status)}</Badge>
          {ticket.priority && ticket.priority !== "Standard" && (
            <Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
          )}
          <Badge tone={ageTone}>{days === null ? "—" : `${days}d`}</Badge>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />
            : <ChevronDown className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />}
        </div>
      </button>

      {expanded && (
        <CardBody className="border-t border-zinc-100 bg-zinc-50/60 space-y-4">
          <DetailGrid ticket={ticket} />
          <DescriptionBlock label="Issue Description" value={ticket.issue_description} />
          {ticket.latest_comment && (
            <DescriptionBlock label="Latest Comment" value={ticket.latest_comment} />
          )}

          <PhotoSection
            ticket={ticket}
            onUploaded={onPhotoUploaded}
            onError={onError}
          />

          <ApprovalSection
            ticket={ticket}
            callerRole={CALLER_ROLE}
            onChanged={onApprovalChanged}
            onError={onError}
          />

          <UpdateForm ticket={ticket} onUpdated={onUpdated} onError={onError} />

          {(ticket.ticket_updates?.length ?? 0) > 0 && <Activity updates={ticket.ticket_updates!} />}

          <TicketChat ticketId={ticket.id} onError={onError} />
        </CardBody>
      )}
    </Card>
  );
}

function DetailGrid({ ticket }: { ticket: Ticket }) {
  const items = [
    { label: "Store", value: ticket.store_name || ticket.store_number },
    { label: "Category", value: ticket.category || "—" },
    { label: "Vendor", value: ticket.vendor_name || "—" },
    { label: "Model #", value: ticket.model_number || "—" },
    { label: "Cost Estimate", value: fmtMoney(ticket.cost_estimate) },
    { label: "Submitted By", value: ticket.submitted_by || "—" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{i.label}</dt>
          <dd className="text-sm text-midnight">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DescriptionBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-midnight">{value || "—"}</div>
    </div>
  );
}

function PhotoSection({
  ticket,
  onUploaded,
  onError,
}: {
  ticket: Ticket;
  onUploaded: (count: number) => void;
  onError: (msg: string) => void;
}) {
  const photos = ticket.ticket_photos ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      let count = 0;
      for (const f of files) {
        const photoData = await fileToBase64(f);
        await uploadPhoto({
          id: ticket.id,
          photoData,
          photoType: f.type || "image/jpeg",
          photoName: f.name,
          uploadType: "update",
        });
        count++;
      }
      return count;
    },
    onSuccess: (count) => onUploaded(count),
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Upload failed."),
  });

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    e.target.value = "";
    if (files.length === 0) return;
    upload.mutate(files);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Photos {photos.length > 0 && `(${photos.length})`}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-accent hover:text-midnight disabled:opacity-50"
        >
          {upload.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <ImageIcon className="h-3 w-3" strokeWidth={1.75} />}
          {upload.isPending ? "Uploading…" : "Add Photos"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
      {photos.length === 0 ? (
        <div className="text-xs text-zinc-500">No photos yet.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => {
            const isPdf =
              (p.file_name || "").toLowerCase().endsWith(".pdf") ||
              (p.file_url || "").toLowerCase().endsWith(".pdf");
            return (
              <a
                key={p.id}
                href={p.file_url}
                target="_blank"
                rel="noopener noreferrer"
                title={p.file_name || ""}
                className="block h-16 w-16 overflow-hidden rounded border border-zinc-200 bg-white"
              >
                {isPdf ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-rose-50 px-1 text-rose-700">
                    <FileText className="h-5 w-5" strokeWidth={1.75} />
                    <span className="text-[9px] font-semibold uppercase tracking-wide">PDF</span>
                  </div>
                ) : (
                  <img
                    src={p.file_url}
                    alt={p.file_name || ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Activity({ updates }: { updates: Ticket["ticket_updates"] }) {
  if (!updates?.length) return null;
  const sorted = [...updates]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Activity
      </div>
      <ul className="space-y-1.5">
        {sorted.map((u) => (
          <li key={u.id} className="flex gap-2 text-xs">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <div className="min-w-0">
              <span className="font-medium text-midnight">{u.user_name || "System"}</span>
              <span className="text-zinc-500"> · {u.update_type}</span>
              {u.notes && <span className="text-zinc-700">: {u.notes}</span>}
              <div className="text-[10px] text-zinc-400">{fmtDate(u.created_at)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UpdateForm({
  ticket,
  onUpdated,
  onError,
}: {
  ticket: Ticket;
  onUpdated: () => void;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [vendorName, setVendorName] = useState(ticket.vendor_name || "");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: () => {
      if (status === "closed" && !notes.trim()) {
        return Promise.reject(new Error("Notes are required to close a ticket."));
      }
      return updateTicket({
        id: ticket.id,
        status: status !== ticket.status ? status : undefined,
        priority: priority !== ticket.priority ? priority : undefined,
        vendorName: vendorName !== (ticket.vendor_name || "") ? vendorName : undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setNotes("");
      onUpdated();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Update failed."),
  });

  const dirty =
    status !== ticket.status ||
    priority !== ticket.priority ||
    vendorName !== (ticket.vendor_name || "") ||
    notes.trim().length > 0;

  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Update Ticket
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`wo2-status-${ticket.id}`}>Status</Label>
          <select
            id={`wo2-status-${ticket.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`wo2-priority-${ticket.id}`}>Priority</Label>
          <select
            id={`wo2-priority-${ticket.id}`}
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {TICKET_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor={`wo2-vendor-${ticket.id}`}>Vendor</Label>
        <Input
          id={`wo2-vendor-${ticket.id}`}
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="Vendor name"
        />
      </div>
      <div className="mt-3">
        <Label htmlFor={`wo2-notes-${ticket.id}`}>Notes / Comment</Label>
        <textarea
          id={`wo2-notes-${ticket.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add update notes (required to close)…"
          className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          onClick={() => mut.mutate()}
          disabled={!dirty || mut.isPending}
        >
          {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Save Update
        </Button>
      </div>
    </div>
  );
}
