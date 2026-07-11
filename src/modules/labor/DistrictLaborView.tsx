// DO district labor view — "District labor · Yesterday". Four rollup
// tiles, the three district-average band cards, and a sortable/filterable
// store list (worst-first). Clicking a store row could deep-link to that
// store's GM view (future); for now it surfaces the note inline.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Clock, RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchDistrictLabor, fetchLaborDistricts, fetchLegacyMissTracker, triggerSyncNow } from "./api";
import { MissTrackerExport } from "./MissTrackerExport";
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
// The view's time horizon. "mtd" reads the PTD band — SONIC's 4-week
// period-to-date IS the operational month-to-date; MTD is just the label
// the field uses for it.
type Horizon = "day" | "wtd" | "mtd";
// Column-header sort. "worst first" defaults to variance desc; every column
// (Store, Day/WTD/MTD %, Var, $ Over, Hrs, Status) is independently sortable
// by clicking its header, matching the Labor v2 table. Var/$ Over sort by
// the ACTIVE horizon's values.
type SortKey = "store" | "day" | "wtd" | "mtd" | "var" | "over" | "hrs" | "status";
type SortDir = "asc" | "desc";
interface SortState { key: SortKey; dir: SortDir }

const HORIZON_LABEL: Record<Horizon, string> = { day: "Day %", wtd: "WTD %", mtd: "MTD %" };

// Same fixed root-cause list the GM picks from when explaining a miss.
const ROOT_CAUSE_LABEL: Record<string, string> = {
  poor_projections: "Poor Projections",
  scheduled_above_chart: "Scheduled Above Chart",
  didnt_follow_schedule: "Didn't Follow the Schedule",
  auto_clock: "Auto Clock",
  other: "Other",
};

// The two non-active horizons, in fixed day → wtd → mtd order.
function altHorizons(active: Horizon): Horizon[] {
  return (["day", "wtd", "mtd"] as Horizon[]).filter((h) => h !== active);
}

// One horizon's slice of a store row.
function bandOf(row: DistrictStoreRow, h: Horizon) {
  if (h === "wtd") {
    return { pct: row.wtd_labor_pct, variance: row.wtd_variance_pts, dollars: row.wtd_dollars_over_chart, hours: row.wtd_hours_over_chart, status: row.wtd_status };
  }
  if (h === "mtd") {
    return { pct: row.ptd_labor_pct, variance: row.ptd_variance_pts, dollars: row.ptd_dollars_over_chart, hours: row.ptd_hours_over_chart, status: row.ptd_status };
  }
  return { pct: row.labor_pct, variance: row.variance_pts, dollars: row.dollars_over_chart, hours: row.hours_over_chart, status: row.status };
}

// Rank a row's status so "sort by Status" surfaces the most actionable rows
// first when sorted desc: a note due outranks an unexplained over-chart
// store, which outranks an explained one, which outranks on-chart. The
// over-chart part keys off the active horizon; note duty is always daily.
function statusRank(row: DistrictStoreRow, h: Horizon): number {
  if (row.note_due) return 3;
  if (bandOf(row, h).status === "over" && !row.explained) return 2;
  if (row.explained) return 1;
  return 0;
}
function sortValue(row: DistrictStoreRow, key: SortKey, h: Horizon): number | string {
  switch (key) {
    case "store": return String(row.store_number);
    case "day": return row.labor_pct ?? -Infinity;
    case "wtd": return row.wtd_labor_pct ?? -Infinity;
    case "mtd": return row.ptd_labor_pct ?? -Infinity;
    case "var": return bandOf(row, h).variance ?? -Infinity;
    case "over": return bandOf(row, h).dollars ?? -Infinity;
    case "hrs": return bandOf(row, h).hours ?? -Infinity;
    case "status": return statusRank(row, h);
  }
}

// Who can trigger an off-cycle sheet sync from here. Mirrors labor.js's
// SYNC_ROLES — the backend re-checks; this only decides button visibility.
const SYNC_ROLES = new Set(["admin", "vp", "coo"]);

