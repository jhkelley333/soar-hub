// /admin/close-time-watch — Close-Time Watch. Flags stores whose last clock-out
// was before their scheduled Hours-of-Operation close. Daily / weekly / monthly,
// scoped to the caller's org, grouped by DO. Read-only oversight tool.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Segmented } from "@/shared/ui/Segmented";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import {
  fetchCloseSummary, type CloseView, type CloseStatus,
  type DailyStore, type AggStore, type CloseGroup,
} from "./api";

// ── formatting ──────────────────────────────────────────────────────
const to12h = (t: string | null): string => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a";
  return `${(h % 12) || 12}:${String(m).padStart(2, "0")}${ap}`;
};
const delta = (d: number | null | undefined): string =>
  d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}m`;
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";
const dow = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7; // Mon=0

const TONE: Record<CloseStatus, { chip: string; text: string; dot: string; row: string }> = {
  flag: { chip: "bg-red-50 text-red-700 ring-red-200", text: "text-red-600", dot: "bg-red-500", row: "bg-red-50/40" },
  warn: { chip: "bg-amber-50 text-amber-700 ring-amber-200", text: "text-amber-600", dot: "bg-amber-500", row: "" },
  good: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500", row: "" },
};
const STATUS_LABEL: Record<CloseStatus, string> = { flag: "Early close", warn: "Borderline", good: "On time" };

// ── KPI tile ────────────────────────────────────────────────────────
function Kpi({ cap, big, sub, tone }: { cap: string; big: React.ReactNode; sub: string; tone: "flag" | "good" | "neutral" }) {
  const rail = tone === "flag" ? "bg-red-500" : tone === "good" ? "bg-emerald-500" : "bg-accent";
  const num = tone === "flag" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-midnight";
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", rail)} />
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{cap}</div>
      <div className={cn("mt-1 font-mono text-[28px] font-black leading-none tabular-nums", num)}>{big}</div>
      <div className="mt-1.5 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

// ── week dot strip (Mon..Sun) ───────────────────────────────────────
function WeekDots({ days }: { days: AggStore["days"] }) {
  const byDow = new Map<number, CloseStatus>();
  for (const d of days) byDow.set(dow(d.date), d.status);
  return (
    <span className="inline-flex gap-[3px]">
      {Array.from({ length: 7 }, (_, i) => {
        const s = byDow.get(i);
        return <i key={i} className={cn("inline-block h-[11px] w-[11px] rounded-[3px]", s ? TONE[s].dot : "bg-zinc-200")} />;
      })}
    </span>
  );
}

export function CloseTimeWatchPage() {
  const [view, setView] = useState<CloseView>("daily");
  const [only, setOnly] = useState(false);

  const q = useQuery({ queryKey: ["close-watch", view], queryFn: () => fetchCloseSummary(view), staleTime: 60_000 });
  const data = q.data;

  const periodLabel = useMemo(() => {
    if (!data?.date) return "";
    if (view === "daily") return `Business day · ${fmtDate(data.date)}`;
    if (view === "weekly") return `Week ending · ${fmtDate(data.range?.end)}`;
    return `Period ${data.period ?? "—"} · ${fmtDate(data.range?.start)} – ${fmtDate(data.range?.end)}`;
  }, [data, view]);

  const groups = useMemo(() => {
    const gs = data?.groups ?? [];
    if (!only) return gs;
    return gs
      .map((g) => ({ ...g, stores: g.stores.filter((s) => (view === "daily" ? (s as DailyStore).status === "flag" : (s as AggStore).early_days > 0)) }))
      .filter((g) => g.stores.length);
  }, [data, only, view]);

  const t = data?.totals ?? {};

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Close-Time Watch"
        description="Stores whose last clock-out was before their scheduled close."
      />

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<CloseView>
          dense value={view} onChange={setView}
          options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}
        />
        <span className="text-xs font-semibold text-zinc-500">{periodLabel}</span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-600">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="h-4 w-4 accent-accent" />
          Flagged only
        </label>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : !data?.date ? (
        <EmptyState title="No data yet" description={data?.message ?? "No labor has been captured yet."} />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {view === "daily" ? (
              <>
                <Kpi cap="Flagged today" big={t.flagged ?? 0} sub={`of ${t.evaluated ?? 0} stores closed early`} tone={t.flagged ? "flag" : "good"} />
                <Kpi cap="Avg minutes early" big={t.avg_early_min ? `−${t.avg_early_min}` : "0"} sub="across flagged stores" tone={t.avg_early_min ? "flag" : "neutral"} />
                <Kpi cap="Worst store" big={t.worst ? `−${Math.abs(t.worst.delta ?? 0)}` : "—"} sub={t.worst ? `#${t.worst.number} ${t.worst.name}` : "none"} tone={t.worst ? "flag" : "good"} />
                <Kpi cap="On-time close" big={t.on_time_pct != null ? `${t.on_time_pct}%` : "—"} sub={`${t.on_time ?? 0} of ${t.evaluated ?? 0} at/after close`} tone={t.on_time_pct === 100 ? "good" : "neutral"} />
              </>
            ) : (
              <>
                <Kpi cap="Stores flagged" big={t.stores_flagged ?? 0} sub="≥1 early close this period" tone={t.stores_flagged ? "flag" : "good"} />
                <Kpi cap="Repeat offenders" big={t.repeat_offenders ?? 0} sub="flagged 3+ days" tone={t.repeat_offenders ? "flag" : "good"} />
                <Kpi cap="Early-close events" big={t.events ?? 0} sub="total flagged closings" tone={t.events ? "flag" : "good"} />
                <Kpi cap="Worst store" big={t.worst ? `${t.worst.early_days}${view === "weekly" ? "/7" : "d"}` : "—"} sub={t.worst ? `#${t.worst.number} ${t.worst.name}` : "none"} tone={t.worst && (t.worst.early_days ?? 0) >= 3 ? "flag" : "neutral"} />
              </>
            )}
          </div>

          {/* legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-red-500" /> Early close — clocked out &gt;{data.grace_min} min before close</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-amber-500" /> Borderline — within {data.grace_min} min</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" /> On time — at/after close</span>
          </div>

          {/* groups */}
          {groups.length === 0 ? (
            <div className="rounded-xl bg-white py-12 text-center text-sm font-semibold text-emerald-600 ring-1 ring-zinc-200">✓ No stores flagged for this view.</div>
          ) : (
            groups.map((g) => <GroupTable key={g.do} g={g} view={view} />)
          )}

          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-zinc-500">
            <b className="text-zinc-700">Close time</b> comes from Hours of Operation (System Settings), per weekday, with dated special-hours overrides applied.
            <b className="text-zinc-700"> Last clock-out</b> is the Skunkworks feed value on the labor record. Overnight closes (past midnight) are handled.
            {data.no_hours_days ? ` ${data.no_hours_days} store-day(s) had no hours on file and were skipped.` : ""}
          </p>
        </>
      )}
    </div>
  );
}

