// GM labor view — "Yesterday's labor". The week strip up top, a miss
// banner when the selected day is over chart and unexplained, the three
// Daily/WTD/PTD band cards, the goal footer, and the explanation box.
//
// For multi-store roles (DO+) a store picker selects which store to view;
// a GM with a single store skips the picker.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchGmLabor, fetchLaborStores } from "./api";
import { BandCard } from "./BandCard";
import { WeekStrip } from "./WeekStrip";
import { ReviewBox } from "./ReviewBox";
import { fmtDayLabel, fmtPct, fmtSignedMoney, fmtSignedHours, fmtSignedPts } from "./format";

export function GmLaborView() {
  const [store, setStore] = useState<string>("");
  const [date, setDate] = useState<string | undefined>(undefined);

  const storesQ = useQuery({ queryKey: ["labor-stores"], queryFn: fetchLaborStores });
  const stores = storesQ.data?.stores ?? [];
  const multiStore = stores.length > 1;

  // Default to the first store once loaded.
  useEffect(() => {
    if (!store && stores.length) setStore(String(stores[0].number));
  }, [store, stores]);

  const gmQ = useQuery({
    queryKey: ["labor-gm", store, date ?? "latest"],
    queryFn: () => fetchGmLabor(store, date),
    enabled: !!store,
  });

  const data = gmQ.data;
  const day = data?.day ?? null;
  const goal = data?.goal ?? null;

  return (
    <>
      <PageHeader
        title="Yesterday's labor"
        description="Review your numbers against chart and explain any miss."
        actions={
          data && data.notes_due > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sonic-50 px-3 py-1.5 text-xs font-semibold text-sonic-700">
              <Clock className="h-3.5 w-3.5" />
              {data.notes_due} {data.notes_due === 1 ? "note" : "notes"} due
            </span>
          ) : undefined
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
          description="No snapshot has been captured for this store and week. Data appears once the nightly sync runs."
        />
      ) : (
        <div className="space-y-5">
          {data!.week.length > 0 && (
            <WeekStrip
              week={data!.week}
              selected={data!.date}
              onSelect={(d) => setDate(d)}
            />
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
            <BandCard
              title="Daily"
              subtitle={fmtDayLabel(day.business_date)}
              band={day}
              goal={goal}
              salesLabel="Daily Sales"
              highlight
            />
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
