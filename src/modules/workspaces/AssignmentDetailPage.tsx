// /assignments/:id — single assignment view. Shows metadata + the
// CTAs that gate the submission flow:
//   • pending     → Start (flips to in_progress) + Open form link
//   • in_progress → Open submission form (→ /assignments/:id/fill)
//   • submitted   → View submission (placeholder until slice 5)
//
// Cancel is available to the assignee on pending/in_progress
// (backend enforces).

import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Play, FileText, ClipboardCheck, MapPin, Calendar,
  User as UserIcon, XCircle, Eye,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getAssignment, startAssignment, cancelAssignment,
} from "./api";
import type { AssignmentStatus } from "./types";

function statusTone(s: AssignmentStatus): "neutral" | "info" | "warning" | "danger" | "success" {
  if (s === "overdue")     return "danger";
  if (s === "in_progress") return "info";
  if (s === "submitted")   return "success";
  if (s === "cancelled")   return "neutral";
  return "warning";
}

export function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const query = useQuery({
    queryKey: ["assignment", id],
    queryFn: () => getAssignment(id!),
    enabled: !!id,
  });

  const startMut = useMutation({
    mutationFn: () => startAssignment(id!),
    onSuccess: () => query.refetch(),
  });

  const cancelMut = useMutation({
    mutationFn: (reason: string) => cancelAssignment(id!, reason || undefined),
    onSuccess: () => query.refetch(),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load assignment: {(query.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/assignments">
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
      </Card>
    );
  }

  const a = query.data.assignment;
  const tpl = a.workspace_templates;
  const Icon = tpl?.type === "audit" ? ClipboardCheck : FileText;
  const isAssignee = profile?.id === a.assignee_id;
  const canCancel = isAssignee && (a.status === "pending" || a.status === "in_progress");

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </button>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-gray-400" />
              {tpl?.name ?? "Untitled template"}
            </span>
          }
          actions={<Badge tone={statusTone(a.status)}>{a.status.replace("_", " ")}</Badge>}
        />
      </div>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Details</h3>
        <dl className="text-sm space-y-2">
          <Row label="Type" value={tpl?.type ?? "—"} />
          <Row
            label="Workspace"
            value={
              a.workspace_id ? (
                <Link to={`/workspaces/${a.workspace_id}`} className="text-blue-600 hover:underline">
                  open workspace
                </Link>
              ) : "—"
            }
          />
          {a.store && (
            <Row
              label={<><MapPin className="inline h-3.5 w-3.5 mr-1" />Store</>}
              value={
                a.store.store_number
                  ? `#${a.store.store_number}${a.store.name ? ` — ${a.store.name}` : ""}`
                  : a.store.name || "—"
              }
            />
          )}
          <Row
            label={<><Calendar className="inline h-3.5 w-3.5 mr-1" />Due</>}
            value={a.due_at ? new Date(a.due_at).toLocaleString() : "—"}
          />
          <Row
            label={<><UserIcon className="inline h-3.5 w-3.5 mr-1" />Assignee</>}
            value={
              a.assignee
                ? `${a.assignee.full_name ?? a.assignee.email ?? a.assignee.id}`
                : "—"
            }
          />
          {a.started_at && (
            <Row label="Started" value={new Date(a.started_at).toLocaleString()} />
          )}
          {a.cancelled_at && (
            <Row label="Cancelled" value={new Date(a.cancelled_at).toLocaleString()} />
          )}
        </dl>
      </Card>

      {/* Action card */}
      {isAssignee && a.status === "pending" && (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">Ready to start?</h3>
          <p className="text-sm text-gray-600 mb-3">
            Starting marks this in-progress and opens the form. You can
            close the tab any time — answers auto-save in this browser
            until you submit.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => startMut.mutate()} disabled={startMut.isPending}>
              <Play className="h-4 w-4 mr-1" />
              {startMut.isPending ? "Starting..." : "Start"}
            </Button>
            <Link to={`/assignments/${a.id}/fill`}>
              <Button variant="secondary">
                <FileText className="h-4 w-4 mr-1" /> Open form without changing status
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {isAssignee && a.status === "in_progress" && (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">In progress</h3>
          <p className="text-sm text-gray-600 mb-3">
            Pick up where you left off. Answers auto-save locally until you
            hit Submit.
          </p>
          <Link to={`/assignments/${a.id}/fill`}>
            <Button>
              <FileText className="h-4 w-4 mr-1" /> Open submission form
            </Button>
          </Link>
        </Card>
      )}

      {a.status === "submitted" && (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">Submitted</h3>
          <p className="text-sm text-gray-600 mb-3">
            Sign-off review lands in the next slice.
          </p>
          <Button variant="secondary" disabled title="Submission view ships in the next slice">
            <Eye className="h-4 w-4 mr-1" /> View submission
          </Button>
        </Card>
      )}

      {canCancel && (
        <Card className="p-5">
          <h3 className="font-semibold mb-1 text-amber-700">Cancel this assignment</h3>
          <p className="text-sm text-gray-600 mb-3">
            Use this if the assignment was sent in error or no longer applies.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              const reason = prompt("Optional: why are you cancelling?") ?? "";
              if (confirm("Cancel this assignment?")) cancelMut.mutate(reason);
            }}
            disabled={cancelMut.isPending}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {cancelMut.isPending ? "Cancelling..." : "Cancel assignment"}
          </Button>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}
