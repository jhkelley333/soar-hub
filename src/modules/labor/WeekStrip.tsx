// The 7-day Mon–Sun labor-% strip across the top of the GM view. Each day
// shows weekday, date, labor %, and an on/over/note-due indicator. The
// selected day gets an accent ring; clicking a day re-anchors the view.

import { cn } from "@/lib/cn";
import type { WeekStripDay } from "./types";
import { fmtPct, weekdayShort, dayOfMonth } from "./format";

export function WeekStrip({
  week,
  selected,
  onSelect,
}: {
  week: WeekStripDay[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          This week · Labor %
        </span>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <Legend dot="bg-ok" label="on chart" />
          <Legend dot="bg-sonic" label="over" />
          <Legend dot="bg-warn" label="note due" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {week.map((d) => {
          const isSel = d.business_date === selected;
          const over = d.status === "over";
          const missing = d.status === "missing" || d.labor_pct == null;
          return (
            <button
              key={d.business_date}
              onClick={() => onSelect(d.business_date)}
              className={cn(
                "rounded-lg border bg-white p-2 text-left transition",
                isSel ? "border-accent ring-2 ring-accent/30" : "border-zinc-200 hover:border-zinc-300"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-midnight">{weekdayShort(d.business_date)}</span>
                {d.note_due ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" title="note due" />
                ) : !missing ? (
                  <span className={cn("h-1.5 w-1.5 rounded-full", over ? "bg-sonic" : "bg-ok")} />
                ) : null}
              </div>
              <div className="text-[11px] text-zinc-400">{dayOfMonth(d.business_date)}</div>
              <div
                className={cn(
                  "mt-1 text-base font-bold tabular-nums",
                  missing ? "text-zinc-300" : over ? "text-sonic" : "text-ok"
                )}
              >
                {missing ? "–" : fmtPct(d.labor_pct)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}
