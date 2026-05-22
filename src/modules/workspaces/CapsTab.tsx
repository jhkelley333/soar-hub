// CAPs tab inside /workspaces/:id. Workspace-wide CAP list with
// status filter chips. Reopened-count and overdue surface inline so
// owners can spot trouble spots without drilling into every row.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon, RefreshCw, CheckCircle2, Clock, Inbox,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listCaps } from "./api";
import type { CorrectiveActionPlan, CapStatus } from "./types";

type RichCap = CorrectiveActionPlan & {
  assignee?: { id: string; full_name: string | null; email: string | null } | null;
  verifier?: { id: string; full_name: string | null; email: string | null } | null;
  store?: { id: string; store_number: string | null; name: string | null } | null;
  question?: { id: string; question_text: string; is_critical: boolean } | null;
};

type StatusFilter = "open" | "proof_submitted" | "verified" | "all";

const FILTERS: Array<{ key: StatusFilter; label: string; statuses?: string }> = [
  { key: "open",            label: "Open",            statuses: "open,in_progress,reopened" },
  { key: "proof_submitted", label: "Awaiting verify", statuses: "proof_submitted" },
  { key: "verified",        label: "Closed",          statuses: "verified,closed" },
  { key: "all",             label: "All" },
];

function statusTone(s: CapStatus): "neutral" | "info" | "warning" | "success" | "danger" {
  if (s === "verified" || s === "closed") return "success";
  if (s === "proof_submitted")            return "info";
  if (s === "reopened")                    return "danger";
  if (s === "in_progress")                return "info";
  return "warning";
}

function statusIcon(s: CapStatus) {
  if (s === "verified" || s === "closed") return CheckCircle2;
  if (s === "reopened")                    return RefreshCw;
  if (s === "proof_submitted")             return Clock;
  return AlertOctagon;
}

export function CapsTab({ workspaceId }: { workspaceId: string }) {
  const [filter, setFilter] = useState<StatusFilter>("open");

  const query = useQuery({
    queryKey: ["workspace-caps", workspaceId, filter],
    queryFn: () => listCaps({
      workspace_id: workspaceId,
      status: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
  });

  const caps = (query.data?.caps ?? []) as RichCap[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={
              "px-3 py-1.5 text-sm rounded-full border transition " +
              (filter === opt.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {query.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      )}

      {query.isError && (
        <Card className="p-6 text-red-600">
          Failed to load: {(query.error as Error)?.message ?? "Unknown"}
        </Card>
      )}

      {query.isSuccess && !caps.length && (
        <EmptyState
          title={<><Inbox className="h-6 w-6 inline mr-2" /> No CAPs</>}
          description="Corrective action plans spawn when audit submissions fail a question with auto-CAP turned on."
        />
      )}

      {caps.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {caps.map((c) => <Row key={c.id} cap={c} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ cap }: { cap: RichCap }) {
  const Icon = statusIcon(cap.status);
  const due = cap.due_at ? new Date(cap.due_at) : null;
  const overdue = due && due < new Date() && !["verified", "closed"].includes(cap.status);
  const assignee =
    cap.assignee?.full_name || cap.assignee?.email || cap.assignee_id.slice(0, 8);

  return (
    <Link
      to={`/caps/${cap.id}`}
      className="block px-4 py-3 hover:bg-gray-50 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="font-medium text-sm truncate">
              {cap.question?.question_text ?? "(question deleted)"}
            </span>
            <Badge tone={statusTone(cap.status)}>{cap.status.replace("_", " ")}</Badge>
            {cap.reopened_count > 0 && (
              <Badge tone="danger">
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> ×{cap.reopened_count}
                </span>
              </Badge>
            )}
            {cap.question?.is_critical && <Badge tone="warning">critical</Badge>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>Assigned to <strong>{assignee}</strong></span>
            {cap.store?.store_number && (
              <>
                <span>·</span>
                <span>Store #{cap.store.store_number}</span>
              </>
            )}
            <span>·</span>
            <span className={overdue ? "text-red-600 font-medium" : ""}>
              {due ? `Due ${due.toLocaleDateString()}${overdue ? " (overdue)" : ""}` : "No due date"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
