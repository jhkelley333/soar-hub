// Schedule — SOAR-native calendar (v1a): Month + Agenda views, type filters,
// create/edit events. Events are server-scoped to the stores the caller can
// see. Read-only module feeds + Google come in later phases.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock, Plus, Repeat, SlidersHorizontal } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Drawer } from "@/shared/ui/Drawer";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";
import { fetchEvents, fetchScheduleStores } from "./api";
import { EventModal } from "./EventModal";
import { OrgTreeFilter } from "./OrgTreeFilter";
import { TimeGrid } from "./TimeGrid";
import { eventColor, type ColorBy } from "./colors";
import { EVENT_TYPE_ORDER, TYPE_META, type EventType, type ScheduleEvent } from "./types";

// ── date helpers ─────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
// First Sunday on/before the 1st of the anchor month.
function startOfGrid(anchor: Date): Date {
  const first = startOfMonth(anchor);
  const g = new Date(first);
  g.setDate(first.getDate() - first.getDay());
  return g;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
type View = "month" | "week" | "day" | "agenda";

// Configurable Week/Day time window, persisted per browser so stores with
// late closes (e.g. 3 AM) can widen it once and have it stick.
const HOURS_KEY = "soar.schedule.dayHours";
type DayHours = { start: number; end: number };
function loadDayHours(): DayHours {
  try {
    const v = JSON.parse(localStorage.getItem(HOURS_KEY) || "");
    if (typeof v?.start === "number" && typeof v?.end === "number" && v.end > v.start) {
      return { start: v.start, end: v.end };
    }
  } catch { /* fall through to default */ }
  return { start: 6, end: 20 };
}
function fmtHour(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const hr = x % 12 === 0 ? 12 : x % 12;
  return `${hr}${x < 12 ? "a" : "p"}`;
}

export function SchedulePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<View>("month");
  const [hidden, setHidden] = useState<Set<EventType>>(new Set());
  const [colorBy, setColorBy] = useState<ColorBy>("type");
  const [dayHours, setDayHours] = useState<DayHours>(loadDayHours);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function updateHours(next: DayHours) {
    setDayHours(next);
    try { localStorage.setItem(HOURS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  const [peek, setPeek] = useState<string | null>(null); // day-key for the "+N more" peek
  const [modal, setModal] = useState<{ event: ScheduleEvent | null; date: string | null } | null>(null);
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Native events open the editor; feed events (training/PTO/…) are read-only
  // here, so they deep-link into their source module.
  function openEvent(e: ScheduleEvent) {
    if (e.editable === false && e.link) { navigate(e.link); return; }
    setModal({ event: e, date: null });
  }

  // Visible days depend on the view. Month + Agenda use the 6-week grid; Week
  // is the 7 days of the anchor's week; Day is a single day.
  const days = useMemo(() => {
    if (view === "day") return [startOfDay(anchor)];
    if (view === "week") {
      const s = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const g = startOfGrid(anchor);
    return Array.from({ length: 42 }, (_, i) => addDays(g, i));
  }, [anchor, view]);
  const rangeFrom = days[0].toISOString();
  const rangeTo = addDays(days[days.length - 1], 1).toISOString();
  const todayKey = ymd(new Date());

  // Navigation step depends on the view.
  function go(delta: number) {
    setAnchor((prev) =>
      view === "day" ? addDays(prev, delta) : view === "week" ? addDays(prev, delta * 7) : addMonths(prev, delta)
    );
  }

  const eventsQ = useQuery({
    queryKey: ["schedule-events", rangeFrom, rangeTo],
    queryFn: () => fetchEvents(rangeFrom, rangeTo),
  });
  const storesQ = useQuery({ queryKey: ["schedule-stores"], queryFn: fetchScheduleStores });

  const canWrite = eventsQ.data?.can_write ?? false;
  const events = eventsQ.data?.events ?? [];

  // Org-tree filter — a Set of active store numbers. null = all (default).
  const [activeStores, setActiveStores] = useState<Set<string> | null>(null);
  const tree = storesQ.data?.tree ?? [];
  const allStoreNumbers = useMemo(() => {
    const s = new Set<string>();
    for (const r of tree) for (const a of r.areas) for (const d of a.districts) for (const st of d.stores) s.add(st.number);
    return s;
  }, [tree]);
  const effectiveActive = activeStores ?? allStoreNumbers;

  const visible = useMemo(
    () =>
      events.filter(
        (e) => !hidden.has(e.type) && (!e.store_number || effectiveActive.has(e.store_number))
      ),
    [events, hidden, effectiveActive]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of visible) {
      const key = ymd(new Date(e.starts_at));
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    for (const list of m.values()) list.sort((a, b) => (a.all_day === b.all_day ? a.starts_at.localeCompare(b.starts_at) : a.all_day ? -1 : 1));
    return m;
  }, [visible]);

  function toggleType(t: EventType) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  const storeCount = allStoreNumbers.size;
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] ?? profile.role : "";
  const viewerName = profile?.full_name || profile?.email || "";

  const label =
    view === "day"
      ? anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      : view === "week"
        ? `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // True when the org filter is narrowing the view (some stores hidden).
  const filterActive = storeCount > 0 && effectiveActive.size < storeCount;

  // Scope card + org tree — shared by the lg rail and the mobile drawer.
  const railContent = (
    <>
      <div className="rounded-lg bg-midnight px-4 py-3 text-white">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Viewing as</div>
        <div className="mt-0.5 text-sm font-semibold leading-tight">
          {roleLabel}{viewerName ? ` · ${viewerName}` : ""}
        </div>
        <div className="mt-0.5 text-xs text-white/70">{storeCount} store{storeCount === 1 ? "" : "s"} in scope</div>
      </div>
      <div className="mt-4">
        <OrgTreeFilter
          tree={tree}
          active={effectiveActive}
          onChange={setActiveStores}
          you={storesQ.data?.you}
        />
      </div>
    </>
  );

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white lg:flex">
        {/* Left rail — scope card + org tree */}
        <aside className="hidden shrink-0 border-r border-zinc-200 bg-zinc-50/60 p-4 lg:block lg:w-[280px]">
          {railContent}
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1 p-4">

      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFiltersOpen(true)}
          className="relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 lg:hidden"
          aria-label="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {filterActive && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-white" />}
        </button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
        <button onClick={() => go(-1)} className="rounded-md p-1.5 text-zinc-500 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50" aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={() => go(1)} className="rounded-md p-1.5 text-zinc-500 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50" aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="text-lg font-semibold tracking-tight text-midnight">{label}</div>
        <div className="ml-auto inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
          {(["month", "week", "day", "agenda"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium capitalize transition first:rounded-l-md last:rounded-r-md",
                view === v ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50"
              )}
            >
              {v}
            </button>
          ))}
        </div>
        {(view === "week" || view === "day") && (
          <div className="relative">
            <button
              onClick={() => setHoursOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50"
              aria-label="Day hours"
            >
              <Clock className="h-4 w-4" />
              {fmtHour(dayHours.start)}–{fmtHour(dayHours.end)}
            </button>
            {hoursOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setHoursOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Day hours</div>
                  <div className="flex items-center gap-2">
                    <select
                      value={dayHours.start}
                      onChange={(e) => { const s = Number(e.target.value); updateHours({ start: s, end: Math.max(s + 1, dayHours.end) }); }}
                      className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                    <span className="text-xs text-zinc-400">to</span>
                    <select
                      value={dayHours.end}
                      onChange={(e) => { const en = Number(e.target.value); updateHours({ start: Math.min(dayHours.start, en - 1), end: en }); }}
                      className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={() => updateHours({ start: 6, end: 20 })}
                    className="mt-2 text-xs font-medium text-accent hover:underline"
                  >
                    Reset to 6a–8p
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {canWrite && (
          <Button size="sm" onClick={() => setModal({ event: null, date: todayKey })}>
            <Plus className="h-4 w-4" /> New event
          </Button>
        )}
      </div>

      {/* Type filter legend + color-by toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {EVENT_TYPE_ORDER.map((t) => {
          const off = hidden.has(t);
          const m = TYPE_META[t];
          const dim = off || colorBy === "org"; // org-mode: legend is reference only
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
                off ? "bg-white text-zinc-400 ring-zinc-200" : m.chip
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", dim && off ? "bg-zinc-300" : m.dot)} />
              {m.label}
            </button>
          );
        })}
        <div className="ml-auto inline-flex items-center gap-1 rounded-md bg-zinc-100 p-0.5 text-xs">
          <span className="px-1.5 text-[11px] font-medium text-zinc-400">Color</span>
          {(["type", "org"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setColorBy(c)}
              className={cn(
                "rounded px-2 py-1 font-medium capitalize transition",
                colorBy === c ? "bg-white text-midnight shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {c === "org" ? "Store" : "Type"}
            </button>
          ))}
        </div>
      </div>

      {eventsQ.isLoading ? (
        <Skeleton className="h-[560px] w-full" />
      ) : eventsQ.isError ? (
        <EmptyState title="Couldn't load the schedule" description={(eventsQ.error as Error)?.message ?? "Make sure migration 0139 has run."} />
      ) : view === "month" ? (
        <MonthGrid
          days={days}
          anchorMonth={anchor.getMonth()}
          byDate={byDate}
          todayKey={todayKey}
          canWrite={canWrite}
          colorBy={colorBy}
          onDay={(key) => canWrite && setModal({ event: null, date: key })}
          onEvent={openEvent}
          onMore={setPeek}
        />
      ) : view === "week" || view === "day" ? (
        <TimeGrid
          days={days}
          byDate={byDate}
          todayKey={todayKey}
          canWrite={canWrite}
          colorBy={colorBy}
          dayStart={dayHours.start}
          dayEnd={dayHours.end}
          onDay={(key) => canWrite && setModal({ event: null, date: key })}
          onEvent={openEvent}
        />
      ) : (
        <Agenda events={visible} colorBy={colorBy} onEvent={openEvent} />
      )}
        </div>
      </div>

      {/* Mobile / tablet filter drawer — same scope card + org tree as the rail */}
      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Calendar filters" width="w-full sm:max-w-sm">
        {railContent}
      </Drawer>

      {/* "+N more" day peek — the full event list for one day */}
      <Modal
        open={peek != null}
        onClose={() => setPeek(null)}
        title={peek ? new Date(`${peek}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""}
        maxWidth="max-w-sm"
        footer={
          canWrite && peek ? (
            <Button size="sm" onClick={() => { const d = peek; setPeek(null); setModal({ event: null, date: d }); }}>
              <Plus className="h-4 w-4" /> New event
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-1">
          {(peek ? byDate.get(peek) ?? [] : []).map((e) => (
            <EventBar key={e.id} e={e} colorBy={colorBy} onClick={() => { setPeek(null); openEvent(e); }} />
          ))}
        </div>
      </Modal>

      {modal && (
        <EventModal
          open
          onClose={() => setModal(null)}
          event={modal.event}
          defaultDate={modal.date}
          districts={storesQ.data?.districts ?? []}
          canOrgWide={storesQ.data?.can_org_wide ?? false}
        />
      )}
    </div>
  );
}

function EventBar({ e, colorBy, onClick }: { e: ScheduleEvent; colorBy: ColorBy; onClick: () => void }) {
  const c = eventColor(e, colorBy);
  const time = e.all_day ? "" : new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return (
    <button
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      className={cn("flex w-full items-center gap-1 truncate rounded border-l-[3px] bg-white px-1.5 py-0.5 text-left text-[11px] text-zinc-700 ring-1 ring-inset ring-zinc-100 hover:bg-zinc-50", c.bar)}
      title={e.title}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.dot)} />
      <span className="truncate">{time && <span className="text-zinc-400">{time} </span>}{e.title}</span>
      {e.recurrence && e.recurrence !== "none" && <Repeat className="ml-auto h-3 w-3 shrink-0 text-zinc-300" />}
      {e.source !== "soar" && <ArrowUpRight className={cn("h-3 w-3 shrink-0 text-zinc-300", !(e.recurrence && e.recurrence !== "none") && "ml-auto")} />}
    </button>
  );
}

