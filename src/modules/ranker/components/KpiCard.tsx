// Ranker — KPI tile rendered in the Store View scorecard grid. Each
// tile shows: label, current value, delta vs prior week, and a small
// sparkline over the trend window.

import { Card } from "@/shared/ui/Card";
import { Sparkline } from "./Sparkline";
import type { Tone } from "../types";
import { toneTextClass } from "../format";

interface Props {
  label: string;
  value: string;
  delta: string;
  tone: Tone;
  series?: (number | null)[];
}

export function KpiCard({ label, value, delta, tone, series }: Props) {
  return (
    <Card className="flex h-full flex-col justify-between gap-2 p-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold tracking-tight text-midnight">
          {value}
        </div>
        <div className={`mt-0.5 text-xs ${toneTextClass(tone)}`}>{delta}</div>
      </div>
      {series && series.length > 1 && (
        <Sparkline values={series} tone={tone} />
      )}
    </Card>
  );
}
