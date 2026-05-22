// Assignments tab inside /workspaces/:id. Workspace-scoped view:
// "who owes what" for owners + admins. Filter by status. Click row →
// /assignments/:id. Owners can hand-create assignments via the modal.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText, ClipboardCheck, Inbox } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listAssignments } from "./api";
import { CreateAssignmentModal } from "./CreateAssignmentModal";
import type { WorkspaceAssignment, AssignmentStatus, WorkspaceMember } from "./types";

type StatusFilter = "open" | "submitted" | "cancelled" | "all";

const FILTERS: Array<{ key: StatusFilter; label: string; statuses?: string }> = [
  { key: "open",      label: "Open",      statuses: "pending,in_progress,overdue" },
  { key: "submitted", label: "Submitted", statuses: "submitted" },
  { key: "cancelled", label: "Cancelled", statuses: "cancelled" },
  { key: "all",       label: "All" },
];

function statusTone(s: AssignmentStatus): "neutral" | "info" | "warning" | "danger" | "success" {
  if (s === "overdue")     return "danger";
  if (s === "in_progress") return "info";
  if (s === "submitted")   return "success";
  if (s === "cancelled")   return "neutral";
  return "warning";
}

export function AssignmentsTab({
  workspaceId, members, canCreate,
}: {
  workspaceId: string;
  members: WorkspaceMember[];
  canCreate: boolean;
}) {
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ["workspace-assignments", workspaceId, filter],
    queryFn: () => listAssignments({
      workspace_id: workspaceId,
      status: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
  });

  const assignments = query.data?.assignments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
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
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Assign work
          </Button>
        )}
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

      {query.isSuccess && !assignments.length && (
        <EmptyState
          title={<><Inbox className="h-6 w-6 inline mr-2" /> No assignments</>}
          description={
            canCreate
              ? "Schedules auto-spawn assignments, or click Assign work to hand-create one."
              : "Nothing here yet."
          }
        />
      )}

      {assignments.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {assignments.map((a) => <Row key={a.id} a={a} />)}
          </div>
        </Card>
      )}

      <CreateAssignmentModal
        workspaceId={workspaceId}
        members={members}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          query.refetch();
        }}
      />
    </div>
  );
}

function Row({ a }: { a: WorkspaceAssignment }) {
  const tpl = a.workspace_templates;
  const Icon = tpl?.type === "audit" ? ClipboardCheck : FileText;
  const assigneeLabel =
    a.assignee?.full_name || a.assignee?.email || a.assignee_id.slice(0, 8);

  return (
    <Link
      to={`/assignments/${a.id}`}
      className="block px-4 py-3 hover:bg-gray-50 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="font-medium text-sm truncate">
              {tpl?.name ?? "Untitled template"}
            </span>
            <Badge tone={statusTone(a.status)}>{a.status.replace("_", " ")}</Badge>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>Assigned to <strong>{assigneeLabel}</strong></span>
            {a.store?.store_number && (
              <>
                <span>·</span>
                <span>Store #{a.store.store_number}</span>
              </>
            )}
            <span>·</span>
            <span>
              {a.due_at
                ? `Due ${new Date(a.due_at).toLocaleDateString()}`
                : "No due date"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
