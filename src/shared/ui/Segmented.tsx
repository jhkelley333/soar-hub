// Segmented control — used for tier filters ("All / Red / Yellow / Green")
// and scope toggles ("District / Region / Above-store") across the mobile
// screens. Active option gets a white pill on top of the muted bg track.
//
// Each option can carry an optional count + colored dot, so the filter
// reads "Red 5" with a red dot inline. Dense mode tightens padding for
// places where the segmented sits inside a card or a dark hero tile.

import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Tailwind class for an inline dot. Use the .tier-{green,yellow,red}
   *  utilities, or any bg-* class. */
  dot?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  dense = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg bg-midnight-50 p-0.5 ring-1 ring-midnight-100",
        dense && "gap-0",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition",
              active
                ? "bg-white text-midnight-900 shadow-card"
                : "text-midnight-500 hover:text-midnight-800",
            )}
          >
            {o.dot && <span className={cn("dot", o.dot)} />}
            <span>{o.label}</span>
            {o.count != null && (
              <span
                className={cn(
                  "text-[10.5px] tabular-nums",
                  active ? "text-midnight-500" : "text-midnight-400",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
