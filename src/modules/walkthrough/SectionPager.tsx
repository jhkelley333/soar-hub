// Walkthrough — sticky section pager.
//
// Sits beneath the header. Shows the active section name, its item progress,
// and an N-segment dash bar so the GM sees done / active / pending at a
// glance without leaving the page. Segments are tappable to jump sections.
// A section with unsatisfied required follow-ups reads with a warn tint even
// when "done", so owed work is visible from the top.

import { cn } from "@/lib/cn";
import type { SectionStatus } from "./use-walkthrough-store";

export interface SectionPagerProps {
  sections: SectionStatus[];
  activeIndex: number;
  onJump?: (index: number) => void;
}

type SegState = "done" | "active" | "owed" | "pending";

function segState(s: SectionStatus, active: boolean): SegState {
  if (active) return "active";
  if (s.incomplete) return "owed";
  if (s.total > 0 && s.answered >= s.total && !s.hasUnanswered) return "done";
  return "pending";
}

const SEG_CLASS: Record<SegState, string> = {
  done: "bg-midnight-900",
  active: "bg-accent-500",
  owed: "bg-warn",
  pending: "bg-midnight-100",
};

export function SectionPager({ sections, activeIndex, onJump }: SectionPagerProps) {
  const active = sections[activeIndex];
  if (!active) return null;

  return (
    <div className="sticky top-12 z-10 bg-white border-b border-midnight-100 px-4 pt-3 pb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide uppercase text-midnight-500">
            Section {activeIndex + 1} of {sections.length}
          </div>
          <div className="text-[17px] font-semibold text-midnight-900 leading-tight truncate">
            {active.name}
          </div>
        </div>
        <div className="text-right shrink-0 pl-3">
          <div className="text-[11px] text-midnight-500 tabular-nums">
            {active.answered}/{active.total} items
          </div>
          <div className="text-[13px] font-semibold tabular-nums text-midnight-900">
            {active.pct}%
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {sections.map((s, i) => {
          const state = segState(s, i === activeIndex);
          return (
            <button
              key={s.code}
              type="button"
              onClick={() => onJump?.(i)}
              className="flex-1 py-1.5 -my-1.5"
              aria-label={`Go to ${s.name}`}
              aria-current={i === activeIndex ? "step" : undefined}
            >
              <span className={cn("block h-1.5 w-full rounded-full", SEG_CLASS[state])} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
