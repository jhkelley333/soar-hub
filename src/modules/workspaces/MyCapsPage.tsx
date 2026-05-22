// /caps — personal cross-workspace CAP queue. Lists CAPs where the
// caller is either the assignee (owns the fix) or the verifier
// (signs off on the fix). Defaults to open work; toggle to include
// closed/verified for history.
//
// Rendered inline (with `embedded` prop) inside the Workspaces page's
// My CAPs tab — in that case we skip the PageHeader so the outer
// page header isn't doubled.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon, Clock, CheckCircle2, AlertTriangle, Inbox, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { listMyCaps } from "./api";
import type { CorrectiveActionPlan, CapStatus } from "./types";

type RichCap = CorrectiveActionPlan & {
  workspaces?: { id: string; name: string } | null;
  assignee?: { id: string; full_name: string | null; email: string | null } | null;
  verifier?: { id: string; full_name: string | null; email: string | null } | null;
  store?: { id: string; store_number: string | null; name: string | null } | null;
  question?: { id: string; question_text: string } | null;
};

function statusTone(s: CapStatus): "neutral" | "info" | "warning" | "success" | "danger" {
  if (s === "verified" || s === "closed") return "success";
  if (s === "proof_submitted")            return "info";
  if (s === "reopened")                    return "danger";
  if (s === "in_progress")                return "info";
  return "warning"; // open
}

function statusIcon(s: CapStatus) {
  if (s === "verified" || s === "closed") return CheckCircle2;
  if (s === "reopened")                    return RefreshCw;
  if (s === "proof_submitted")             return Clock;
  return AlertOctagon;
}

export function MyCapsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [includeClosed, setIncludeClosed] = useState(false);
  const { profile } = useAuth();

  const query = useQuery({
    queryKey: ["my-caps", includeClosed],
    queryFn: () => listMyCaps(includeClosed),
  });

  const caps = (query.data?.caps ?? []) as RichCap[];

  // Split into "needs my action" (assignee on open/in_progress/reopened,
  // verifier on proof_submitted) and "watching" (verifier on assignee's
  // open work; assignee on proof_submitted waiting for verify).
  const needsAction: RichCap[] = [];
  const watching: RichCap[] = [];
  for (const c of caps) {
    const meAssignee = profile?.id === c.assignee_id;
    const meVerifier = profile?.id === c.verifier_id;
    if (meAssignee && (c.status === "open" || c.status === "in_progress" || c.status === "reopened")) {
      needsAction.push(c);
    } else if (meVerifier && c.status === "proof_submitted") {
      needsAction.push(c);
    } else {
      watching.push(c);
    }
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="My CAPs"
          description="Corrective action plans you own (assignee) or verify."
        />
      )}

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(e) => setIncludeClosed(e.target.checked)}
          className="rounded"
        />
        Include closed / verified
      </label>

      {query.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
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
          description={
            includeClosed
              ? "You have no corrective action plans on record."
              : "Nothing to fix — toggle 'Include closed' to see history."
          }
        />
      )}

      {needsAction.length > 0 && (
        <Section
          title="Needs your action"
          tone="warning"
          subtitle="Assigned CAPs awaiting your start/proof, or proofs awaiting your verify."
          caps={needsAction}
        />
      )}

      {watching.length > 0 && (
        <Section
          title="Watching"
          tone="neutral"
          subtitle="CAPs you're involved with but don't currently own."
          caps={watching}
        />
      )}
    </div>
  );
}

function Section({
  title, subtitle, tone, caps,
}: {
  title: string;
  subtitle: string;
  tone: "warning" | "neutral";
  caps: RichCap[];
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className={
          "text-sm font-semibold flex items-center gap-2 " +
          (tone === "warning" ? "text-amber-700" : "text-gray-700")
        }>
          {tone === "warning" && <AlertTriangle className="h-4 w-4" />}
          {title} ({caps.length})
        </h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-gray-200">
          {caps.map((c) => <Row key={c.id} cap={c} />)}
        </div>
      </Card>
    </div>
  );
}

function Row({ cap }: { cap: RichCap }) {
  const Icon = statusIcon(cap.status);
  const due = cap.due_at ? new Date(cap.due_at) : null;
  const overdue = due && due < new Date() && !["verified", "closed"].includes(cap.status);

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
                  <RefreshCw className="h-3 w-3" /> reopened ×{cap.reopened_count}
                </span>
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{cap.workspaces?.name ?? "—"}</span>
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
