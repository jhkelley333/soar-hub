// One of the three labor cards (Daily / Week to Date / Period to Date).
// Big labor %, a goal bar, variance-to-chart, and the four sub-metrics
// (sales, $ over, hours over, chart $ allowed). Color follows status:
// over chart = sonic red, on chart = ok green.

import { cn } from "@/lib/cn";
import type { ChartStatus, LaborBand } from "./types";
import {
  fmtMoney,
  fmtMoneyCents,
  fmtPct,
  fmtSignedHours,
  fmtSignedMoney,
  fmtSignedPts,
  statusDisplay,
} from "./format";

export function BandCard({
  title,
  subtitle,
  band,
  goal,
  salesLabel,
  highlight = false,
}: {
  title: string;
  subtitle?: string;
  band: LaborBand | null;
  goal: number | null;
  salesLabel: string;
  highlight?: boolean;
}) {
  const status: ChartStatus = band?.status ?? "missing";
  const sd = statusDisplay(status);
  const over = status === "over";
  const accent = over ? "text-sonic" : status === "on" ? "text-ok" : "text-zinc-400";

  // Goal bar: fill proportion of labor% against a sensible ceiling.
  const labor = band?.labor_pct ?? null;
  const ceiling = Math.max((goal ?? 24) * 1.6, (labor ?? 0) * 1.1, 1);
  const fillPct = labor != null ? Math.min(100, (labor / ceiling) * 100) : 0;
  const goalPct = goal != null ? Math.min(100, (goal / ceiling) * 100) : null;

  return (
    <div
      className={cn(
        "rounded-xl bg-white p-5 ring-1 ring-zinc-200",
        highlight && over && "ring-2 ring-sonic/40",
        highlight && !over && "ring-2 ring-ok/40"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-midnight">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            sd.bg,
            sd.text
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", sd.dot)} />
          {sd.label}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className={cn("text-4xl font-bold tabular-nums", accent)}>{fmtPct(labor)}</div>
          <div className="text-xs text-zinc-500">
            labor · goal {fmtPct(goal)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">Var to chart</div>
          <div className={cn("text-lg font-bold tabular-nums", accent)}>
            {fmtSignedPts(band?.variance_pts)}
          </div>
        </div>
      </div>

      {/* Goal bar */}
      <div className="relative mt-3 h-2 rounded-full bg-zinc-100">
        <div
          className={cn("h-full rounded-full", over ? "bg-sonic" : "bg-ok")}
          style={{ width: `${fillPct}%` }}
        />
        {goalPct != null && (
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-midnight-400"
            style={{ left: `${goalPct}%` }}
            title={`chart goal ${fmtPct(goal)}`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>0%</span>
        <span>chart goal {fmtPct(goal)}</span>
      </div>

      {/* Sub-metrics */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-100 pt-4 text-sm">
        <Metric label={salesLabel} value={fmtMoney(band?.sales)} />
        <Metric label="$ Over Chart" value={fmtSignedMoney(band?.dollars_over_chart)} over={over} />
        <Metric label="Hours Over Chart" value={fmtSignedHours(band?.hours_over_chart)} over={over} />
        <Metric label="Chart $ Allowed" value={fmtMoney(band?.chart_dollars_allowed)} />
        {band?.avg_wage != null && <Metric label="Avg Wage" value={`${fmtMoneyCents(band.avg_wage)}/hr`} />}
      </dl>
    </div>
  );
}

function Metric({ label, value, over = false }: { label: string; value: string; over?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", over ? "text-sonic-700" : "text-midnight")}>
        {value}
      </dd>
    </div>
  );
}
