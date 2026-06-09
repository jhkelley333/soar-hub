// Time-grid Week/Day view. Single source of truth for the calendar geometry
// (ROW_H / DAY_START / DAY_END / gutter) per the design handoff; positions are
// derived from time, never stored. Includes Google-style overlap column-
// packing and a now-line. All-day events sit in a strip above the grid.

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { TYPE_META, type ScheduleEvent } from "./types";

// ── geometry (the load-bearing numbers) ──────────────────────────────────
const ROW_H = 48;        // px per hour
const DAY_START = 6;     // 6 AM
const DAY_END = 20;      // 8 PM
const HOURS = DAY_END - DAY_START;
const GUTTER = 56;       // hour-label column width
const CHIP_MIN = 22;     // min event height
const GRID_H = HOURS * ROW_H;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hourLabel(h24: number): string {
  const ampm = h24 < 12 || h24 === 24 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h} ${ampm}`;
}

// Fractional hours-from-DAY_START for a timed event, clamped to the window.
function span(e: ScheduleEvent): { start: number; end: number } | null {
  const s = new Date(e.starts_at);
  const startH = s.getHours() + s.getMinutes() / 60 - DAY_START;
  let endH: number;
  if (e.ends_at) {
    const en = new Date(e.ends_at);
    endH = en.getHours() + en.getMinutes() / 60 - DAY_START;
    if (en.toDateString() !== s.toDateString()) endH = HOURS; // runs past today
    if (endH <= startH) endH = startH + 0.5;
  } else {
    endH = startH + 1;
  }
  const start = Math.max(0, startH);
  const end = Math.min(HOURS, endH);
  if (end <= 0 || start >= HOURS || end <= start) return null;
  return { start, end };
}

type Placed = { e: ScheduleEvent; start: number; end: number; col: number; total: number };

// Greedy column packing within clusters of continuously-overlapping events.
function packDay(events: ScheduleEvent[]): Placed[] {
  const items = events
    .map((e) => ({ e, ...(span(e) ?? { start: -1, end: -1 }) }))
    .filter((x) => x.start >= 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: Placed[] = [];
  let cluster: { e: ScheduleEvent; start: number; end: number; col: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.start + 1e-6);
      if (c === -1) { colEnds.push(it.end); c = colEnds.length - 1; }
      else colEnds[c] = it.end;
      it.col = c;
    }
    const total = colEnds.length;
    for (const it of cluster) out.push({ ...it, total });
    cluster = [];
  };

  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd - 1e-6) { flush(); clusterEnd = -Infinity; }
    cluster.push({ ...it, col: 0 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

function TimedEvent({ p, onClick }: { p: Placed; onClick: () => void }) {
  const m = TYPE_META[p.e.type];
  const top = p.start * ROW_H;
  const height = Math.max(CHIP_MIN, (p.end - p.start) * ROW_H);
  const widthPct = 100 / p.total;
  const time = new Date(p.e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return (
    <button
      onClick={(ev) => { ev.stopPropagation(); onClick(); }}
      style={{ top, height, left: `${p.col * widthPct}%`, width: `calc(${widthPct}% - 2px)` }}
      className={cn(
        "absolute overflow-hidden rounded border-l-[3px] bg-white px-1.5 py-0.5 text-left text-[11px] leading-tight text-zinc-700 ring-1 ring-inset ring-zinc-100 hover:z-10 hover:bg-zinc-50",
        m.bar
      )}
      title={p.e.title}
    >
      <div className="flex items-center gap-1 truncate">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.dot)} />
        <span className="truncate font-medium">{p.e.title}</span>
      </div>
      {height > 30 && <div className="truncate text-[10px] text-zinc-400">{time}</div>}
    </button>
  );
}

export function TimeGrid({
  days,
  byDate,
  todayKey,
  onEvent,
  onDay,
  canWrite,
}: {
  days: Date[];
  byDate: Map<string, ScheduleEvent[]>;
  todayKey: string;
  onEvent: (e: ScheduleEvent) => void;
  onDay: (key: string) => void;
  canWrite: boolean;
}) {
  const now = new Date();
  const nowOffset = now.getHours() + now.getMinutes() / 60 - DAY_START;

  const perDay = useMemo(
    () =>
      days.map((d) => {
        const list = byDate.get(ymd(d)) ?? [];
        return {
          allDay: list.filter((e) => e.all_day),
          packed: packDay(list.filter((e) => !e.all_day)),
        };
      }),
    [days, byDate]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {/* header */}
      <div className="flex border-b border-zinc-200">
        <div style={{ width: GUTTER }} className="shrink-0" />
        {days.map((d) => {
          const isToday = ymd(d) === todayKey;
          return (
            <div key={ymd(d)} className="flex-1 border-l border-zinc-100 py-2 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{WD[d.getDay()]}</div>
              <div className={cn(
                "mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold",
                isToday ? "bg-accent text-white" : "text-midnight"
              )}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* all-day strip */}
      <div className="flex border-b border-zinc-200 bg-zinc-50/50">
        <div style={{ width: GUTTER }} className="shrink-0 py-1.5 pr-2 text-right text-[9px] font-semibold uppercase tracking-wider text-zinc-400">All day</div>
        {days.map((d, i) => (
          <div key={ymd(d)} className="min-h-[28px] flex-1 space-y-0.5 border-l border-zinc-100 p-1">
            {perDay[i].allDay.map((e) => {
              const m = TYPE_META[e.type];
              return (
                <button
                  key={e.id}
                  onClick={() => onEvent(e)}
                  className={cn("flex w-full items-center gap-1 truncate rounded border-l-[3px] bg-white px-1.5 py-0.5 text-left text-[11px] text-zinc-700 ring-1 ring-inset ring-zinc-100 hover:bg-zinc-50", m.bar)}
                  title={e.title}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.dot)} />
                  <span className="truncate">{e.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* time body */}
      <div className="relative flex" style={{ height: GRID_H }}>
        {/* hour-label gutter */}
        <div style={{ width: GUTTER }} className="relative shrink-0">
          {Array.from({ length: HOURS + 1 }).map((_, h) => (
            <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-zinc-400" style={{ top: h * ROW_H }}>
              {h < HOURS + 1 ? hourLabel(DAY_START + h) : ""}
            </div>
          ))}
        </div>

        {/* day columns */}
        {days.map((d, i) => {
          const key = ymd(d);
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              onClick={() => canWrite && onDay(key)}
              className={cn("relative flex-1 border-l border-zinc-100", canWrite && "cursor-pointer")}
            >
              {/* hour gridlines */}
              {Array.from({ length: HOURS + 1 }).map((_, h) => (
                <div key={h} className="absolute inset-x-0 border-t border-zinc-100" style={{ top: h * ROW_H }} />
              ))}
              {/* now-line */}
              {isToday && nowOffset >= 0 && nowOffset <= HOURS && (
                <div className="absolute inset-x-0 z-20" style={{ top: nowOffset * ROW_H }}>
                  <div className="h-px bg-cherry" />
                  <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-cherry" />
                </div>
              )}
              {/* events */}
              {perDay[i].packed.map((p) => (
                <TimedEvent key={p.e.id} p={p} onClick={() => onEvent(p.e)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
