// GM explanation box for a labor miss. Shows the submitted note (with an
// Edit affordance) when one exists, or an entry textarea when a note is
// due. Saving posts to labor?action=review and refreshes the GM query.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { saveLaborReview } from "./api";
import type { LaborDay } from "./types";

// Fixed root-cause options for a labor miss — pick one, then explain.
const ROOT_CAUSES: { key: string; label: string }[] = [
  { key: "poor_projections", label: "Poor Projections" },
  { key: "scheduled_above_chart", label: "Scheduled Above Chart" },
  { key: "didnt_follow_schedule", label: "Didn't Follow the Schedule" },
  { key: "auto_clock", label: "Auto Clock" },
  { key: "other", label: "Other" },
];
const ROOT_CAUSE_LABEL: Record<string, string> = Object.fromEntries(ROOT_CAUSES.map((r) => [r.key, r.label]));

export function ReviewBox({
  storeNumber,
  day,
}: {
  storeNumber: string;
  day: LaborDay;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const existing = day.review?.note ?? "";
  const existingCause = day.review?.root_cause ?? "";
  const [editing, setEditing] = useState(!day.explained);
  const [note, setNote] = useState(existing);
  const [rootCause, setRootCause] = useState(existingCause);

  // Keep local state in sync when the selected day changes.
  useEffect(() => {
    setNote(existing);
    setRootCause(existingCause);
    setEditing(!day.explained);
  }, [day.business_date, day.explained, existing, existingCause]);

  const save = useMutation({
    mutationFn: () =>
      saveLaborReview({
        store_number: storeNumber, business_date: day.business_date, note: note.trim(),
        root_cause: rootCause || undefined,
      }),
    onSuccess: () => {
      toast.push("Explanation submitted.", "success");
      qc.invalidateQueries({ queryKey: ["labor-gm"] });
      setEditing(false);
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Could not save note.", "error"),
  });

  // Already explained, not editing → confirmation card.
  if (day.explained && !editing) {
    return (
      <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-ok/10 text-ok">
            <Check className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-midnight">Explanation submitted</h3>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Logged for {day.business_date}
              {day.review?.by ? ` · visible to your DO` : ""}
            </p>
            {day.review?.root_cause && (
              <span className="mt-3 inline-block rounded-full bg-sonic/10 px-2.5 py-1 text-xs font-bold text-sonic">
                {ROOT_CAUSE_LABEL[day.review.root_cause] ?? day.review.root_cause}
              </span>
            )}
            <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-midnight">{day.review?.note}</p>
          </div>
        </div>
      </div>
    );
  }

  // Entry / edit state.
  const dueLane = day.note_due;
  return (
    <div
      className={cn(
        "rounded-xl bg-white p-5 ring-1",
        dueLane ? "ring-warn/40" : "ring-zinc-200"
      )}
    >
      <h3 className="text-sm font-semibold text-midnight">
        {day.explained ? "Edit explanation" : "Explain this miss"}
      </h3>
      <p className="text-xs text-zinc-500">
        {dueLane
          ? `Labor ran over chart on this day${day.hours_over_chart != null && day.hours_over_chart > 0 ? ` by about ${day.hours_over_chart} hours` : ""} — pick the root cause, then explain.`
          : "Add a note for this day (optional)."}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ROOT_CAUSES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRootCause(rootCause === r.key ? "" : r.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              rootCause === r.key
                ? "bg-midnight text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="What drove the variance? (e.g. lunch rush hit 30% above forecast — held an extra crew member through 1:30.)"
        className="mt-3 w-full rounded-lg border border-zinc-200 p-3 text-sm text-midnight placeholder:text-zinc-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        {day.explained && (
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setNote(existing); }}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          disabled={!note.trim() || (dueLane && !rootCause) || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Submit explanation"}
        </Button>
      </div>
    </div>
  );
}
