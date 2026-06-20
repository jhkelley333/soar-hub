import { useMemo, useState, type CSSProperties } from "react";
import { Search, Plus, Download, MessageCircle } from "lucide-react";
import {
  type Ticket,
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
}: {
  tickets: Ticket[];
  stats?: QueueStats;
  currentUserId?: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onExport?: () => void;
}) {
  const [tab, setTab] = useState<TabId>("open");
  const [search, setSearch] = useState("");
  // Multi-select for "Send to vendor" — keyed by ticket id, persists across
  // tab/search changes so you can gather WOs from different views.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSnippet, setShowSnippet] = useState(false);
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
    return tickets.filter((t) => {
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
  }, [tickets, tab, search, currentUserId]);

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
        <table className="w-full min-w-[720px] border-collapse text-sm">
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
              <th style={thStyle}>Work order</th>
              <th style={thStyle}>Issue</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Vendor</th>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Priority</th>
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