function MonthGrid({
  days, anchorMonth, byDate, todayKey, canWrite, colorBy, onDay, onEvent, onMore,
}: {
  days: Date[];
  anchorMonth: number;
  byDate: Map<string, ScheduleEvent[]>;
  todayKey: string;
  canWrite: boolean;
  colorBy: ColorBy;
  onDay: (key: string) => void;
  onEvent: (e: ScheduleEvent) => void;
  onMore: (key: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === anchorMonth;
          const list = byDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              onClick={() => onDay(key)}
              className={cn(
                "min-h-[124px] border-b border-r border-zinc-100 p-1.5 align-top",
                i % 7 === 6 && "border-r-0",
                !inMonth && "bg-zinc-50/60",
                canWrite && "cursor-pointer hover:bg-accent/[0.03]"
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={cn(
                  "grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-semibold",
                  isToday ? "bg-accent text-white" : inMonth ? "text-midnight" : "text-zinc-300"
                )}>
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {list.slice(0, 3).map((e) => <EventBar key={e.id} e={e} colorBy={colorBy} onClick={() => onEvent(e)} />)}
                {list.length > 3 && (
                  <button
                    onClick={(ev) => { ev.stopPropagation(); onMore(key); }}
                    className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ events, colorBy, onEvent }: { events: ScheduleEvent[]; colorBy: ColorBy; onEvent: (e: ScheduleEvent) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
      const key = ymd(new Date(e.starts_at));
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    return Array.from(m.entries());
  }, [events]);

  if (groups.length === 0) {
    return <EmptyState title="Nothing on the calendar" description="No events in this month for your stores." />;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {groups.map(([key, list]) => (
        <div key={key} className="border-b border-zinc-100 last:border-b-0">
          <div className="bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500">
            {new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <ul className="divide-y divide-zinc-100">
            {list.map((e) => {
              const c = eventColor(e, colorBy);
              return (
                <li key={e.id}>
                  <button onClick={() => onEvent(e)} className={cn("flex w-full items-center gap-3 border-l-[3px] px-4 py-2.5 text-left hover:bg-zinc-50", c.bar)}>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
                    <span className="w-20 shrink-0 text-xs text-zinc-500">
                      {e.all_day ? "All day" : new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-midnight">{e.title}</span>
                    {e.store_number && <span className="shrink-0 text-xs text-zinc-400">#{e.store_number}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
