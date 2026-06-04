// Walkthrough review — corrective actions. List with an inline work panel:
// expand a row to see origin photos, advance status, and log resolution notes.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  getCapaPhotos,
  listCorrectiveActions,
  updateCorrectiveAction,
  type CapaRow,
  type CapaStatus,
} from "./api";
import { PriorityChip, StatusChip } from "./tierUi";

type FilterId = "open_only" | "all" | CapaStatus;
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "open_only", label: "Open" },
  { id: "verified", label: "Verified" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

// Allowed forward transitions per current status.
const NEXT: Record<CapaStatus, { to: CapaStatus; label: string }[]> = {
  open: [{ to: "in_progress", label: "Start" }],
  in_progress: [{ to: "verified", label: "Mark verified" }],
  verified: [{ to: "closed", label: "Close" }, { to: "in_progress", label: "Reopen" }],
  closed: [{ to: "in_progress", label: "Reopen" }],
};

export function CorrectiveActionsTab() {
  const [filter, setFilter] = useState<FilterId>("open_only");
  const query = useQuery({
    queryKey: ["wt-capa", filter],
    queryFn: () => listCorrectiveActions({ status: filter }),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition",
              filter === f.id
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
        <EmptyState title="No corrective actions" description="Nothing matches this filter." />
      ) : (
        <div className="space-y-2">
          {query.data.map((ca) => (
            <CapaCard key={ca.id} ca={ca} />
          ))}
        </div>
      )}
    </div>
  );
}

function CapaCard({ ca }: { ca: CapaRow }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState(ca.resolutionNotes ?? "");

  const photos = useQuery({
    queryKey: ["wt-capa-photos", ca.id],
    queryFn: () => getCapaPhotos(ca.originPhotoIds),
    enabled: open && ca.originPhotoIds.length > 0,
  });

  const mutate = useMutation({
    mutationFn: (patch: { status?: CapaStatus; resolutionNotes?: string }) =>
      updateCorrectiveAction(ca.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wt-capa"] });
      toast.push("Corrective action updated", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Update failed", "error"),
  });

  const overdue = ca.dueAt && new Date(ca.dueAt) < new Date() && ca.status !== "closed";

  return (
    <div className="rounded-lg bg-white ring-1 ring-zinc-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-midnight">{ca.title}</span>
            <PriorityChip priority={ca.priority} />
            <StatusChip status={ca.status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>{ca.storeNumber} · {ca.storeName}</span>
            <span className="font-mono text-[11px]">{ca.sourceItemCode}</span>
            <span>Owner: {ca.ownerName}</span>
            {ca.dueAt && (
              <span className={cn(overdue && "font-medium text-red-600")}>
                Due {new Date(ca.dueAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-400 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-zinc-100 p-3">
          {ca.originPhotoIds.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Origin photos
              </div>
              {photos.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(photos.data ?? []).map((p) =>
                    p.url ? (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                        <img
                          src={p.url}
                          alt=""
                          className="h-20 w-20 rounded-md object-cover ring-1 ring-zinc-200"
                        />
                      </a>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Resolution notes
            </span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (ca.resolutionNotes ?? "")) mutate.mutate({ resolutionNotes: notes });
              }}
              placeholder="What was done…"
              className="mt-1 w-full rounded-md ring-1 ring-inset ring-zinc-200 bg-white px-3 py-2 text-sm text-midnight outline-none focus:ring-2 focus:ring-accent resize-none"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {NEXT[ca.status].map((t) => (
              <Button
                key={t.to}
                size="sm"
                variant={t.to === "closed" ? "primary" : "secondary"}
                disabled={mutate.isPending}
                onClick={() => mutate.mutate({ status: t.to })}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
