// PTO Report — per-employee quarterly vacation usage against the allowance
// (one week per quarter: GM 5 days, hourly 40 hours). Red quarter cells are
// over the allowance — those requests need RVP approval. Scoped like the
// rest of Employee Actions: leaders see their stores, org-wide roles see all.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchPtoReport, type PtoReportRow } from "./api";

const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";
const fmtUse = (n: number, unit: string) => (n === 0 ? "—" : `${n}${unit === "days" ? "d" : "h"}`);

export function PtoReportPanel() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["ea-pto-report", year], queryFn: () => fetchPtoReport(year) });

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) =>
      !needle || r.employee_name.toLowerCase().includes(needle) || r.store_number.includes(needle));
  }, [q.data, filter]);

  return (
    <Card>
      <CardBody>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <CalendarRange className="h-4 w-4 text-accent" /> PTO report
          </div>
          <div className="flex items-center gap-1.5">
            {[thisYear - 1, thisYear].map((y) => (
              <button key={y} onClick={() => setYear(y)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  year === y ? "bg-midnight text-white" : "border border-border bg-surface text-ink-2 hover:border-accent")}>
                {y}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 max-w-2xl text-[13px] text-ink-muted">
          Vacation used per quarter. Allowance is <strong>one week per quarter</strong> — GMs{" "}
          {q.data?.gm_quota_days ?? 5} days, hourly {q.data?.hourly_quota_hours ?? 40} hours. A{" "}
          <span className="font-semibold text-red-600">red</span> quarter is over the allowance and needs RVP approval.
        </p>

        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or store…"
          className={cn(FIELD, "mb-3 w-56")} />

        {q.isLoading ? (
          <p className="py-8 text-center text-[13px] text-ink-subtle">Loading…</p>
        ) : q.isError ? (
          <EmptyState title="Couldn't load the report" description={(q.error as Error)?.message ?? "Try again."} />
        ) : rows.length === 0 ? (
          <EmptyState title="No PTO this year" description={`No live requests with dates in ${year}.`} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2">Position</th>
                    {["Q1", "Q2", "Q3", "Q4"].map((h) => <th key={h} className="px-3 py-2 text-right">{h}</th>)}
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => <ReportRow key={`${r.employee_name}|${r.store_number}|${r.position}`} row={r} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ReportRow({ row: r }: { row: PtoReportRow }) {
  return (
    <tr>
      <td className="px-3 py-2.5">
        <span className="font-semibold text-heading">{r.employee_name}</span>
        {r.pending > 0 && (
          <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">
            {r.pending} pending
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-ink-2">#{r.store_number}</td>
      <td className="px-3 py-2.5 text-ink-muted">{r.position}</td>
      {r.quarters.map((v, i) => (
        <td key={i} className={cn("px-3 py-2.5 text-right tabular-nums",
          v > r.quota ? "font-bold text-red-600" : v > 0 ? "text-heading" : "text-ink-subtle")}>
          {fmtUse(v, r.unit)}
        </td>
      ))}
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-heading">{fmtUse(r.total, r.unit)}</td>
    </tr>
  );
}
