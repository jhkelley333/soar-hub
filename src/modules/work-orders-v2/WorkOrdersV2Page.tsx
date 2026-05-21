// Work Orders V2 — admin-only test page at /admin/work-orders-v2.
// Four-tab UI (Tickets / Vendors / Issue Library / Email Templates)
// backed by netlify/functions/facilities-v2. Lives on the v2 branch only.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
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
  markTicketSeen,
  updateTicket,
  uploadPhoto,
  deleteTicket,
} from "./api";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  isOpenStatus,
  statusLabel,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type ThreadType,
} from "./types";
import { NewTicketModal } from "./NewTicketModal";
import { VendorSearchInput } from "./VendorSearchInput";
import { ApprovalSection } from "./ApprovalSection";
import { TicketChat } from "./TicketChat";
import { VendorsTab } from "./VendorsTab";
import { IssueLibraryTab } from "./IssueLibraryTab";
import { TroubleshootingTipsTab } from "./TroubleshootingTipsTab";
import { EmailTemplatesTab } from "./EmailTemplatesTab";
import { VendorPortalAdminTab } from "./VendorPortalAdminTab";
import { PreventiveMaintenanceTab } from "./PreventiveMaintenanceTab";
import { LegacyImportTab } from "./LegacyImportTab";
import { MyStoreQrPanel } from "./MyStoreQrPanel";
import { StatusBar } from "./StatusBar";
import { TicketActionBar } from "./TicketActionBar";
import { TicketActivityFeed } from "./TicketActivityFeed";
import { useAuth } from "@/auth/AuthProvider";

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "danger" | "neutral"> = {
  "submitted":          "info",
  "in_progress":        "warning",
  "scheduled":          "info",
  "on_site":            "warning",
  "awaiting_equipment": "warning",
  "completed":          "success",
  "closed":             "neutral",
  "cancelled":          "neutral",
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

// Main page tabs. Settings-style tabs (Issue Library / Troubleshooting
// / Email Templates / Vendor QR) live in a separate Settings panel
// reached from the gear icon in the page header — gated to RVP+ only.
type TabId = "tickets" | "vendors" | "my-store-qr";
const TABS: {
  id: TabId;
  label: string;
  roles?: string[];
}[] = [
  { id: "tickets", label: "Tickets" },
  { id: "vendors", label: "Vendors" },
  // My Store QR: read-only print panel for the caller's own stores.
  // Anyone in the WO2 BETA cohort can see + print their store's QR.
  { id: "my-store-qr", label: "My Store QR" },
];

// Settings sub-tabs — rendered only when the user enters Settings
// via the gear icon. RVP+ only.
type SettingsTabId = "library" | "troubleshooting" | "email-templates" | "vendor-qr" | "preventive-maintenance" | "legacy-import";
const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: "library",         label: "Issue Library" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "email-templates", label: "Email Templates" },
  { id: "vendor-qr",       label: "Vendor QR" },
  { id: "preventive-maintenance", label: "Preventive Maintenance" },
  { id: "legacy-import",   label: "Legacy Import" },
];
const SETTINGS_ROLES = new Set(["rvp", "vp", "coo", "admin"]);

