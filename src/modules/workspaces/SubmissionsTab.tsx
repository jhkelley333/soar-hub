// Submissions tab inside /workspaces/:id. Workspace-scoped list of
// submitted forms + audits. Status filter chips by signoff_status.
// Click row → /submissions/:id.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, ClipboardCheck, Inbox, AlertTriangle,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listSubmissions } from "./api";
import type { WorkspaceSubmission, SignoffStatus } from "./types";

type StatusFilter = "open" | "approved" | "rejected" | "all";

const FILTERS: Array<{ key: StatusFilter; label: string; statuses?: string }> = [
  { key: "open",     label: "Open",     statuses: "pending_review,in_review,revision_requested" },
  { key: "approved", label: "Approved", statuses: "approved" },
  { key: "rejected", label: "Rejected", statuses: "rejected" },
  { key: "all",      label: "All" },
];

function statusTone(s: SignoffStatus): "neutral" | "info" | "warning" | "success" | "danger" {
  if (s === "approved")            return "success";
  if (s === "rejected")            return "danger";
  if (s === "revision_requested")  return "warning";
  if (s === "in_review")           return "info";
  return "warning"; // pending_review
}

type RichSubmission = WorkspaceSubmission & {
  assignment?: {
    id: string;
    template_id: string;
    assignee_id: string;
    workspace_id: string;
    store_id: string | null;
  } | null;
  submitter?: {
    id: string; full_name: string | null; email: string | null;
  } | null;
};

export function SubmissionsTab({ workspaceId }: { workspaceId: string }) {
  const [filter, setFilter] = useState<StatusFilter>("open");

  const query = useQuery({
    queryKey: ["workspace-submissions", workspaceId, filter],
    queryFn: () => listSubmissions({
      workspace_id: workspaceId,
      signoff_status: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
  });

  const subs = (query.data?.submissions ?? []) as RichSubmission[];

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

      {query.isSuccess && !subs.length && (
        <EmptyState
          title={<><Inbox className="h-6 w-6 inline mr-2" /> No submissions</>}
          description="Filled-out forms and audits show up here once their assignees submit."
        />
      )}

      {subs.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {subs.map((s) => <Row key={s.id} s={s} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ s }: { s: RichSubmission }) {
  const isAudit = s.audit_outcome != null || s.audit_score_possible != null;
  const Icon = isAudit ? ClipboardCheck : FileText;
  const submitterLabel =
    s.submitter?.full_name || s.submitter?.email || s.submitted_by_id?.slice(0, 8) || "—";

  return (
    <Link
      to={`/submissions/${s.id}`}
      className="block px-4 py-3 hover:bg-gray-50 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="font-medium text-sm truncate">
              Submission v{s.version_number}
            </span>
            <Badge tone={statusTone(s.signoff_status)}>
              {s.signoff_status.replace("_", " ")}
            </Badge>
            {s.audit_outcome === "fail_critical" && (
              <Badge tone="danger">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> critical fail
                </span>
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>by <strong>{submitterLabel}</strong></span>
            <span>·</span>
            <span>{new Date(s.submitted_at).toLocaleString()}</span>
            {s.audit_score_percent != null && (
              <>
                <span>·</span>
                <span>{s.audit_score_percent}%</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