// ── one DO's table ──────────────────────────────────────────────────
function GroupTable({ g, view }: { g: CloseGroup; view: CloseView }) {
  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-1 pb-2">
        <h2 className="text-sm font-bold text-midnight">{g.do}</h2>
        <span className="text-[11px] font-semibold text-zinc-400">{g.count} stores</span>
        {g.flagged > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600 ring-1 ring-red-200">
            <AlertTriangle className="h-3 w-3" /> {g.flagged} flagged
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
        {/* Fixed layout with a shared colgroup so every DO group's table lines
            up column-for-column (separate <table>s otherwise auto-size apart). */}
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            {view === "daily" ? (
              <>
                <col style={{ width: "34%" }} /><col style={{ width: "15%" }} /><col style={{ width: "19%" }} /><col style={{ width: "14%" }} /><col style={{ width: "18%" }} />
              </>
            ) : view === "weekly" ? (
              <>
                <col style={{ width: "44%" }} /><col style={{ width: "22%" }} /><col style={{ width: "17%" }} /><col style={{ width: "17%" }} />
              </>
            ) : (
              <>
                <col style={{ width: "36%" }} /><col style={{ width: "30%" }} /><col style={{ width: "17%" }} /><col style={{ width: "17%" }} />
              </>
            )}
          </colgroup>
          <thead>
            <tr className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="px-3.5 py-2 text-left font-bold">Store</th>
              {view === "daily" ? (
                <>
                  <th className="px-3.5 py-2 text-right font-bold">Close</th>
                  <th className="px-3.5 py-2 text-right font-bold">Last clock-out</th>
                  <th className="px-3.5 py-2 text-right font-bold">vs Close</th>
                  <th className="px-3.5 py-2 text-right font-bold">Status</th>
                </>
              ) : view === "weekly" ? (
                <>
                  <th className="px-3.5 py-2 text-right font-bold">Mon–Sun</th>
                  <th className="px-3.5 py-2 text-right font-bold">Early days</th>
                  <th className="px-3.5 py-2 text-right font-bold">Worst</th>
                </>
              ) : (
                <>
                  <th className="px-3.5 py-2 text-right font-bold">Early-close rate</th>
                  <th className="px-3.5 py-2 text-right font-bold">Early days</th>
                  <th className="px-3.5 py-2 text-right font-bold">Worst day</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {g.stores.map((s) => {
              const isFlagged = view === "daily" ? (s as DailyStore).status === "flag" : (s as AggStore).early_days > 0;
              return (
                <tr key={s.number} className={cn("border-t border-zinc-100", isFlagged && "bg-red-50/40")}>
                  <td className="px-3.5 py-2.5 text-left">
                    <div className="font-semibold text-midnight">{s.name}</div>
                    <div className="font-mono text-[11px] text-zinc-400">#{s.number}</div>
                  </td>
                  {view === "daily" ? <DailyCells s={s as DailyStore} /> : view === "weekly" ? <WeeklyCells s={s as AggStore} /> : <MonthlyCells s={s as AggStore} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyCells({ s }: { s: DailyStore }) {
  return (
    <>
      <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">{to12h(s.close)}{s.overnight && <span className="ml-1 text-[10px] text-zinc-400">+1</span>}</td>
      <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">{to12h(s.out)}</td>
      <td className="px-3.5 py-2.5 text-right">
        <span className={cn("inline-block min-w-[62px] rounded-md px-2 py-0.5 text-center font-mono text-xs font-semibold tabular-nums ring-1", TONE[s.status].chip)}>{delta(s.delta)}</span>
      </td>
      <td className={cn("px-3.5 py-2.5 text-right text-[11px] font-bold", TONE[s.status].text)}>{STATUS_LABEL[s.status]}{s.special && <span className="ml-1 font-normal text-zinc-400">(special)</span>}</td>
    </>
  );
}
function WeeklyCells({ s }: { s: AggStore }) {
  const tone: CloseStatus = s.early_days >= 3 ? "flag" : s.early_days > 0 ? "flag" : s.borderline_days > 0 ? "warn" : "good";
  return (
    <>
      <td className="px-3.5 py-2.5 text-right"><span className="inline-flex justify-end"><WeekDots days={s.days} /></span></td>
      <td className="px-3.5 py-2.5 text-right">
        <span className={cn("inline-block min-w-[48px] rounded-md px-2 py-0.5 text-center font-mono text-xs font-semibold tabular-nums ring-1", TONE[tone].chip)}>{s.early_days} / {s.eval_days}</span>
      </td>
      <td className="px-3.5 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600">{delta(s.worst_delta)}</td>
    </>
  );
}
function MonthlyCells({ s }: { s: AggStore }) {
  const pct = Math.round(s.rate * 100);
  const tone: CloseStatus = s.early_days >= 10 ? "flag" : s.early_days > 0 ? "warn" : "good";
  return (
    <>
      <td className="px-3.5 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.max(pct ? 4 : 0, pct)}%` }} />
          </div>
          <span className="min-w-[38px] text-right font-mono text-[11px] font-semibold tabular-nums text-zinc-500">{pct}%</span>
        </div>
      </td>
      <td className="px-3.5 py-2.5 text-right">
        <span className={cn("inline-block min-w-[52px] rounded-md px-2 py-0.5 text-center font-mono text-xs font-semibold tabular-nums ring-1", TONE[tone].chip)}>{s.early_days} / {s.eval_days}</span>
      </td>
      <td className="px-3.5 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600">{delta(s.worst_delta)}</td>
    </>
  );
}
