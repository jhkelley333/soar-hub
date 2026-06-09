// Linked (external) calendars panel for the Schedule rail. Add a calendar by
// its iCal URL (Google "secret iCal address", Apple, Outlook…); SOAR overlays
// it read-only. Toggle visibility, recolor, or remove. All per-user.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Link2, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/shared/ui/Toaster";
import { fetchCalendars, linkCalendar, unlinkCalendar, updateCalendar } from "./api";
import { CAL_COLOR_OPTIONS, type CalColor } from "./types";

export function LinkedCalendars() {
  const qc = useQueryClient();
  const toast = useToast();
  const calsQ = useQuery({ queryKey: ["schedule-calendars"], queryFn: fetchCalendars });
  const cals = calsQ.data?.calendars ?? [];

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<CalColor>("blue");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["schedule-calendars"] });
    qc.invalidateQueries({ queryKey: ["schedule-events"] });
  }

  const addMut = useMutation({
    mutationFn: () => linkCalendar({ label: label.trim(), url: url.trim(), color }),
    onSuccess: () => {
      toast.push("Calendar linked.", "success");
      setAdding(false); setLabel(""); setUrl(""); setColor("blue");
      refresh();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't link.", "error"),
  });
  const toggleMut = useMutation({
    mutationFn: (v: { id: string; is_enabled: boolean }) => updateCalendar(v),
    onSuccess: refresh,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Update failed.", "error"),
  });
  const colorMut = useMutation({
    mutationFn: (v: { id: string; color: CalColor }) => updateCalendar(v),
    onSuccess: refresh,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => unlinkCalendar(id),
    onSuccess: () => { toast.push("Calendar removed.", "success"); refresh(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Remove failed.", "error"),
  });

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Linked calendars</span>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">
          <Plus className="h-3 w-3" /> Link
        </button>
      </div>

      {calsQ.isLoading ? (
        <div className="px-1 py-1 text-xs text-zinc-400">Loading…</div>
      ) : cals.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-200 px-2 py-1.5 text-left text-xs text-zinc-500 hover:border-accent hover:text-zinc-700"
        >
          <Link2 className="h-3.5 w-3.5" /> Add a Google / Apple / Outlook calendar
        </button>
      ) : (
        <ul className="space-y-0.5">
          {cals.map((c) => {
            const dot = CAL_COLOR_OPTIONS.find((o) => o.value === c.color)?.dot ?? "bg-blue-500";
            return (
              <li key={c.id} className={cn("group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-zinc-100", !c.is_enabled && "opacity-50")}>
                <select
                  value={c.color}
                  onChange={(e) => colorMut.mutate({ id: c.id, color: e.target.value as CalColor })}
                  className="h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
                  title="Color"
                  style={{ backgroundImage: "none" }}
                >
                  {CAL_COLOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                </select>
                <span className={cn("h-3 w-3 shrink-0 rounded-full", dot)} />
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={c.url}>{c.label}</span>
                {c.last_error && (
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={`Sync error: ${c.last_error}`} />
                )}
                <button
                  onClick={() => toggleMut.mutate({ id: c.id, is_enabled: !c.is_enabled })}
                  className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700"
                  title={c.is_enabled ? "Hide" : "Show"}
                >
                  {c.is_enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => { if (window.confirm(`Remove "${c.label}"?`)) delMut.mutate(c.id); }}
                  className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div className="mt-2 space-y-2 rounded-md border border-zinc-200 bg-white p-2.5">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. My Google calendar)"
            className="block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="iCal URL (https:// … .ics)"
            className="block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-1.5">
            {CAL_COLOR_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setColor(o.value)}
                className={cn("h-5 w-5 rounded-full ring-offset-1", o.dot, color === o.value ? "ring-2 ring-zinc-700" : "ring-0")}
                title={o.value}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={() => {
                if (!label.trim()) { toast.push("Name the calendar.", "error"); return; }
                if (!/^(https?:\/\/|webcal:\/\/)/i.test(url.trim())) { toast.push("Enter a valid iCal URL.", "error"); return; }
                addMut.mutate();
              }}
              disabled={addMut.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {addMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Link calendar
            </button>
            <button onClick={() => setAdding(false)} className="text-xs font-medium text-zinc-500 hover:text-zinc-700">Cancel</button>
          </div>
          <p className="text-[10px] leading-snug text-zinc-400">
            In Google Calendar: Settings → your calendar → “Secret address in iCal format”. Paste that URL here.
          </p>
        </div>
      )}
    </div>
  );
}
