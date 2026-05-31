// DO district labor view — "District labor · Yesterday". Four rollup
// tiles, the three district-average band cards, and a sortable/filterable
// store list (worst-first). Clicking a store row could deep-link to that
// store's GM view (future); for now it surfaces the note inline.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import { fetchDistrictLabor, fetchLaborDistricts } from "./api";
import {
  fmtDayLabel,
  fmtPct,
  fmtSignedHours,
  fmtSignedMoney,
  fmtSignedPts,
  statusDisplay,
} from "./format";
import type { DistrictStoreRow } from "./types";

type Filter = "all" | "over" | "due";
type Sort = "worst" | "labor" | "store";

export function DistrictLaborView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("worst");
  // "" = all districts the caller can see (the default rollup). SDO/RVP can
  // narrow to one district; a single-district DO only ever has one.
  const [district, setDistrict] = useState<string>("");

  const districtsQ = useQuery({ queryKey: ["labor-districts"], queryFn: fetchLaborDistricts });
  const districts = districtsQ.data?.districts ?? [];
  const multiDistrict = districts.length > 1;

  const q = useQuery({
    queryKey: ["labor-district", district || "all"],
    queryFn: () => fetchDistrictLabor(undefined, district || undefined),
  });
  const data = q.data;
  const rollup = data?.rollup;

  const rows = useMemo(() => {
    let r = [...(data?.stores ?? [])];
    if (filter === "over") r = r.filter((s) => s.status === "over");
    if (filter === "due") r = r.filter((s) => s.note_due);
    if (sort === "worst") r.sort((a, b) => (b.variance_pts ?? -999) - (a.variance_pts ?? -999));
    if (sort === "labor") r.sort((a, b) => (b.labor_pct ?? -999) - (a.labor_pct ?? -999));
    if (sort === "store") r.sort((a, b) => String(a.store_number).localeCompare(String(b.store_number)));
    return r;
  }, [data?.stores, filter, sort]);

  const overCount = (data?.stores ?? []).filter((s) => s.status === "over").length;
  const dueCount = (data?.stores ?? []).filter((s) => s.note_due).length;

  return (
    <>
      <PageHeader
        title="District labor · Yesterday"
        description={data?.date ? `${fmtDayLabel(data.date)} · ${rollup?.store_count ?? 0} stores rolled up` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {multiDistrict && (
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
              >
                <option value="">All my districts</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.store_count})
                  </option>
                ))}
              </select>
            )}
            {rollup && rollup.notes_due > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sonic-50 px-3 py-1.5 text-xs font-semibold text-sonic-700">
                <Clock className="h-3.5 w-3.5" />
                {rollup.notes_due} {rollup.notes_due === 1 ? "note" : "notes"} to review
              </span>
            )}
          </div>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}
          </div>
        </div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load district labor" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !rollup ? (
        <EmptyState title="No labor data yet" description="No snapshot captured for your stores yet. Data appears after the nightly sync." />
      ) : (
        <div className="space-y-5">
          {/* Rollup tiles */}
          <div className="grid gap-4 md:grid-cols-4">
            <Tile
              label="District Labor %"
              value={fmtPct(rollup.district_labor_pct)}
              subOverride={`avg across ${rollup.store_count} stores`}
              tone={rollup.stores_over_chart > rollup.store_count / 2 ? "over" : "on"}
            />
            <Tile
              label="Stores Over Chart"
              value={`${rollup.stores_over_chart} / ${rollup.store_count}`}
              subOverride={`${rollup.store_count - rollup.stores_over_chart} on or under chart`}
              tone={rollup.stores_over_chart > 0 ? "over" : "on"}
            />
            <Tile
              label="Notes to Review"
              value={String(rollup.notes_due)}
              subOverride={`${rollup.notes_explained} already explained`}
              tone="neutral"
            />
            <Tile
              label="$ Over Chart · Day"
              value={fmtSignedMoney(rollup.dollars_over_chart)}
              subOverride={`${fmtSignedHours(rollup.hours_over_chart)} district-wide`}
              tone={rollup.dollars_over_chart > 0 ? "over" : "on"}
            />
          </div>

          {/* Store list */}
          <div className="rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-4">
              <h3 className="text-sm font-semibold text-midnight">Stores · yesterday</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<Filter>
                  dense
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All", count: data?.stores.length ?? 0 },
                    { value: "over", label: "Over chart", count: overCount, dot: "bg-sonic" },
                    { value: "due", label: "Note due", count: dueCount, dot: "bg-warn" },
                  ]}
                />
                <Segmented<Sort>
                  dense
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "worst", label: "worst first" },
                    { value: "labor", label: "labor %" },
                    { value: "store", label: "store" },
                  ]}
                />
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No stores match this filter.</div>
            ) : (
              <>
                {/* Column headers — aligned to the StoreRow layout below. */}
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  <span className="w-1" />
                  <span className="w-9" />
                  <span className="min-w-0 flex-1">Store</span>
                  <span className="w-16 text-right">Labor %</span>
                  <span className="hidden w-14 text-right sm:block">Var</span>
                  <span className="hidden w-20 text-right sm:block">$ Over</span>
                  <span className="hidden w-14 text-right sm:block">Hrs</span>
                  <span className="ml-2 w-[88px] text-right">Status</span>
                </div>
                <div className="divide-y divide-zinc-100">
                  {rows.map((s) => (
                    <StoreRow key={s.store_number} row={s} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  subOverride,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  subOverride?: string;
  tone: "over" | "on" | "neutral";
}) {
  const valueColor =
    tone === "over" ? "text-sonic" : tone === "on" ? "text-ok" : "text-midnight";
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums", valueColor)}>{value}</div>
      {(subOverride ?? sub) && (
        <div className="mt-1 text-xs text-zinc-500">{subOverride ?? sub}</div>
      )}
    </div>
  );
}

function StoreRow({ row }: { row: DistrictStoreRow }) {
  const sd = statusDisplay(row.status);
  const over = row.status === "over";
  const [open, setOpen] = useState(false);
  const statusLabel = row.note_due ? "Note due" : row.explained ? "Explained" : sd.label;
  const statusClasses = row.note_due
    ? "bg-sonic-50 text-sonic-700"
    : row.explained
    ? "bg-accent-100 text-accent-700"
    : sd.bg + " " + sd.text;

  return (
    <div>
      <button
        onClick={() => row.note && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-3 p-4 text-left", row.note && "hover:bg-zinc-50")}
      >
        {/* over-chart accent rail */}
        <span className={cn("h-10 w-1 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
        {/* store badge — leading 2 digits of the DI, matching the design */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold tabular-nums text-zinc-600">
          {String(row.store_number).slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-midnight">
            #{row.store_number} · {row.store_name ?? ""}
          </div>
          <div className="truncate text-xs text-zinc-500">{row.gm_name ? `GM ${row.gm_name}` : "—"}</div>
        </div>
        <div className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-sonic" : "text-ok")}>
          {fmtPct(row.labor_pct)}
        </div>
        <div className={cn("hidden w-14 text-right text-xs tabular-nums sm:block", over ? "text-sonic-700" : "text-zinc-500")}>
          {fmtSignedPts(row.variance_pts).replace(" pts", "")}
        </div>
        <div className={cn("hidden w-20 text-right text-xs tabular-nums sm:block", over ? "text-sonic-700" : "text-zinc-500")}>
          {fmtSignedMoney(row.dollars_over_chart)}
        </div>
        <div className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 sm:block">
          {fmtSignedHours(row.hours_over_chart).replace(" hrs", "")}
        </div>
        <span className={cn("ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", statusClasses)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", row.note_due ? "bg-warn" : sd.dot)} />
          {statusLabel}
        </span>
      </button>
      {open && row.note && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-midnight">{row.note}</div>
      )}
    </div>
  );
}
