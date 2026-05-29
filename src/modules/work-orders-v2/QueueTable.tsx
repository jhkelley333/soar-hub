import { useMemo, useState } from "react";
import { Search, Plus, Download } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import {
  type Ticket,
  type TicketStatus,
  statusLabel,
  isOpenStatus,
} from "./types";
import { Pill, statusPillTone, priorityPillTone } from "./liveTheme";

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

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-midnight">Work orders</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {headline.openCount} open across {headline.stores}{" "}
            {headline.stores === 1 ? "store" : "stores"} · {headline.urgent} urgent
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onExport && (
            <Button variant="ghost" onClick={onExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
              Export
            </Button>
          )}
          <Button variant="primary" onClick={onNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.75} />
            New work order
          </Button>
        </div>
      </div>

      {/* Stat chips */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {chips.map((c) => (
          <div
            key={c.label}
            className={`rounded-lg border px-4 py-3 ${
              c.alert ? "border-red-200 bg-red-50" : "border-zinc-200 bg-white"
            }`}
          >
            <div className={`text-2xl font-semibold tabular-nums ${c.alert ? "text-red-700" : "text-midnight"}`}>
              {c.value}
            </div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + search */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "border-accent text-midnight"
                  : "border-transparent text-zinc-500 hover:text-midnight"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-zinc-400 tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="relative mb-2 w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this queue…"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2.5">Work order</th>
              <th className="px-3 py-2.5">Issue</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Vendor</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Priority</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="cursor-pointer border-t border-zinc-100 transition hover:bg-zinc-50"
              >
                <td className="px-3 py-3 align-top">
                  <div className="flex items-center gap-2">
                    {(t.unread_message_count ?? 0) > 0 && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="unread" />
                    )}
                    <span className="font-medium tabular-nums text-midnight">{t.wo_number}</span>
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-zinc-800">
                    {t.asset_type || t.category || "—"}
                    {t.issue_description ? ` — ${t.issue_description}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Store {t.store_number}
                    {t.store_name ? ` · ${t.store_name}` : ""}
                    {t.category ? ` · ${t.category}` : ""}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <Pill tone={statusPillTone(t.status)} dot>{statusLabel(t.status)}</Pill>
                </td>
                <td className="px-3 py-3 align-top">
                  {t.vendor_name
                    ? <span className="text-zinc-700">{t.vendor_name}</span>
                    : <span className="italic text-zinc-400">Unassigned</span>}
                </td>
                <td className="px-3 py-3 align-top">
                  <span
                    title={t.submitted_by ?? undefined}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-midnight/10 text-[11px] font-semibold text-midnight"
                  >
                    {initials(t.submitted_by)}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <Pill tone={priorityPillTone(t.priority)}>{t.priority}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="border-t border-zinc-100 py-12 text-center text-sm text-zinc-500">
            No work orders match this view.
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-zinc-400">
        Showing {rows.length} of {tickets.length}
      </div>
    </div>
  );
}
