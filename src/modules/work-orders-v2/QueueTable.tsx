import { useMemo, useState, type CSSProperties } from "react";
import { Search, Plus, Download, MessageCircle, ClipboardList, ArrowUp, ArrowDown } from "lucide-react";
import {
  type Ticket,
  type TicketApproval,
  type TicketStatus,
  statusLabel,
  isOpenStatus,
} from "./types";
import { WO, Pill, statusPillTone, priorityPillTone } from "./liveTheme";
import { NotificationBell } from "./NotificationBell";
import { VendorSnippetModal } from "./VendorSnippetModal";

// New work-order queue (flagged: wo2_new_ui). A table-style list matching
// the redesigned mockup — SLA intentionally omitted (not modeled yet),
// app font kept. Reads the same ticket data as the legacy card list; row
// click hands the id back to the parent, which opens the existing ticket
// detail. Net-new is presentational only.

type TabId = "open" | "mine" | "closed" | "all";

// Columns the user can sort by. "approval" is the new approval-state column.
type SortKey =
  | "wo_number"
  | "issue"
  | "status"
  | "vendor"
  | "owner"
  | "priority"
  | "approval";
type SortDir = "asc" | "desc";

// Priority ranking used when sorting by Priority (high → low).
const PRIORITY_RANK: Record<string, number> = {
  Emergency: 0,
  Urgent: 1,
  Standard: 2,
  Low: 3,
};

// The latest approval row on a ticket, by requested_at (PostgREST embed order
// isn't guaranteed). Returns null when no approval has ever been requested.
function latestApproval(t: Ticket): TicketApproval | null {
  const arr = t.ticket_approvals ?? [];
  if (!arr.length) return null;
  return [...arr].sort(
    (a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime(),
  )[arr.length - 1];
}

// Sort weight for the Approval column — order matches what an approver cares
// about most: pending first (asc), then approved, rejected, then none.
function approvalRank(t: Ticket): number {
  const a = latestApproval(t);
  if (!a) return 4;
  if (a.status === "Pending") return 0;
  if (a.status === "Approved") return 1;
  return 2; // Rejected
}

function approvalLabel(a: TicketApproval | null): string {
  if (!a) return "—";
  return a.status; // Pending / Approved / Rejected
}

function approvalPillTone(a: TicketApproval | null): "warn" | "ok" | "danger" | "gray" {
  if (!a) return "gray";
  if (a.status === "Pending") return "warn";
  if (a.status === "Approved") return "ok";
  return "danger";
}

function compareForSort(a: Ticket, b: Ticket, key: SortKey): number {
  const s = (v: string | null | undefined) => (v ?? "").toLowerCase();
  switch (key) {
    case "wo_number":
      return s(a.wo_number).localeCompare(s(b.wo_number));
    case "issue":
      return s(a.asset_type || a.category).localeCompare(s(b.asset_type || b.category));
    case "status":
      return s(statusLabel(a.status)).localeCompare(s(statusLabel(b.status)));
    case "vendor":
      return s(a.vendor_name).localeCompare(s(b.vendor_name));
    case "owner":
      return s(a.submitted_by).localeCompare(s(b.submitted_by));
    case "priority":
      return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
    case "approval":
      return approvalRank(a) - approvalRank(b);
  }
}

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

const secBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 8,
  background: WO.surface,
  color: WO.ink,
  border: `1px solid ${WO.line}`,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

const primaryBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 8,
  background: WO.primary,
  color: WO.primaryInk,
  border: `1px solid ${WO.primary}`,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: WO.shadow,
};

interface QueueStats {
  open: number;
  critical: number;
  aged: number;
  byStatus: Partial<Record<TicketStatus, number>>;
}

