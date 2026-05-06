// /paf/queue — Payroll-only processing queue. Hides Approved/Rejected/
// Processed by default; toggle to show terminal states.

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

export function PafQueuePage() {
  const [includeTerminal, setIncludeTerminal] = useState(false);

  const query = useQuery({
    queryKey: ["paf-list"],
    queryFn: listPafs,
  });

  const filtered = useMemo(() => {
    const all = query.data?.pafs ?? [];
    return includeTerminal
      ? all
      : all.filter((p) => p.status !== "Processed" && p.status !== "Rejected");
  }, [query.data, includeTerminal]);

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

  const pending = (query.data.pafs ?? []).filter(
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
        {filtered.length === 0 ? (
          <EmptyState
            title="Inbox zero"
            description={
              includeTerminal
                ? "No PAFs match."
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
