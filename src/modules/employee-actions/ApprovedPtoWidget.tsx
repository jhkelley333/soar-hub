// Dashboard widget: a "who's out" look-ahead of approved PTO across the
// caller's stores. Reads the same scoped list the Employee Actions page uses
// and filters to fully-approved requests whose dates are current or within the
// next four weeks. Mirrors the BirthdayWidget card pattern.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { listEmployeeActions } from "./api";
import type { PtoRow } from "./types";

// Statuses that mean the time off is locked in (past the SDO/RVP approval).
const APPROVED = new Set(["SDO/RVP Approved", "PAF Submitted", "Closed"]);

const LOOK_AHEAD_DAYS = 28;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(`${start}T00:00:00`).toLocaleDateString("en-US", opts);
  if (!end || end === start) return s;
  const e = new Date(`${end}T00:00:00`).toLocaleDateString("en-US", opts);
  return `${s} – ${e}`;
}

export function ApprovedPtoWidget() {
  const query = useQuery({
    queryKey: ["ea-list", "approved-pto-widget"],
    queryFn: listEmployeeActions,
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const today = isoDay(new Date());
    const horizon = isoDay(new Date(Date.now() + LOOK_AHEAD_DAYS * 86_400_000));
    return (query.data?.ptoRequests ?? [])
      .filter(
        (p: PtoRow) =>
          APPROVED.has(p.status) &&
          p.pto_end_date >= today && // not already over
          p.pto_start_date <= horizon, // starts within the window
      )
      .sort((a, b) => a.pto_start_date.localeCompare(b.pto_start_date));
  }, [query.data]);

  return (
    <div className="mt-6">
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <CalendarOff className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
              Who's Out — Approved PTO
            </span>
          }
          description="Current and upcoming approved time off (next 4 weeks)."
        />
        <CardBody>
          {query.isLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : query.isError ? (
            <div className="text-sm text-red-700">
              {(query.error as Error)?.message ?? "Couldn't load PTO."}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-zinc-500">No approved PTO in the next four weeks.</div>
          ) : (
            <ul className="space-y-1">
              {rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-midnight">{p.employee_name}</span>
                  {p.position && <span className="text-xs text-zinc-400">{p.position}</span>}
                  <span className="text-xs text-zinc-500">
                    Store #{p.store_number}
                    {p.store_name ? ` — ${p.store_name}` : ""}
                  </span>
                  <span className="font-medium text-zinc-700">{fmtRange(p.pto_start_date, p.pto_end_date)}</span>
                  {p.status === "Closed" ? (
                    <Badge tone="success">Closed</Badge>
                  ) : (
                    <Badge tone="info">Approved</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
