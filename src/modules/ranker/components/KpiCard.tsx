// Ranker — KPI tile rendered in the Store View scorecard grid. Each
// tile shows: label, current value, delta vs prior week, and a small
// sparkline over the trend window. An optional info button explains what
// the metric means in plain language.

import { useState } from "react";
import { Info } from "lucide-react";
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
  /** Plain-language explanation of the metric — shows a "?" info popover. */
  info?: string;
}

export function KpiCard({ label, value, delta, tone, series, info }: Props) {
  return (
    <Card className="flex h-full flex-col justify-between gap-2 p-4">
      <div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {label}
          </span>
          {info && <InfoDot label={label} text={info} />}
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

// Small "?" info button with a click-to-open popover — plain-language help for
// someone who's never seen the metric. Click the backdrop to close.
function InfoDot({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-accent"
        aria-label={`What does "${label}" mean?`}
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-hidden />
          <span
            className="absolute left-0 top-5 z-50 block w-60 cursor-default rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-midnight">{label}</span>
            <span className="block text-xs font-normal leading-relaxed text-zinc-600">{text}</span>
          </span>
        </>
      )}
    </span>
  );
}