// Caller's role comes from the real auth context now (PR 2). The route
// is opened to field tiers during BETA; legacy hardcoded admin role is
// gone. Sub-components that need the role take it as a prop.

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
  // When non-null, we're inside the Settings panel rather than the
  // main tab strip. Holds whichever settings sub-tab is active.
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(null);
  const { profile } = useAuth();
  const callerRole = profile?.role || "gm"; // safe default; backend re-checks every action
  const canSeeSettings = SETTINGS_ROLES.has(callerRole);

  return (
    <>
      <PageHeader
        title="Work Orders"
        description={
          settingsTab
            ? "Settings — issue library, troubleshooting tips, email templates, vendor QR, preventive maintenance, and legacy import."
            : "Submit, route, and close facilities work orders across every store. Stores, vendors, and internal staff collaborate on each ticket in one place."
        }
        actions={
          canSeeSettings && !settingsTab ? (
            <button
              type="button"
              onClick={() => setSettingsTab("library")}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-accent hover:text-midnight"
              title="Settings (RVP+)"
            >
              <Settings className="h-4 w-4" strokeWidth={1.75} />
              Settings
            </button>
          ) : null
        }
      />

      {/* "Powered by FacilityOS" credit line. Wrapped in a dark pill
          because the neon-cyan glow effect needs a dark backdrop to
          read — on the page's white background the halo just scatters
          and washes the text out. Poppins semibold, uppercased, with
          a tight + wide text-shadow pair for the neon-tube halo. */}
      <div className="mb-4 -mt-2 flex justify-end">
        <span
          style={{
            fontFamily: '"Poppins", "DM Sans", system-ui, sans-serif',
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "#5FFBF1",
            backgroundColor: "#0a0a0a",
            textShadow:
              "0 0 4px #5FFBF1, 0 0 10px rgba(95, 251, 241, 0.75), 0 0 20px rgba(95, 251, 241, 0.4)",
          }}
          className="rounded-full border border-zinc-900 px-3 py-1 text-[12px] uppercase shadow-sm"
        >
          Powered by FacilityOS
        </span>
      </div>

      {settingsTab ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-zinc-200">
            <div className="flex">
              {SETTINGS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSettingsTab(t.id)}
                  className={cn(
                    "-mb-px border-b-2 px-4 py-2 text-sm font-medium tracking-tight transition",
                    settingsTab === t.id
                      ? "border-accent text-midnight"
                      : "border-transparent text-zinc-500 hover:text-midnight",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSettingsTab(null)}
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
              Back to Work Orders
            </button>
          </div>

          {settingsTab === "library"         && <IssueLibraryTab />}
          {settingsTab === "troubleshooting" && <TroubleshootingTipsTab />}
          {settingsTab === "email-templates" && <EmailTemplatesTab />}
          {settingsTab === "vendor-qr"       && <VendorPortalAdminTab />}
          {settingsTab === "preventive-maintenance" && <PreventiveMaintenanceTab />}
          {settingsTab === "legacy-import"   && <LegacyImportTab />}
        </>
      ) : (
        <>
          <div className="mb-4 flex border-b border-zinc-200">
            {TABS
              .filter((t) => !t.roles || t.roles.includes(callerRole))
              .map((t) => (
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

          {tab === "tickets"      && <TicketsTab />}
          {tab === "vendors"      && <VendorsTab callerRole={callerRole} />}
          {tab === "my-store-qr"  && <MyStoreQrPanel />}
        </>
      )}
    </>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────

function TicketsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const callerRole = profile?.role || "gm";

  // URL params for dashboard deep-link.
  //   ?ticket=<uuid>           → auto-expand that ticket on mount
  //   ?thread=internal|vendor  → set the chat tab to that thread
  //                              when the ticket renders
  const [searchParams] = useSearchParams();
  const focusTicketId = searchParams.get("ticket") || null;
  const focusThread =
    (searchParams.get("thread") as ThreadType | null) || null;

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

  // Once tickets are loaded, if we have a ?ticket= deep-link, make
  // sure it's expanded + scrolled into view. Strip the param from
  // the URL after we apply it so a refresh doesn't keep re-focusing.
  useEffect(() => {
    if (!focusTicketId || tickets.length === 0) return;
    const exists = tickets.some((t) => t.id === focusTicketId);
    if (!exists) return;
    setExpanded((prev) => {
      if (prev.has(focusTicketId)) return prev;
      const next = new Set(prev);
      next.add(focusTicketId);
      return next;
    });
    // Mark seen for the deep-linked ticket so the unread badge
    // clears as the user lands.
    markTicketSeen(focusTicketId)
      .then(() => qc.invalidateQueries({ queryKey: ["wo2", "tickets"] }))
      .catch((e) => console.warn("[wo2] markTicketSeen (deep-link) failed", e));
    // Scroll the card into view after the expansion animation settles.
    const id = focusTicketId;
    const scroll = () => {
      const el = document.querySelector<HTMLElement>(`[data-ticket-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const t = setTimeout(scroll, 200);
    return () => clearTimeout(t);
  }, [focusTicketId, tickets, qc]);
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
      const wasExpanded = next.has(id);
      if (wasExpanded) {
        next.delete(id);
      } else {
        next.add(id);
        // Mark seen as soon as the user opens the card. Fire and
        // forget — if it fails, the badge just stays until the next
        // tickets refetch. Invalidate the list so the badge updates
        // immediately on success.
        markTicketSeen(id)
          .then(() => qc.invalidateQueries({ queryKey: ["wo2", "tickets"] }))
          .catch((e) => console.warn("[wo2] markTicketSeen failed", e));
      }
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
            callerRole={callerRole}
            initialThread={t.id === focusTicketId ? focusThread : null}
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
  callerRole,
  initialThread,
}: {
  ticket: Ticket;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: () => void;
  onPhotoUploaded: (count: number) => void;
  onApprovalChanged: () => void;
  onError: (msg: string) => void;
  callerRole: string;
  // When non-null, opens this card's TicketChat with the given
  // thread selected (used by dashboard deep-link).
  initialThread?: ThreadType | null;
}) {
  const { profile } = useAuth();
  const isSubmitter = !!profile?.id
    && !!ticket.submitted_by_user_id
    && profile.id === ticket.submitted_by_user_id;
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
      data-ticket-id={ticket.id}
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
          {(ticket.unread_message_count ?? 0) > 0 && (
            <span
              title={`${ticket.unread_message_count} unread message${ticket.unread_message_count === 1 ? "" : "s"}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
            >
              <MessageCircle className="h-3 w-3" strokeWidth={2} />
              {ticket.unread_message_count}
            </span>
          )}
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
          <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3">
            <StatusBar
              status={ticket.status}
              pauseState={ticket.pause_state}
              closedByStore={ticket.closed_by_store}
            />
            <TicketActionBar
              ticketId={ticket.id}
              status={ticket.status}
              closedAt={ticket.closed_at}
              storeNumber={ticket.store_number}
              isSubmitter={isSubmitter}
            />
          </div>

          {ticket.status === "completed" && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                Awaiting your confirmation
              </div>
              <div className="mt-1 text-sm text-amber-900">
                The vendor marked this completed{ticket.vendor_name ? ` (${ticket.vendor_name})` : ""}.
                Please confirm the work was done satisfactorily, or reopen if it
                wasn't. Use the buttons in the action bar above:
                {" "}<strong>Confirm Fix</strong> to close, or
                {" "}<strong>Reopen — Not Fixed</strong> to send it back.
              </div>
            </div>
          )}

          <ReplacementBanner ticket={ticket} />

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
            callerRole={callerRole}
            onChanged={onApprovalChanged}
            onError={onError}
          />

          {/* Edit form for the non-status fields (notes / vendor /
              priority / business-critical). Status transitions are
              handled by TicketActionBar at the top of the card. */}
          <UpdateForm ticket={ticket} onUpdated={onUpdated} onError={onError} />

          <ActivityFeedPanel ticketId={ticket.id} />

          <TicketChat
            ticketId={ticket.id}
            onError={onError}
            initialThread={initialThread || undefined}
          />

          {callerRole === "admin" && (
            <AdminDeleteTicketRow
              ticketId={ticket.id}
              woNumber={ticket.wo_number}
              onDeleted={onUpdated}
              onError={onError}
            />
          )}
        </CardBody>
      )}
    </Card>
  );
}

// Surfaces the replacement-equipment details once the team has
// committed to ordering new equipment. Lives between the action-bar
// notices and the detail grid so it's the first thing readers see
// about the ticket's current direction. Renders nothing until at
// least one replacement field is populated, so we don't show an
// empty container on every ticket.
function ReplacementBanner({ ticket }: { ticket: Ticket }) {
  const hasAny =
    !!ticket.replacement_model
    || !!ticket.replacement_supplier
    || ticket.replacement_cost != null
    || !!ticket.replacement_eta;
  if (!hasAny) return null;

  const items: Array<{ label: string; value: string }> = [];
  items.push({ label: "Model / SKU", value: ticket.replacement_model || "—" });
  items.push({ label: "Supplier",    value: ticket.replacement_supplier || "—" });
  items.push({ label: "Cost",        value: fmtMoney(ticket.replacement_cost) });
  items.push({ label: "Expected",    value: ticket.replacement_eta ? fmtDate(ticket.replacement_eta) : "—" });

  const isAwaiting = ticket.status === "awaiting_equipment";
  return (
    <div className={cn(
      "mt-3 rounded-md border p-3",
      isAwaiting ? "border-indigo-200 bg-indigo-50" : "border-zinc-200 bg-zinc-50",
    )}>
      <div className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        isAwaiting ? "text-indigo-900" : "text-zinc-700",
      )}>
        {isAwaiting ? "Awaiting replacement equipment" : "Replacement details"}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{i.label}</dt>
            <dd className={cn(
              "text-sm",
              isAwaiting ? "text-indigo-900" : "text-midnight",
            )}>
              {i.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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

function ActivityFeedPanel({ ticketId }: { ticketId: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Activity
      </div>
      <TicketActivityFeed ticketId={ticketId} />
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
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority);
  const [vendorName, setVendorName] = useState(ticket.vendor_name || "");
  const [vendorId, setVendorId] = useState<string | null>(ticket.vendor_id || null);
  const [notes, setNotes] = useState("");

  const initialVendorName = ticket.vendor_name || "";
  const initialVendorId = ticket.vendor_id || null;

  const mut = useMutation({
    mutationFn: () =>
      updateTicket({
        id: ticket.id,
        priority: priority !== ticket.priority ? priority : undefined,
        vendorName: vendorName !== initialVendorName ? vendorName : undefined,
        // Send vendorId on any change — including null, which the
        // backend treats as "clear the link" so a typed-over name
        // doesn't keep a stale id.
        vendorId: vendorId !== initialVendorId ? vendorId : undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      setNotes("");
      onUpdated();
    },
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Update failed."),
  });

  const dirty =
    priority !== ticket.priority ||
    vendorName !== initialVendorName ||
    vendorId !== initialVendorId ||
    notes.trim().length > 0;

  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Update Ticket
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <VendorSearchInput
          id={`wo2-vendor-${ticket.id}`}
          storeNumber={ticket.store_number}
          value={vendorName}
          vendorId={vendorId}
          onChange={({ name, id }) => {
            setVendorName(name);
            setVendorId(id);
          }}
          placeholder="Search vendors or type a one-off name…"
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

// Admin-only hard-delete row at the bottom of the expanded ticket
// card. Used to clean up test tickets / mistakes. Backend re-checks
// admin role; this just hides the button for everyone else.
//
// Two-click safety: first click reveals a typed-confirmation row.
// The actual mutation only fires after the user types "DELETE" and
// presses Delete ticket. Avoids any single-click foot-gun while
// still being fast enough to chew through a dozen test rows.
function AdminDeleteTicketRow({
  ticketId,
  woNumber,
  onDeleted,
  onError,
}: {
  ticketId: string;
  woNumber: string;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);

  async function doDelete() {
    if (confirmText.trim().toUpperCase() !== "DELETE") {
      toast.push("Type DELETE to confirm.", "error");
      return;
    }
    setPending(true);
    try {
      await deleteTicket(ticketId);
      toast.push(`Deleted ${woNumber}.`, "success");
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex justify-end border-t border-zinc-200 pt-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
          title="Admin: hard-delete this ticket"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Delete ticket (admin)
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-900">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
        Hard-delete {woNumber}
      </div>
      <p className="mb-2 text-[11px] text-red-900">
        This removes the ticket and all of its activities, photos, messages,
        approvals, and notifications. Cannot be undone. Type{" "}
        <code className="rounded bg-white px-1 py-0.5">DELETE</code> to confirm.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-32"
        />
        <Button
          variant="primary"
          onClick={doDelete}
          disabled={pending || confirmText.trim().toUpperCase() !== "DELETE"}
        >
          {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Delete ticket
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setConfirming(false);
            setConfirmText("");
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
