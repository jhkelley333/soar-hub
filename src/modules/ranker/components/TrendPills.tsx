// Ranker — 4W / 8W / 12W toggle for the Store View KPI sparklines.

import { cn } from "@/lib/cn";

interface Props {
  active: number;
  onChange: (weeks: number) => void;
}

const OPTIONS = [4, 8, 12];

export function TrendPills({ active, onChange }: Props) {
  return (
    <div className="flex gap-1.5">
      {OPTIONS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium tracking-tight transition",
            w === active
              ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/30"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-midnight",
          )}
        >
          {w}W
        </button>
      ))}
    </div>
  );
}
