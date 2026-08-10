// Corporate training-class labor credit tab (SDO and above). Upload a CSV of
// class attendees (by store), pick the fiscal week + days the class ran, adjust
// the per-day dollar credit (default $176), and apply. The credit lands on the
// Labor v2 chart like the other labor credits, for the selected days.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload, Check } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  parseCorpTrainingCsv, applyCorpTraining, fetchCorpTraining, deleteCorpTraining, setCorpTrainingRate,
  type CorpTrainingParseResult, type CorpTrainingBatch,
} from "./api";

const fmtUSD = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const inputCls = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";

// Monday of the week containing `d` (local), as an ISO date.
function mondayOf(d: Date): string {
  const x = new Date(d);
  const off = (x.getDay() + 6) % 7; // 0 = Mon
  x.setDate(x.getDate() - off);
  return x.toLocaleDateString("en-CA");
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}
const fmtWeekLabel = (mondayIso: string) =>
  `${fmtDate(mondayIso).replace(/, \d{4}$/, "")} – ${fmtDate(addDaysIso(mondayIso, 6))}`;

export function CorporateTrainingCreditPanel() {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canSetRate = ["vp", "coo", "admin"].includes(profile?.role ?? "");

  const q = useQuery({ queryKey: ["corp-training"], queryFn: fetchCorpTraining });
  const defaultDaily = q.data?.default_daily ?? 176;

  // Recent weeks: 6 back through 2 ahead of the current week's Monday.
  const weeks = useMemo(() => {
    const cur = mondayOf(new Date());
    return Array.from({ length: 9 }, (_, i) => addDaysIso(cur, (2 - i) * 7));
  }, []);

  const [parsed, setParsed] = useState<CorpTrainingParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [label, setLabel] = useState("");
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()));
  const [dayOn, setDayOn] = useState<boolean[]>(Array(7).fill(false));
  const [daily, setDaily] = useState<string>("");
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  const dailyAmount = Number(daily) > 0 ? Number(daily) : defaultDaily;
  const selectedDates = useMemo(
    () => dayOn.map((on, i) => (on ? addDaysIso(weekStart, i) : null)).filter((d): d is string => !!d),
    [dayOn, weekStart],
  );
  const inScopeStores = parsed?.stores.filter((s) => s.in_scope) ?? [];

  const parseMut = useMutation({
    mutationFn: (csv: string) => parseCorpTrainingCsv(csv),
    onSuccess: (r) => { setParsed(r); if (!daily) setDaily(String(r.default_daily)); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't read the file.", "error"),
  });

  const applyMut = useMutation({
    mutationFn: () => applyCorpTraining({
      label: label.trim() || null,
      daily_amount: dailyAmount,
      dates: selectedDates,
      stores: inScopeStores.map((s) => ({ store_number: s.store_number, count: s.count })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corp-training"] });
      toast.push("Training credit applied.", "success");
      setParsed(null); setFileName(""); setLabel(""); setDayOn(Array(7).fill(false)); setDaily("");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't apply the credit.", "error"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteCorpTraining(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["corp-training"] }); toast.push("Removed.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't remove.", "error"),
  });

  const rateMut = useMutation({
    mutationFn: (amount: number) => setCorpTrainingRate(amount),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["corp-training"] }); setRateDraft(null); toast.push("Default rate updated.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update the rate.", "error"),
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    if (!label) setLabel(file.name.replace(/\.[^.]+$/, ""));
    const text = await file.text();
    parseMut.mutate(text);
  };

  const canApply = inScopeStores.length > 0 && selectedDates.length > 0 && dailyAmount > 0 && !applyMut.isPending;
  const totalCredit = inScopeStores.reduce((a, s) => a + s.count, 0) * selectedDates.length * dailyAmount;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-midnight">Add a corporate training class</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Upload a CSV of attendees (needs a store-number column), then pick the week + days the class ran.
              Each store is credited {fmtUSD(defaultDaily)}/day per attendee.
            </p>
          </div>
          {canSetRate && (
            rateDraft === null ? (
              <button className="text-[11px] text-zinc-400 underline-offset-2 hover:text-accent hover:underline"
                onClick={() => setRateDraft(String(defaultDaily))}>
                Default: {fmtUSD(defaultDaily)}/day · edit
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-400">Default $/day</span>
                <input className={cn(inputCls, "w-24 py-1 text-xs")} type="number" step="0.01" value={rateDraft}
                  onChange={(e) => setRateDraft(e.target.value)} autoFocus />
                <Button size="sm" onClick={() => Number(rateDraft) > 0 && rateMut.mutate(Number(rateDraft))} disabled={rateMut.isPending}>Save</Button>
                <button className="text-xs text-zinc-400 hover:text-zinc-600" onClick={() => setRateDraft(null)}>Cancel</button>
              </div>
            )
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 hover:border-accent hover:text-accent">
            <Upload className="h-4 w-4" />
            {fileName || "Choose CSV…"}
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
          {parseMut.isPending && <span className="text-xs text-zinc-400">Reading…</span>}
          {parsed && (
            <span className="text-xs text-zinc-500">
              {parsed.stores.length} stores · {parsed.total_attendees} attendees
              {parsed.unknown.length > 0 && (
                <span className="ml-2 text-amber-600">{parsed.unknown.length} out of scope (skipped)</span>
              )}
            </span>
          )}
        </div>

        {parsed && inScopeStores.length > 0 && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                <span className="mb-1 block font-medium text-zinc-600">Class name (optional)</span>
                <input className={cn(inputCls, "w-full")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. New GM Certification" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block font-medium text-zinc-600">Credit $/day per attendee</span>
                <input className={cn(inputCls, "w-full")} type="number" step="0.01" value={daily}
                  onChange={(e) => setDaily(e.target.value)} placeholder={String(defaultDaily)} />
              </label>
              <label className="text-xs">
                <span className="mb-1 block font-medium text-zinc-600">Week</span>
                <select className={cn(inputCls, "w-full")} value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                  {weeks.map((w) => <option key={w} value={w}>{fmtWeekLabel(w)}</option>)}
                </select>
              </label>
              <div className="text-xs">
                <span className="mb-1 block font-medium text-zinc-600">Days</span>
                <div className="flex flex-wrap gap-1">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button"
                      onClick={() => setDayOn((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                      className={cn("rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                        dayOn[i] ? "border-accent-200 bg-accent-50 text-accent-700" : "border-zinc-200 bg-white text-zinc-500")}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
              <p className="text-xs text-zinc-500">
                {inScopeStores.length} stores · {inScopeStores.reduce((a, s) => a + s.count, 0)} attendees ×{" "}
                {selectedDates.length} day{selectedDates.length === 1 ? "" : "s"} × {fmtUSD(dailyAmount)} ={" "}
                <b className="text-midnight">{fmtUSD(totalCredit)}</b> total credit
              </p>
              <Button onClick={() => applyMut.mutate()} disabled={!canApply}>
                <Check className="mr-1 h-4 w-4" /> Apply credit
              </Button>
            </div>
          </>
        )}
        {parsed && inScopeStores.length === 0 && (
          <p className="mt-3 text-xs text-amber-600">None of the stores in this file are in your scope.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Applied training credits</h3>
        {q.isLoading && <Skeleton className="h-24 w-full" />}
        {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}
        {q.data && q.data.rows.length === 0 && (
          <EmptyState title="No training credits yet" description="Upload a class roster above to add one." />
        )}
        {q.data && q.data.rows.length > 0 && (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 text-right font-medium">Stores</th>
                  <th className="px-3 py-2 text-right font-medium">Attendees</th>
                  <th className="px-3 py-2 text-right font-medium">$/day</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {q.data.rows.map((b: CorpTrainingBatch) => (
                  <tr key={b.id} className="text-zinc-700">
                    <td className="px-3 py-2">{b.label || <span className="text-zinc-400">—</span>}</td>
                    <td className="px-3 py-2 text-xs">
                      {b.dates.length === 1 ? fmtDate(b.start) : `${fmtDate(b.start)} → ${fmtDate(b.end)}`}
                      <span className="ml-1 text-zinc-400">({b.dates.length}d)</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.store_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.attendees}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(b.daily_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-midnight">
                      {fmtUSD(b.attendees * b.dates.length * b.daily_amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button className="text-zinc-300 hover:text-red-500" title="Remove"
                        onClick={() => delMut.mutate(b.id)} disabled={delMut.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
