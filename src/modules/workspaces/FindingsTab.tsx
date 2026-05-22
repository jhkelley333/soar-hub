// Findings tab inside /workspaces/:id. Surfaces repeat findings —
// the same question failing N+ times at one store. Backend
// auto-aggregates these; this UI lets owners see them, drill into
// occurrences, and acknowledge them.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MapPin, Inbox, RefreshCw,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listRepeatFindings, acknowledgeRepeatFinding } from "./api";
import type { RepeatFinding } from "./types";

type RichFinding = RepeatFinding & {
  store?: { id: string; store_number: string | null; name: string | null } | null;
  question?: { id: string; question_text: string; is_critical: boolean; weight: number | null } | null;
  acknowledged_by?: { id: string; full_name: string | null; email: string | null } | null;
};

export function FindingsTab({ workspaceId }: { workspaceId: string }) {
  const [unackedOnly, setUnackedOnly] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["workspace-findings", workspaceId, unackedOnly],
    queryFn: () => listRepeatFindings({
      workspace_id: workspaceId,
      unacknowledged: unackedOnly,
    }),
  });

  const findings = (query.data?.findings ?? []) as RichFinding[];

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group by store for visual scanning.
  const byStore = new Map<string, RichFinding[]>();
  for (const f of findings) {
    const key = f.store?.store_number
      ? `#${f.store.store_number}${f.store.name ? ` — ${f.store.name}` : ""}`
      : (f.store_id?.slice(0, 8) ?? "(no store)");
    const arr = byStore.get(key) ?? [];
    arr.push(f);
    byStore.set(key, arr);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Repeat findings ({findings.length})</h3>
          <p className="text-xs text-gray-500">
            The same question failing multiple times at one store. Auto-aggregated by the backend.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={unackedOnly}
            onChange={(e) => setUnackedOnly(e.target.checked)}
            className="rounded"
          />
          Unacknowledged only
        </label>
      </div>

      {query.isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {query.isError && (
        <Card className="p-6 text-red-600">
          Failed to load: {(query.error as Error)?.message ?? "Unknown"}
        </Card>
      )}

      {query.isSuccess && !findings.length && (
        <EmptyState
          title={<><Inbox className="h-6 w-6 inline mr-2" /> No repeat findings</>}
          description={
            unackedOnly
              ? "Nothing repeating — flip the toggle to see acknowledged ones."
              : "No repeat findings on record for this workspace."
          }
        />
      )}

      {Array.from(byStore.entries()).map(([storeLabel, items]) => (
        <div key={storeLabel} className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
            <MapPin className="h-4 w-4 text-gray-400" /> {storeLabel}
            <span className="text-xs text-gray-500 font-normal ml-1">({items.length})</span>
          </h4>
          <Card className="p-0 overflow-hidden">
            <div className="divide-y divide-gray-200">
              {items.map((f) => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  expanded={expanded.has(f.id)}
                  onToggle={() => toggle(f.id)}
                  onAcknowledged={() => query.refetch()}
                />
              ))}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

function FindingRow({
  finding, expanded, onToggle, onAcknowledged,
}: {
  finding: RichFinding;
  expanded: boolean;
  onToggle: () => void;
  onAcknowledged: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ackMut = useMutation({
    mutationFn: () => acknowledgeRepeatFinding(finding.id, note.trim() || undefined),
    onSuccess: () => { setError(null); setNote(""); onAcknowledged(); },
    onError: (e) => setError((e as Error)?.message ?? "Acknowledge failed."),
  });

  const isAcked = !!finding.acknowledged_at;
  const ackedBy =
    finding.acknowledged_by?.full_name || finding.acknowledged_by?.email || null;

  return (
    <div className="px-4 py-3">
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
            )}
            <span className="font-medium text-sm truncate">
              {finding.question?.question_text ?? "(question deleted)"}
            </span>
            <Badge tone="danger">
              <span className="inline-flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> ×{finding.occurrence_count}
              </span>
            </Badge>
            {finding.question?.is_critical && <Badge tone="warning">critical</Badge>}
            {isAcked && (
              <Badge tone="success">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> acked
                </span>
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            First {new Date(finding.first_occurred_at).toLocaleDateString()}
            {" · "}last {new Date(finding.last_occurred_at).toLocaleDateString()}
            {isAcked && finding.acknowledged_at && (
              <> · acked by <strong>{ackedBy ?? "—"}</strong> {new Date(finding.acknowledged_at).toLocaleDateString()}</>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pl-6 space-y-3">
          {finding.acknowledged_note && (
            <div className="text-xs italic text-gray-700 bg-green-50 border border-green-200 rounded p-2">
              "{finding.acknowledged_note}"
            </div>
          )}

          {/* Occurrences */}
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
              Occurrences ({finding.occurrence_count})
            </div>
            <ul className="space-y-1 text-xs">
              {finding.occurrences.map((occ, i) => (
                <li key={i} className="flex items-center gap-2">
                  <AlertTriangle className={"h-3 w-3 shrink-0 " + (occ.was_critical ? "text-red-600" : "text-amber-600")} />
                  <Link
                    to={`/submissions/${occ.submission_id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {new Date(occ.failed_at).toLocaleString()}
                  </Link>
                  {occ.was_critical && (
                    <span className="text-red-600 font-medium">critical</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Acknowledge form */}
          {!isAcked && (
            <div className="pt-2 border-t space-y-2">
              <label className="text-xs font-medium text-gray-700">
                Acknowledge with an optional note
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What's the plan? (optional but recommended)"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                onClick={() => ackMut.mutate()}
                disabled={ackMut.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {ackMut.isPending ? "Acknowledging..." : "Acknowledge"}
              </Button>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
