// GM labor view (feed-powered) — "Yesterday's labor", same layout as the
// original /labor tab but sourced from the KPI feed (labor_v2_daily) instead
// of the Google Sheet. Week strip, a miss banner when the day is over chart
// and unexplained, the three Daily/WTD/PTD band cards, the goal footer, and
// the explanation box. Notes use the shared labor_reviews schema.
//
// Multi-store roles (DO+) get a store picker; a single-store GM skips it.

import { useEffect, useState } from "react";
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
import type { LaborDay } from "@/modules/labor/types";
import { fetchLaborV2Gm, fetchLaborV2Stores, saveLaborV2Review } from "./api";

const GM_QK = "labor-v2-gm";

export function LaborV2GmPage() {
  const [store, setStore] = useState<string>("");
  const [date, setDate] = useState<string | undefined>(undefined);

  const storesQ = useQuery({ queryKey: ["labor-v2-stores"], queryFn: fetchLaborV2Stores });
  const stores = storesQ.data?.stores ?? [];
  const multiStore = stores.length > 1;

  useEffect(() => {
    if (!store && stores.length) setStore(String(stores[0].number));
  }, [store, stores]);

  const gmQ = useQuery({
    queryKey: [GM_QK, store, date ?? "latest"],
    queryFn: () => fetchLaborV2Gm(store, date),
    enabled: !!store,
    refetchOnWindowFocus: true,
    refetchInterval: 10 * 60_000,
  });

  const data = gmQ.data;
  const day = data?.day ?? null;
  const goal = data?.goal ?? null;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Yesterday&apos;s labor
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              Beta
            </span>
          </span>
        }
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

      {multiStore && (
        <div className="mb-4">
          <select
            value={store}
            onChange={(e) => { setStore(e.target.value); setDate(undefined); }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.number}>
                #{s.number} · {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
          description="No labor has been captured for this store and week. Data appears once the feed pulls (7 AM–2 PM CT) or after an admin refreshes Labor v2."
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
                  <strong>{fmtSignedPts(day.variance_pts)}</strong> above the {fmtPct(goal)} goal. An
                  explanation is required.
                </p>
              </div>
            </div>
          )}

          {/* Three band cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <BandCard title="Daily" subtitle={fmtDayLabel(day.business_date)} band={day} goal={goal} salesLabel="Daily Sales" highlight />
            <BandCard title="Week to Date" band={data!.wtd} goal={goal} salesLabel="WTD Sales" />
            <BandCard title="Period to Date" band={data!.ptd} goal={goal} salesLabel="PTD Sales" />
          </div>

          {/* Goal footer */}
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
            <span className="text-zinc-400">⚑</span>
            <span>
              Base PTD labor goal <strong className="text-midnight">{fmtPct(goal)}</strong>
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

// Note entry/edit box — posts to the labor-v2 review endpoint (labor_reviews)
// and refreshes the GM query so a saved note clears the miss in place.
function ReviewBox({ storeNumber, day }: { storeNumber: string; day: LaborDay }) {
  const qc = useQueryClient();
  const toast = useToast();
  const existing = day.review?.note ?? "";
  const [editing, setEditing] = useState(!day.explained);
  const [note, setNote] = useState(existing);

  useEffect(() => {
    setNote(existing);
    setEditing(!day.explained);
  }, [day.business_date, day.explained, existing]);

  const save = useMutation({
    mutationFn: () => saveLaborV2Review({ store_number: storeNumber, business_date: day.business_date, note: note.trim() }),
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
        {dueLane ? "Labor ran over chart on this day — an explanation is required." : "Add a note for this day (optional)."}
      </p>
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
        <Button size="sm" disabled={!note.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Submit explanation"}
        </Button>
      </div>
    </div>
  );
}
