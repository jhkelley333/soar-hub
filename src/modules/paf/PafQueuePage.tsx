// /paf/queue — Payroll-only processing queue. Status filter chips +
// employee/SSN search above the table; default view hides terminal
// states so Payroll's eyes go to the actionable rows.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
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
import type { PafStatus } from "./types";

const TERMINAL: PafStatus[] = ["Processed", "Rejected"];
const QUEUE_CHIPS: (PafStatus | "ALL")[] = [
  "ALL",
  "Pending",
  "Pending SDO Approval",
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

  // Hide terminal rows from the chip-counts when terminal toggle is off
  // so the visible totals match what Payroll actually sees.
  const visibleSource = useMemo(
    () =>
      includeTerminal
        ? allRows
        : allRows.filter((p) => !TERMINAL.includes(p.status)),
    [allRows, includeTerminal]
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
          <div className="flex flex-wrap gap-2">
            <Link to="/paf">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                All PAFs
              </Button>
            </Link>
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
