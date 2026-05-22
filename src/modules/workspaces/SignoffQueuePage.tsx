// /signoffs — cross-workspace "what's waiting on me to approve."
// Backed by listMySignoffs, which the server scopes to pending
// signoff rows where the caller is in candidate_user_ids. Each row
// links to /submissions/:id where the actual decision is made.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck, FileText, Inbox, AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listMySignoffs } from "./api";

// The listMySignoffs response shape has joined data the typed
// SubmissionSignoff doesn't model — we narrow inline rather than
// widen the canonical type for a single screen.
type QueueRow = {
  id: string;
  submission_id: string;
  step_number: number;
  created_at: string;
  step: { label: string | null } | null;
  submission: {
    id: string;
    submitted_at: string;
    signoff_status: string;
    audit_outcome: "pass" | "fail" | "fail_critical" | null;
    audit_score_percent: number | null;
    audit_critical_failed: boolean | null;
    assignment: {
      id: string;
      workspaces: { id: string; name: string } | null;
      workspace_templates: { id: string; name: string; type: "form" | "audit" } | null;
      store: { id: string; store_number: string | null; name: string | null } | null;
    } | null;
  } | null;
};

export function SignoffQueuePage() {
  const query = useQuery({
    queryKey: ["my-signoffs"],
    queryFn: () => listMySignoffs(),
  });

  const rows = (query.data?.signoffs ?? []) as unknown as QueueRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sign-off queue"
        description="Submissions waiting for your approval, across every workspace you cover."
      />

      {query.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {query.isError && (
        <Card className="p-6 text-red-600">
          Failed to load: {(query.error as Error)?.message ?? "Unknown"}
        </Card>
      )}

      {query.isSuccess && !rows.length && (
        <EmptyState
          title={<><Inbox className="h-6 w-6 inline mr-2" /> Nothing waiting on you</>}
          description="Submissions you're a candidate signer for will show up here when they need a decision."
        />
      )}

      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {rows.map((r) => <Row key={r.id} row={r} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ row }: { row: QueueRow }) {
  const sub = row.submission;
  const asn = sub?.assignment;
  const tpl = asn?.workspace_templates;
  const Icon = tpl?.type === "audit" ? ClipboardCheck : FileText;

  const auditFailed = !!sub?.audit_critical_failed
    || sub?.audit_outcome === "fail"
    || sub?.audit_outcome === "fail_critical";

  return (
    <Link
      to={`/submissions/${sub?.id}`}
      className="block px-4 py-3 hover:bg-gray-50 transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="font-medium text-sm truncate">
              {tpl?.name ?? "Untitled template"}
            </span>
            <Badge tone="warning">step {row.step_number}{row.step?.label ? ` — ${row.step.label}` : ""}</Badge>
            {auditFailed && (
              <Badge tone="danger">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {sub?.audit_outcome === "fail_critical" ? "fail (critical)" : "audit fail"}
                </span>
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{asn?.workspaces?.name ?? "—"}</span>
            {asn?.store?.store_number && (
              <>
                <span>·</span>
                <span>Store #{asn.store.store_number}</span>
              </>
            )}
            <span>·</span>
            <span>Submitted {sub?.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "—"}</span>
            {sub?.audit_score_percent != null && (
              <>
                <span>·</span>
                <span>Score {sub.audit_score_percent}%</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
