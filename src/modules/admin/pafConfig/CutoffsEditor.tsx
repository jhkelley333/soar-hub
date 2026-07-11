// PAF Config — payroll cutoff planner. Default rule: Wednesday 10:00 AM
// Central; PAFs submitted after the current week's cutoff move to next
// week's batch. Payroll/admin plan holiday-week overrides here in advance
// (each override is keyed by its pay week's Sunday). Changes are LIVE —
// unlike the other tabs there's no draft/save-version step.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { deleteCutoff, listCutoffs, setCutoff } from "@/modules/paf/api";

const FIELD =
  "rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

function fmtCt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " CT";
}
function fmtWeek(sunday: string): string {
  return new Date(`${sunday}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// The next N Sundays (pay weeks) starting from the given Sunday.
function nextSundays(fromSunday: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromSunday}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 7 * 86_400_000;
  }
  return out;
}

export function CutoffsEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["paf-cutoffs"], queryFn: listCutoffs });

  const [week, setWeek] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");

  const weeks = useMemo(
    () => (q.data ? nextSundays(q.data.this_week_sunday, 16) : []),
    [q.data],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["paf-cutoffs"] });
    qc.invalidateQueries({ queryKey: ["paf-cutoff-info"] });
  };
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const save = useMutation({
    mutationFn: () => setCutoff({ week_sunday: week, cutoff_date: date, cutoff_time: time, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.push("Cutoff override saved.", "success");
      setWeek(""); setDate(""); setTime("10:00"); setNote("");
      invalidate();
    },
    onError: err,
  });
  const remove = useMutation({
    mutationFn: deleteCutoff,
    onSuccess: () => { toast.push("Override removed — that week falls back to Wednesday 10:00 AM CT.", "success"); invalidate(); },
    onError: err,
  });

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <CalendarClock className="h-4 w-4 text-accent" /> Payroll cutoff
        </div>
        <p className="mt-1 max-w-2xl text-xs text-zinc-500">
          Default: <strong>Wednesday 10:00 AM Central</strong>. A PAF submitted after the current
          week's cutoff is flagged <strong>Late</strong> and moves to the next week's payroll batch.
          Plan holiday weeks below — each override applies to one pay week and takes effect
          immediately (no version save needed).
        </p>

        <div className="mt-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Upcoming overrides
          </div>
          {q.isLoading ? (
            <p className="py-4 text-sm text-zinc-400">Loading…</p>
          ) : (q.data?.overrides.length ?? 0) === 0 ? (
            <p className="rounded-md bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
              None planned — every week uses the Wednesday 10:00 AM CT default.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
              {q.data!.overrides.map((o) => (
                <li key={o.week_sunday} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900">
                      Week of {fmtWeek(o.week_sunday)}
                      {o.note && <span className="ml-2 font-normal text-zinc-500">· {o.note}</span>}
                    </div>
                    <div className="text-xs text-zinc-500">Cutoff: {fmtCt(o.cutoff_at)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove.mutate(o.week_sunday)}
                    className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Remove — falls back to the default"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Plan a holiday-week override
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-zinc-600">
              Pay week (its Sunday)
              <select value={week} onChange={(e) => setWeek(e.target.value)} className={`${FIELD} mt-1 w-full`}>
                <option value="">Select week…</option>
                {weeks.map((w) => (
                  <option key={w} value={w}>Week of {fmtWeek(w)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Cutoff date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} mt-1 w-full`} />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Cutoff time (Central)
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${FIELD} mt-1 w-full`} />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thanksgiving week" className={`${FIELD} mt-1 w-full`} />
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2"
            disabled={!week || !date || !time || save.isPending}
            onClick={() => save.mutate()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save override"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
