// GM labor view (feed-powered) — "Yesterday's labor", same layout as the
// original /labor tab but sourced from the KPI feed (labor_v2_daily) instead
// of the Google Sheet. Week strip, a miss banner when the day is over chart
// and unexplained, the three Daily/WTD/PTD band cards, the goal footer, and
// the explanation box. Notes use the shared labor_reviews schema.
//
// Multi-store roles (DO+) get a store picker; a single-store GM skips it.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { BandCard } from "@/modules/labor/BandCard";
import { WeekStrip } from "@/modules/labor/WeekStrip";
import { fmtDayLabel, fmtPct, fmtSignedMoney, fmtSignedHours, fmtSignedPts } from "@/modules/labor/format";
import type { LaborBand, LaborDay } from "@/modules/labor/types";
import { fetchLaborV2Gm, fetchLaborV2Stores, saveLaborV2Review } from "./api";
import { recentWeekOptions } from "./weeks";

const GM_QK = "labor-v2-gm";

export function LaborV2GmPage() {
  const [store, setStore] = useState<string>("");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [weekEnd, setWeekEnd] = useState<string>(""); // "" = this week (latest)

  const storesQ = useQuery({ queryKey: ["labor-v2-stores"], queryFn: fetchLaborV2Stores });
  const stores = storesQ.data?.stores ?? [];
  const multiStore = stores.length > 1;
  const weekOptions = useMemo(() => recentWeekOptions(), []);

  useEffect(() => {
    if (!store && stores.length) setStore(String(stores[0].number));
  }, [store, stores]);

  const gmQ = useQuery({
    queryKey: [GM_QK, store, weekEnd, date ?? "latest"],
    // A picked day wins; else the picked week; else latest.
    queryFn: () => fetchLaborV2Gm(store, date ? { date } : weekEnd ? { week: weekEnd } : undefined),
    enabled: !!store,
    refetchOnWindowFocus: !weekEnd,
    refetchInterval: weekEnd ? false : 10 * 60_000,
  });

  const data = gmQ.data;
  const day = data?.day ?? null;
  const goal = data?.goal ?? null;

  return (
    <>
      <PageHeader
        title="Yesterday's labor"
        description={
          <>
            <span className="block text-accent">Testing pulling from IX</span>
            {data?.store
              ? `#${data.store.number} · ${data.store.name}`
              : "Review your numbers against chart and explain any miss."}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data && data.notes_due > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sonic-50 px-3 py-1.5 text-xs font-semibold text-sonic-700">
                <Clock className="h-3.5 w-3.5" />
                {data.notes_due} {data.notes_due === 1 ? "note" : "notes"} due
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => gmQ.refetch()} disabled={gmQ.isFetching}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", gmQ.isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {multiStore && (
          <select
            value={store}
            onChange={(e) => { setStore(e.target.value); setDate(undefined); setWeekEnd(""); }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.number}>
                #{s.number} · {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={weekEnd}
          onChange={(e) => { setWeekEnd(e.target.value); setDate(undefined); }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
          aria-label="Week"
        >
          {weekOptions.map((o) => <option key={o.value || "latest"} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {storesQ.isLoading || (gmQ.isLoading && !data) ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : !stores.length ? (
        <EmptyState title="No stores in scope" description="You don't have any stores assigned to view labor for." />
      ) : gmQ.isError ? (
        <EmptyState title="Couldn't load labor" description={(gmQ.error as Error)?.message ?? "Try again."} />
      ) : !day ? (
        <EmptyState
          title="No labor data yet"
          description="No labor has been captured for this store and week. Data appears once the feed pulls (7 AM–10 PM CT) or after an admin refreshes Labor v2."
        />
      ) : (
        <div className="space-y-5">
          {data!.week.length > 0 && (
            <WeekStrip week={data!.week} selected={data!.date} onSelect={(d) => setDate(d)} />
          )}

          {/* Miss banner */}
          {day.note_due && (
            <div className="flex items-start gap-3 rounded-xl bg-sonic-50 p-4 ring-1 ring-sonic/20">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-sonic text-white">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-sonic-700">
                  Missed chart — {fmtDayLabel(day.business_date)}
                </h3>
                <p className="text-sm text-sonic-700/90">
                  Labor ran <strong>{fmtSignedMoney(day.dollars_over_chart)}</strong> (
                  {fmtSignedHours(day.hours_over_chart)}) over the daily chart —{" "}
                  <strong>{fmtSignedPts(day.variance_pts)}</strong> above the {fmtPct(day.goal_pct ?? goal)} daily goal. An
                  explanation is required.
                </p>
              </div>
            </div>
          )}

          {/* Three band cards — each band carries its OWN target (daily,
              weekly and period charts differ; never reuse one for another).
              goal_pct falls back to the headline goal for stale caches. */}
          <div className="grid gap-4 md:grid-cols-3">
            <BandCard title="Daily" subtitle={fmtDayLabel(day.business_date)} band={day} goal={day.goal_pct ?? goal} salesLabel="Daily Sales" highlight />
            <BandCard title="Week to Date" band={data!.wtd} goal={data!.wtd?.goal_pct ?? goal} salesLabel="WTD Sales" />
            <BandCard title="Period to Date" band={data!.ptd} goal={data!.ptd?.goal_pct ?? goal} salesLabel="PTD Sales" />
          </div>

          {/* Overtime → floor-hours opportunity (uses the week's OT). */}
          <OtInsightCard band={data!.wtd} />

          {/* Goal footer */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
            <span className="text-zinc-400">⚑</span>
            <span>
              Labor goals — Daily <strong className="text-midnight">{fmtPct(day.goal_pct ?? goal)}</strong>
              {" · "}WTD <strong className="text-midnight">{fmtPct(data!.wtd?.goal_pct ?? goal)}</strong>
              {" · "}PTD <strong className="text-midnight">{fmtPct(data!.ptd?.goal_pct ?? goal)}</strong>
              {data!.goal_source ? ` · ${data!.goal_source}` : ""}
            </span>
          </div>

          {/* Explanation */}
          <ReviewBox storeNumber={store} day={day} />
        </div>
      )}
    </>
  );
}

// Overtime → floor-hours opportunity. OT is paid at 1.5× the average wage; the
// 0.5× premium is money spent on NO extra bodies. Reinvested at straight time,
// that premium alone buys back hours: extra hours = OT hours × 0.5 (which is
// exactly premium$ ÷ avg wage). Click to see the breakdown.
const SHIFT_HOURS = 8;
function OtInsightCard({ band }: { band: LaborBand | null }) {
  const [open, setOpen] = useState(false);
  const ot = band?.overtime_hours ?? 0;
  const wage = band?.avg_wage ?? null;
  if (!ot || ot <= 0 || !wage) {
    return (
      <div className="rounded-xl bg-white px-4 py-3 text-sm text-zinc-500 ring-1 ring-zinc-200">
        <Clock className="mr-1.5 inline h-3.5 w-3.5" /> No overtime this week — nice.
      </div>
    );
  }
  const premium = ot * 0.5 * wage;      // the half-time you paid for zero extra bodies
  const extraHrs = ot * 0.5;            // = premium ÷ wage
  const crew = extraHrs / SHIFT_HOURS;  // extra 8-hour shifts you could staff
  const fmt0 = (n: number) => Math.round(n).toLocaleString();
  const fmt1 = (n: number) => n.toFixed(1);

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-midnight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Clock className="h-4 w-4" />
          </span>
          Overtime this week — {fmt1(ot)} hrs
        </span>
        <span className="text-xs font-medium text-accent">
          {open ? "Hide" : `≈ ${fmt1(extraHrs)} hrs of floor time lost →`}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-zinc-100 px-4 py-4">
          <p className="text-sm text-zinc-600">
            Those {fmt1(ot)} OT hours are paid at <strong>1.5× your average wage</strong>{" "}
            (${wage.toFixed(2)}/hr). The half-time <strong>premium</strong> — about{" "}
            <strong className="text-amber-700">${fmt0(premium)}</strong> — buys you <em>no extra
            bodies</em> on the floor.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="OT premium paid" value={`$${fmt0(premium)}`} tone="text-amber-700" />
            <Stat label="Straight-time hours that buys" value={`${fmt1(extraHrs)} hrs`} tone="text-emerald-700" />
            <Stat label="≈ extra 8-hr shifts" value={fmt1(crew)} tone="text-emerald-700" />
          </div>
          <p className="text-xs text-zinc-500">
            If OT weren't an issue, that premium reinvested at your average wage would put roughly{" "}
            <strong>{fmt1(extraHrs)} more hours</strong> — about <strong>{fmt1(crew)}</strong> more
            crew for a full shift — on the floor this week, for the same spend.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums", tone ?? "text-midnight")}>{value}</div>
    </div>
  );
}

// Note entry/edit box — posts to the labor-v2 review endpoint (labor_reviews)
// and refreshes the GM query so a saved note clears the miss in place.
// Fixed root-cause options for a labor miss — pick one, then explain.
const ROOT_CAUSES: { key: string; label: string }[] = [
  { key: "poor_projections", label: "Poor Projections" },
  { key: "scheduled_above_chart", label: "Scheduled Above Chart" },
  { key: "didnt_follow_schedule", label: "Didn't Follow the Schedule" },
  { key: "auto_clock", label: "Auto Clock" },
  { key: "other", label: "Other" },
];
const ROOT_CAUSE_LABEL: Record<string, string> = Object.fromEntries(ROOT_CAUSES.map((r) => [r.key, r.label]));

function ReviewBox({ storeNumber, day }: { storeNumber: string; day: LaborDay }) {
  const qc = useQueryClient();
  const toast = useToast();
  const existing = day.review?.note ?? "";
  const existingCause = day.review?.root_cause ?? "";
  const [editing, setEditing] = useState(!day.explained);
  const [note, setNote] = useState(existing);
  const [rootCause, setRootCause] = useState(existingCause);

  useEffect(() => {
    setNote(existing);
    setRootCause(existingCause);
    setEditing(!day.explained);
  }, [day.business_date, day.explained, existing, existingCause]);

  const save = useMutation({
    mutationFn: () => saveLaborV2Review({
      store_number: storeNumber, business_date: day.business_date, note: note.trim(),
      root_cause: rootCause || undefined,
    }),
    onSuccess: () => {
      toast.push("Explanation submitted.", "success");
      qc.invalidateQueries({ queryKey: [GM_QK] });
      setEditing(false);
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Could not save note.", "error"),
  });

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
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
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

  const dueLane = day.note_due;
  return (
    <div className={cn("rounded-xl bg-white p-5 ring-1", dueLane ? "ring-warn/40" : "ring-zinc-200")}>
      <h3 className="text-sm font-semibold text-midnight">{day.explained ? "Edit explanation" : "Explain this miss"}</h3>
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
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setNote(existing); }}>Cancel</Button>
        )}
        <Button size="sm" disabled={!note.trim() || (dueLane && !rootCause) || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Submit explanation"}
        </Button>
      </div>
    </div>
  );
}
