// /paf/queue — Payroll-only processing queue. Status filter chips +
// employee/SSN search above the table; default view hides terminal
// states so Payroll's eyes go to the actionable rows.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, ChevronLeft, Download } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { listPafs } from "./api";
import { PafTable } from "./PafTable";
import {
  applyFilters,
  QueueFilters,
  statusCounts,
  type QueueFilterState,
} from "./QueueFilters";
import { downloadPafsCsv } from "./csv";
import { PayPeriodBadge } from "./PayPeriodBadge";
import type { PafRow, PafStatus } from "./types";

// Today's YYYY-MM-DD in local time (used to split current vs upcoming).
function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isUpcoming(p: PafRow, today: string): boolean {
  if (!p.pay_period_end) return false;
  if (p.status === "Processed" || p.status === "Rejected") return false;
  return p.pay_period_end > today;
}

const TERMINAL: PafStatus[] = ["Processed", "Rejected"];
const QUEUE_CHIPS: (PafStatus | "ALL")[] = [
  "ALL",
  "Pending",
  "Pending SDO Approval",
  "Pending VP Approval",
  "Needs Approval",
  "Approved",
];
const QUEUE_CHIPS_WITH_TERMINAL: (PafStatus | "ALL")[] = [
  ...QUEUE_CHIPS,
  "Processed",
  "Rejected",
];

export function PafQueuePage() {
  const [filters, setFilters] = useState<QueueFilterState>({
    status: "Pending",
    query: "",
  });
  const [includeTerminal, setIncludeTerminal] = useState(false);

  const query = useQuery({
    queryKey: ["paf-list"],
    queryFn: listPafs,
  });

  const allRows = query.data?.pafs ?? [];
  const today = todayISO();

  // Split: rows whose pay_period_end is in the future vs. current/past.
  // Upcoming rows render in their own card above the main queue so
  // Payroll has visibility into PAFs that are coming but not yet
  // actionable for this period (e.g. a DO submitted PTO for next
  // Sunday's check). Main queue excludes them to avoid double display.
  const { upcomingRows, currentRows } = useMemo(() => {
    const up: PafRow[] = [];
    const cur: PafRow[] = [];
    for (const r of allRows) {
      if (isUpcoming(r, today)) up.push(r);
      else cur.push(r);
    }
    return { upcomingRows: up, currentRows: cur };
  }, [allRows, today]);

  // Hide terminal rows from the chip-counts when terminal toggle is off
  // so the visible totals match what Payroll actually sees.
  const visibleSource = useMemo(
    () =>
      includeTerminal
        ? currentRows
        : currentRows.filter((p) => !TERMINAL.includes(p.status)),
    [currentRows, includeTerminal]
  );

  const counts = useMemo(() => statusCounts(visibleSource), [visibleSource]);
  const filtered = useMemo(
    () => applyFilters(visibleSource, filters),
    [visibleSource, filters]
  );

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="Payroll PAF Queue" description="Loading…" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Payroll PAF Queue" />
        <EmptyState
          title="Couldn't load PAFs"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }

  const pending = allRows.filter(
    (p) => p.status !== "Processed" && p.status !== "Rejected"
  ).length;

  return (
    <>
      <PageHeader
        title="Payroll PAF Queue"
        description={`${pending} PAF${pending === 1 ? "" : "s"} awaiting action.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PayPeriodBadge className="mr-1" />
            <Link to="/paf">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                All PAFs
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadPafsCsv(filtered, "paf-queue")}
              disabled={filtered.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Export CSV
            </Button>
            <label className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200">
              <input
                type="checkbox"
                checked={includeTerminal}
                onChange={(e) => setIncludeTerminal(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Include processed/rejected
            </label>
          </div>
        }
      />

      {upcomingRows.length > 0 && (
        <Card className="mb-4 border-amber-200 ring-amber-100">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
                Upcoming PAFs
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-800">
                  {upcomingRows.length}
                </span>
              </span>
            }
            description="Pay period end is in the future. Visible for awareness; act when their period arrives."
          />
          <CardBody className="!pt-0">
            <PafTable rows={upcomingRows} actions="process" />
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="p-3">
          <QueueFilters
            state={filters}
            onChange={setFilters}
            counts={counts}
            available={
              includeTerminal ? QUEUE_CHIPS_WITH_TERMINAL : QUEUE_CHIPS
            }
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="Inbox zero"
            description={
              filters.query || filters.status !== "ALL"
                ? "No PAFs match the current filter."
                : "Nothing in the queue right now."
            }
          />
        ) : (
          <PafTable rows={filtered} actions="process" />
        )}
      </Card>
    </>
  );
}
