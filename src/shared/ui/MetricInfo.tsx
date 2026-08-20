// MetricInfo — a reusable "?" info button that explains a metric in plain
// language, reading from the metric-definitions registry (Phase 8A). Drop it
// next to any label: <MetricInfo term="daily_completion" />. Adding a new
// explanation is a row insert in /admin/definitions, not a code change.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchDefinitions, type MetricDefinition } from "@/modules/definitions/api";

// Shared, cached lookup — every MetricInfo on a page hits the same query.
function useDefinition(term: string): MetricDefinition | null {
  const q = useQuery({ queryKey: ["metric-definitions"], queryFn: fetchDefinitions, staleTime: 10 * 60_000 });
  return (q.data?.definitions ?? []).find((d) => d.key === term) ?? null;
}

export function MetricInfo({ term, className }: { term: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const def = useDefinition(term);
  if (!def) return null; // unknown term → render nothing (no broken icon)
  return (
    <span className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-accent dark:hover:bg-white/10"
        aria-label={`What does "${def.label}" mean?`}
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-hidden />
          <span
            className="absolute left-0 top-5 z-50 block w-64 cursor-default rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-night-line dark:bg-night-raised"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-midnight dark:text-night-ink">{def.label}</span>
            <span className="block text-xs font-normal leading-relaxed text-zinc-600 dark:text-night-muted">{def.definition}</span>
            {def.source && (
              <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Source · {def.source}</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}
