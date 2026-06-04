// Walkthrough review — submissions queue (the DO's inbox of submitted walks).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Flag } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { listReviewQueue, type ReviewFilters, type ReviewQueueRow } from "./api";
import { ScoreBadge, StatusChip, TierChip } from "./tierUi";

const FILTERS: { id: NonNullable<ReviewFilters["status"]>; label: string }[] = [
  { id: "submitted", label: "Needs review" },
  { id: "needs_revision", label: "Returned" },
  { id: "approved", label: "Approved" },
  { id: "all", label: "All" },
];

export function SubmissionsTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReviewFilters["status"]>("submitted");
  const query = useQuery({
    queryKey: ["wt-review-queue", status],
    queryFn: () => listReviewQueue({ status }),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition",
              status === f.id
                ? "bg-midnight text-white ring-midnight"
                : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : "Failed to load."}
          </CardBody>
        </Card>
      ) : !query.data?.length ? (
        <EmptyState title="Nothing here" description="No walkthroughs match this filter." />
      ) : (
        <div className="space-y-2">
          {query.data.map((row) => (
            <Row key={row.id} row={row} onOpen={() => navigate(`/walkthrough-review/s/${row.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row, onOpen }: { row: ReviewQueueRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-lg bg-white p-3 text-left ring-1 ring-zinc-200 transition hover:ring-accent"
    >
      <div className="w-12 text-center">
        <ScoreBadge score={row.score} tier={row.tier} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-midnight">
            {row.storeNumber} · {row.storeName}
          </span>
          <TierChip tier={row.tier} />
          <StatusChip status={row.status} />
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
          <span>{row.submitterName}</span>
          {row.submittedAt && <span>{new Date(row.submittedAt).toLocaleDateString()}</span>}
          {row.flagCount > 0 && (
            <span className="inline-flex items-center gap-1 text-red-600">
              <Flag className="h-3 w-3" strokeWidth={2} />
              {row.flagCount}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
    </button>
  );
}