export function DistrictLaborView() {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [horizon, setHorizon] = useState<Horizon>("day");
  const [sort, setSort] = useState<SortState>({ key: "var", dir: "desc" });
  // "" = all districts the caller can see (the default rollup). SDO/RVP can
  // narrow to one district; a single-district DO only ever has one.
  const [district, setDistrict] = useState<string>("");

  const districtsQ = useQuery({ queryKey: ["labor-districts"], queryFn: fetchLaborDistricts });
  const districts = districtsQ.data?.districts ?? [];
  const multiDistrict = districts.length > 1;
  const canSync = SYNC_ROLES.has(profile?.role ?? "");

  // Off-cycle sync — same force-pull as /admin/labor-sync's "Sync now"
  // (bypasses the 7:30–14:00 CT poll window and the freshness guards),
  // surfaced here so a stale day can be fixed without leaving the page.
  // The toast calls out when the sheet's Sales Date is still behind, so
  // "synced Thursday" never silently reads as success on a Friday.
  const sync = useMutation({
    mutationFn: triggerSyncNow,
    onSuccess: (res) => {
      const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      if (res.business_date && res.business_date < yesterdayIso) {
        toast.push(
          `Synced, but the sheet's Sales Date is still ${fmtDayLabel(res.business_date)} — back office hasn't rolled it forward yet.`,
          "error",
        );
      } else {
        toast.push(`Synced ${res.business_date ? fmtDayLabel(res.business_date) : "sheet"}.`, "success");
      }
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("labor") });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Sync failed.", "error"),
  });

  const q = useQuery({
    queryKey: ["labor-district", district || "all"],
    queryFn: () => fetchDistrictLabor(undefined, district || undefined),
  });
  const data = q.data;
  const rollup = data?.rollup;

  // Clicking the active column flips direction; clicking a new one starts
  // descending (worst/highest first) except Store, which starts ascending
  // (alphabetical/numeric makes more sense than "highest store # first").
  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "store" ? "asc" : "desc" }));
  }

  const rows = useMemo(() => {
    let r = [...(data?.stores ?? [])];
    if (filter === "over") r = r.filter((s) => bandOf(s, horizon).status === "over");
    if (filter === "due") r = r.filter((s) => s.note_due);
    r.sort((a, b) => {
      const av = sortValue(a, sort.key, horizon), bv = sortValue(b, sort.key, horizon);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [data?.stores, filter, sort, horizon]);

  const overCount = (data?.stores ?? []).filter((s) => bandOf(s, horizon).status === "over").length;
  const dueCount = (data?.stores ?? []).filter((s) => s.note_due).length;

  return (
    <>
      <PageHeader
        title="District labor · Yesterday"
        description={
          data?.date
            ? `${fmtDayLabel(data.date)} · ${rollup?.store_count ?? 0} stores rolled up`
              + (rollup?.dos?.length === 1
                  ? ` · DO ${rollup.dos[0]}`
                  : rollup && rollup.dos.length > 1
                  ? ` · ${rollup.dos.length} DOs`
                  : "")
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MissTrackerExport fetcher={fetchLegacyMissTracker} />
            {canSync && (
              <button
                type="button"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                title="Off-cycle sync — force-pull the labor sheet now, outside the normal 7:30 AM–2 PM CT window"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} strokeWidth={2} />
                {sync.isPending ? "Syncing…" : "Sync sheet"}
              </button>
            )}
            <Segmented<Horizon>
              dense
              value={horizon}
              onChange={setHorizon}
              options={[
                { value: "day", label: "Day" },
                { value: "wtd", label: "WTD" },
                { value: "mtd", label: "MTD" },
              ]}
            />
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
          {/* Labor % — day vs cumulative (WTD / period-to-date) */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile
              label="District Labor % · Day"
              value={fmtPct(rollup.district_labor_pct)}
              subOverride={`avg across ${rollup.store_count} stores`}
              tone={rollup.stores_over_chart > rollup.store_count / 2 ? "over" : "on"}
            />
            <Tile
              label="WTD Labor %"
              value={fmtPct(rollup.wtd_labor_pct)}
              subOverride={
                rollup.wtd_dollars_over_chart
                  ? `${fmtSignedMoney(rollup.wtd_dollars_over_chart)} · ${fmtSignedHours(rollup.wtd_hours_over_chart)} over chart`
                  : "week to date · district avg"
              }
              tone={rollup.wtd_dollars_over_chart > 0 ? "over" : "on"}
            />
            <Tile
              label="MTD Labor %"
              value={fmtPct(rollup.ptd_labor_pct)}
              subOverride={
                rollup.ptd_dollars_over_chart
                  ? `${fmtSignedMoney(rollup.ptd_dollars_over_chart)} · ${fmtSignedHours(rollup.ptd_hours_over_chart)} over · period-to-date`
                  : "month (period) to date · district avg"
              }
              tone={rollup.ptd_dollars_over_chart > 0 ? "over" : "on"}
            />
          </div>

          {/* Operational rollups */}
          <div className="grid gap-4 sm:grid-cols-3">
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
              <h3 className="text-sm font-semibold text-midnight">
                {horizon === "day" ? "Stores · yesterday" : horizon === "wtd" ? "Stores · week to date" : "Stores · month to date (period)"}
              </h3>
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
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No stores match this filter.</div>
            ) : (
              <>
                {/* Column headers — aligned to the StoreRow layout below.
                    Every column sorts on click; clicking the active one
                    flips direction. */}
                <div className="flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  <span className="w-1" />
                  <span className="w-9" />
                  <SortTh label="Store" k="store" sort={sort} onSort={toggleSort} className="min-w-0 flex-1" />
                  {/* Primary column = the active horizon; the two small
                      lg-only columns carry the other two for context. */}
                  <SortTh label={HORIZON_LABEL[horizon]} k={horizon} sort={sort} onSort={toggleSort} className="w-16" right />
                  {altHorizons(horizon).map((h) => (
                    <SortTh key={h} label={HORIZON_LABEL[h]} k={h} sort={sort} onSort={toggleSort} className="hidden w-14 lg:block" right />
                  ))}
                  <SortTh label="Var" k="var" sort={sort} onSort={toggleSort} className="hidden w-14 sm:block" right />
                  <SortTh label="$ Over" k="over" sort={sort} onSort={toggleSort} className="hidden w-20 sm:block" right />
                  <SortTh label="Hrs" k="hrs" sort={sort} onSort={toggleSort} className="hidden w-14 sm:block" right />
                  <SortTh label="Status" k="status" sort={sort} onSort={toggleSort} className="ml-2 w-[88px]" right />
                </div>
                <div className="divide-y divide-zinc-100">
                  {rows.map((s) => (
                    <StoreRow key={s.store_number} row={s} horizon={horizon} />
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

function SortTh({
  label,
  k,
  sort,
  onSort,
  right,
  className,
}: {
  label: string;
  k: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  right?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <span className={cn(className, right && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide hover:text-zinc-600",
          right && "flex-row-reverse",
          active && "text-accent"
        )}
      >
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
      </button>
    </span>
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

function StoreRow({ row, horizon }: { row: DistrictStoreRow; horizon: Horizon }) {
  const band = bandOf(row, horizon);
  const sd = statusDisplay(band.status);
  const over = band.status === "over";
  const [open, setOpen] = useState(false);
  // Note duty is always about yesterday's number regardless of horizon —
  // reviews are filed per business date.
  const statusLabel = row.note_due ? "Note due" : row.explained ? "Explained" : sd.label;
  const statusClasses = row.note_due
    ? "bg-sonic-50 text-sonic-700"
    : row.explained
    ? "bg-accent-100 text-accent-700"
    : sd.bg + " " + sd.text;
  const altPct = (h: Horizon) =>
    h === "day" ? row.labor_pct : h === "wtd" ? row.wtd_labor_pct : row.ptd_labor_pct;

  return (
    <div>
      <button
        onClick={() => (row.note || row.root_cause) && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-3 p-4 text-left", (row.note || row.root_cause) && "hover:bg-zinc-50")}
      >
        {/* over-chart accent rail — keyed to the active horizon */}
        <span className={cn("h-10 w-1 rounded-full", over ? "bg-sonic" : "bg-transparent")} />
        {/* store badge — leading 2 digits of the DI, matching the design */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold tabular-nums text-zinc-600">
          {String(row.store_number).slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-midnight">
            #{row.store_number} · {row.store_name ?? ""}
          </div>
          <div className="truncate text-xs text-zinc-500">
            {[row.gm_name ? `GM ${row.gm_name}` : null, row.do_name ? `DO ${row.do_name}` : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
        <div className={cn("w-16 text-right text-sm font-bold tabular-nums", over ? "text-sonic" : "text-ok")}>
          {fmtPct(band.pct)}
        </div>
        {altHorizons(horizon).map((h) => (
          <div key={h} className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 lg:block">
            {fmtPct(altPct(h))}
          </div>
        ))}
        <div className={cn("hidden w-14 text-right text-xs tabular-nums sm:block", over ? "text-sonic-700" : "text-zinc-500")}>
          {fmtSignedPts(band.variance).replace(" pts", "")}
        </div>
        <div className={cn("hidden w-20 text-right text-xs tabular-nums sm:block", over ? "text-sonic-700" : "text-zinc-500")}>
          {fmtSignedMoney(band.dollars)}
        </div>
        <div className="hidden w-14 text-right text-xs tabular-nums text-zinc-500 sm:block">
          {band.hours != null ? fmtSignedHours(band.hours).replace(" hrs", "") : "—"}
        </div>
        <span className={cn("ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", statusClasses)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", row.note_due ? "bg-warn" : sd.dot)} />
          {statusLabel}
        </span>
      </button>
      {open && (row.note || row.root_cause) && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3">
          {row.root_cause && (
            <span className="inline-block rounded-full bg-sonic-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sonic-700">
              {ROOT_CAUSE_LABEL[row.root_cause] ?? row.root_cause}
            </span>
          )}
          {row.note && <div className={cn("text-sm text-midnight", row.root_cause && "mt-1.5")}>{row.note}</div>}
        </div>
      )}
    </div>
  );
}