export function QueueTable({
  tickets,
  stats,
  currentUserId,
  onOpen,
  onNew,
  onExport,
  onLogWork,
}: {
  tickets: Ticket[];
  stats?: QueueStats;
  currentUserId?: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onExport?: () => void;
  // DO+ only — record work a store had done without a ticket.
  onLogWork?: () => void;
}) {
  const [tab, setTab] = useState<TabId>("open");
  const [search, setSearch] = useState("");
  // Sort state — click a header to toggle asc/desc; clicking a new column
  // resets to asc. Default sort matches the previous fetch order (no manual
  // sort = use the order the data came in).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Multi-select for "Send to vendor" — keyed by ticket id, persists across
  // tab/search changes so you can gather WOs from different views.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSnippet, setShowSnippet] = useState(false);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const toggleOne = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const counts = useMemo(() => {
    let open = 0, closed = 0, mine = 0;
    for (const t of tickets) {
      if (isOpenStatus(t.status)) open++;
      else closed++;
      if (currentUserId && t.submitted_by_user_id === currentUserId) mine++;
    }
    return { open, closed, mine, all: tickets.length };
  }, [tickets, currentUserId]);

  const headline = useMemo(() => {
    const openCount = tickets.filter((t) => isOpenStatus(t.status)).length;
    const stores = new Set(tickets.map((t) => t.store_number)).size;
    const urgent = tickets.filter(
      (t) => isOpenStatus(t.status) && (t.priority === "Emergency" || t.priority === "Urgent"),
    ).length;
    return { openCount, stores, urgent };
  }, [tickets]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = tickets.filter((t) => {
      if (tab === "open" && !isOpenStatus(t.status)) return false;
      if (tab === "closed" && isOpenStatus(t.status)) return false;
      if (tab === "mine" && t.submitted_by_user_id !== currentUserId) return false;
      if (q) {
        const hay = [
          t.wo_number, t.store_number, t.store_name, t.asset_type,
          t.issue_description, t.vendor_name, t.submitted_by,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!sortKey) return filtered;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => sign * compareForSort(a, b, sortKey));
  }, [tickets, tab, search, currentUserId, sortKey, sortDir]);

  const chips = [
    { label: "Open", value: stats?.open ?? counts.open, alert: false },
    { label: "In Progress", value: stats?.byStatus?.in_progress ?? 0, alert: false },
    { label: "On Site", value: stats?.byStatus?.on_site ?? 0, alert: false },
    { label: "Business Critical", value: stats?.critical ?? 0, alert: (stats?.critical ?? 0) > 0 },
    { label: "15+ Days Open", value: stats?.aged ?? 0, alert: (stats?.aged ?? 0) > 0 },
  ];

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "open", label: "Open", count: counts.open },
    { id: "mine", label: "Mine", count: counts.mine },
    { id: "closed", label: "Closed", count: counts.closed },
    { id: "all", label: "All", count: counts.all },
  ];

  const thStyle: CSSProperties = {
    padding: "8px 12px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: WO.muted,
  };

  return (
    <div style={{ color: WO.ink, background: WO.bg, borderRadius: 12, padding: 16 }}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em", color: WO.ink, margin: 0 }}>
            Work orders
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: WO.muted }}>
            {headline.openCount} open across {headline.stores}{" "}
            {headline.stores === 1 ? "store" : "stores"} · {headline.urgent} urgent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell tone="light" align="right" />
          {selected.size > 0 && (
            <button type="button" onClick={() => setShowSnippet(true)} style={primaryBtnStyle}>
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
              Send {selected.size} to vendor
            </button>
          )}
          {onLogWork && (
            <button type="button" onClick={onLogWork} style={secBtnStyle}>
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
              Log work
            </button>
          )}
          {onExport && (
            <button type="button" onClick={onExport} style={secBtnStyle}>
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              Export
            </button>
          )}
          <button type="button" onClick={onNew} style={primaryBtnStyle}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New work order
          </button>
        </div>
      </div>

      {/* Stat chips */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {chips.map((c) => (
          <div
            key={c.label}
            style={{
              borderRadius: 10,
              border: `1px solid ${c.alert ? WO.warnBorder : WO.line}`,
              background: c.alert ? WO.warnSoft : WO.surface,
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: c.alert ? WO.warn : WO.ink, fontVariantNumeric: "tabular-nums" }}>
              {c.value}
            </div>
            <div style={{ marginTop: 2, fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: WO.muted }}>
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + search */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${WO.line}` }}>
        <div className="flex items-center gap-1">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  marginBottom: -1,
                  borderBottom: `2px solid ${on ? WO.primary : "transparent"}`,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: on ? 600 : 500,
                  color: on ? WO.ink : WO.muted,
                  background: "none",
                  cursor: "pointer",
                }}
              >
                {t.label}
                <span style={{ marginLeft: 6, fontSize: 11, color: WO.muted, fontFamily: WO.mono }}>{t.count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative mb-2 w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: WO.muted }} strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this queue…"
            style={{
              width: "100%",
              borderRadius: 8,
              border: `1px solid ${WO.line}`,
              background: WO.surface,
              padding: "8px 12px 8px 34px",
              fontSize: 13,
              color: WO.ink,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div
        className="mt-3 overflow-x-auto"
        style={{ border: `1px solid ${WO.line}`, borderRadius: 10, background: WO.surface }}
      >
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr style={{ textAlign: "left", borderBottom: `1px solid ${WO.line}` }}>
              <th style={{ ...thStyle, width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all in view"
                  checked={rows.length > 0 && rows.every((t) => selected.has(t.id))}
                  onChange={(e) => {
                    const ids = rows.map((t) => t.id);
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) ids.forEach((id) => next.add(id));
                      else ids.forEach((id) => next.delete(id));
                      return next;
                    });
                  }}
                  style={{ cursor: "pointer" }}
                />
              </th>
              <SortableTh label="Work order" sortKey="wo_number" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Issue" sortKey="issue" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Vendor" sortKey="vendor" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Owner" sortKey="owner" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Priority" sortKey="priority" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
              <SortableTh label="Awaiting Approval" sortKey="approval" current={sortKey} dir={sortDir} onClick={toggleSort} style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                style={{ borderTop: `1px solid ${WO.line2}`, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = WO.surfaceAlt)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "12px", verticalAlign: "top" }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.wo_number}`}
                    checked={selected.has(t.id)}
                    onChange={() => toggleOne(t.id)}
                    style={{ cursor: "pointer" }}
                  />
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  <div className="flex items-center gap-2">
                    {(t.unread_message_count ?? 0) > 0 && (
                      <span style={{ width: 6, height: 6, flex: "0 0 6px", borderRadius: 6, background: WO.primary }} aria-label="unread" />
                    )}
                    <span style={{ fontWeight: 600, color: WO.primary, fontFamily: WO.mono, fontSize: 12 }}>{t.wo_number}</span>
                    {t.is_logged_offline && (
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: WO.muted, border: `1px solid ${WO.line}`, borderRadius: 5, padding: "1px 5px" }}>
                        Logged
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  {/* Asset is the title; the free-text issue is the line below. */}
                  <div style={{ fontWeight: 600, color: WO.ink }}>{t.asset_type || t.category || "—"}</div>
                  {t.issue_description && (
                    <div className="line-clamp-1" style={{ marginTop: 2, fontSize: 12.5, color: WO.ink2 }}>
                      {t.issue_description}
                    </div>
                  )}
                  <div style={{ marginTop: 2, fontSize: 11, color: WO.muted }}>
                    <span style={{ fontFamily: WO.mono }}>Store {t.store_number}</span>
                    {t.store_name ? ` · ${t.store_name}` : ""}
                    {t.category ? ` · ${t.category}` : ""}
                  </div>
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  <Pill tone={statusPillTone(t.status)} dot>{statusLabel(t.status)}</Pill>
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  {t.vendor_name ? (
                    <span style={{ color: WO.ink2 }}>{t.vendor_name}</span>
                  ) : t.needs_vendor_help ? (
                    <Pill tone="warn" dot>Needs vendor help</Pill>
                  ) : (
                    <span style={{ color: WO.muted, fontStyle: "italic" }}>Unassigned</span>
                  )}
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  <span
                    title={t.submitted_by ?? undefined}
                    style={{
                      display: "inline-flex",
                      width: 28,
                      height: 28,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 28,
                      background: WO.avatarBg,
                      color: WO.avatarFg,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {initials(t.submitted_by)}
                  </span>
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  <Pill tone={priorityPillTone(t.priority)}>{t.priority}</Pill>
                </td>
                <td style={{ padding: "12px", verticalAlign: "top" }}>
                  {(() => {
                    const a = latestApproval(t);
                    const tone = approvalPillTone(a);
                    if (!a) return <span style={{ color: WO.muted }}>—</span>;
                    return (
                      <Pill tone={tone} dot>
                        {approvalLabel(a)}
                      </Pill>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div style={{ borderTop: `1px solid ${WO.line2}`, padding: "48px 0", textAlign: "center", fontSize: 13, color: WO.muted }}>
            No work orders match this view.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: WO.muted }}>
        Showing {rows.length} of {tickets.length}
        {selected.size > 0 && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{ background: "none", border: "none", padding: 0, color: WO.primary, cursor: "pointer", font: "inherit" }}
            >
              Clear {selected.size} selected
            </button>
          </>
        )}
      </div>

      {showSnippet && (
        <VendorSnippetModal ids={[...selected]} onClose={() => setShowSnippet(false)} />
      )}
    </div>
  );
}

// Clickable header cell that toggles sort direction on its column and shows an
// arrow for the active column. Keeps the existing thStyle look so the column
// row stays visually consistent — the column just becomes interactive.
function SortableTh({
  label,
  sortKey,
  current,
  dir,
  onClick,
  style,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey | null;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  style: CSSProperties;
}) {
  const active = current === sortKey;
  return (
    <th style={style}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          color: active ? WO.ink : WO.muted,
          font: "inherit",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="h-3 w-3" strokeWidth={2.25} />
          ) : (
            <ArrowDown className="h-3 w-3" strokeWidth={2.25} />
          ))}
      </button>
    </th>
  );
}
