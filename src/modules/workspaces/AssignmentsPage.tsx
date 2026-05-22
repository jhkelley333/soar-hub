// /assignments — cross-workspace "what's on my plate" queue. Defaults
// to open work (pending + in_progress + overdue) and groups by due
// bucket (overdue / today / this week / later / no due date). Each
// row deep-links to /assignments/:id where the user starts the form.
//
// Also rendered inline (with `embedded` prop) inside the Workspaces
// page's My Assignments tab — in that case we skip the PageHeader so
// the outer page header isn't doubled.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList, AlertTriangle, Calendar, CalendarClock, Clock, FileText, ClipboardCheck, Plus,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listMyAssignments } from "./api";
import { StartAdHocModal } from "./StartAdHocModal";
import type { WorkspaceAssignment, AssignmentStatus } from "./types";

type StatusFilter = "open" | "submitted" | "cancelled" | "all";

const FILTER_OPTIONS: Array<{ key: StatusFilter; label: string; statuses: string }> = [
  { key: "open",      label: "Open",      statuses: "pending,in_progress,overdue" },
  { key: "submitted", label: "Submitted", statuses: "submitted" },
  { key: "cancelled", label: "Cancelled", statuses: "cancelled" },
  { key: "all",       label: "All",       statuses: "pending,in_progress,overdue,submitted,cancelled" },
];

type Bucket = "overdue" | "today" | "this_week" | "later" | "no_due";
const BUCKET_ORDER: Bucket[] = ["overdue", "today", "this_week", "later", "no_due"];

function bucketFor(due_at: string | null, status: AssignmentStatus): Bucket {
  if (!due_at) return "no_due";
  const now = new Date();
  const due = new Date(due_at);
  if (status === "overdue" || due < now) return "overdue";
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  if (due <= endOfToday) return "today";
  const endOfWeek = new Date(now); endOfWeek.setDate(endOfWeek.getDate() + 7);
  if (due <= endOfWeek) return "this_week";
  return "later";
}

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue:   "Overdue",
  today:     "Due today",
  this_week: "Due this week",
  later:     "Later",
  no_due:    "No due date",
};

const BUCKET_ICON: Record<Bucket, typeof AlertTriangle> = {
  overdue:   AlertTriangle,
  today:     CalendarClock,
  this_week: Calendar,
  later:     Calendar,
  no_due:    Clock,
};

function statusTone(s: AssignmentStatus): "neutral" | "info" | "warning" | "danger" | "success" {
  if (s === "overdue")     return "danger";
  if (s === "in_progress") return "info";
  if (s === "submitted")   return "success";
  if (s === "cancelled")   return "neutral";
  return "warning"; // pending
}

export function AssignmentsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [showStartModal, setShowStartModal] = useState(false);
  const statuses = FILTER_OPTIONS.find((f) => f.key === filter)!.statuses;

  const query = useQuery({
    queryKey: ["my-assignments", statuses],
    queryFn: () => listMyAssignments(statuses),
  });

  const assignments = query.data?.assignments ?? [];
  const grouped = new Map<Bucket, WorkspaceAssignment[]>();
  for (const a of assignments) {
    const b = bucketFor(a.due_at, a.status);
    const arr = grouped.get(b) ?? [];
    arr.push(a);
    grouped.set(b, arr);
  }

  const startNewButton = (
    <Button onClick={() => setShowStartModal(true)}>
      <Plus className="h-4 w-4 mr-1" />
      Start new
    </Button>
  );

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="My assignments"
          description="Forms and audits assigned to you across all workspaces."
          actions={startNewButton}
        />
      )}

      {/* Status filter chips. When embedded the page header is suppressed,
          so render the Start-new button alongside the chips instead. */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
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
        {embedded && <div className="ml-auto">{startNewButton}</div>}
      </div>

      {showStartModal && <StartAdHocModal onClose={() => setShowStartModal(false)} />}

      {query.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}

      {query.isError && (
        <Card className="p-6 text-red-600">
          Failed to load assignments: {(query.error as Error)?.message ?? "Unknown"}
        </Card>
      )}

      {query.isSuccess && !assignments.length && (
        <EmptyState
          title={<><ClipboardList className="h-6 w-6 inline mr-2" /> Nothing on your plate</>}
          description={
            filter === "open"
              ? "You're all caught up. Submitted and cancelled work is hidden — switch filters above to see it."
              : "No assignments match this filter."
          }
        />
      )}

      {BUCKET_ORDER.map((bucket) => {
        const items = grouped.get(bucket);
        if (!items?.length) return null;
        const Icon = BUCKET_ICON[bucket];
        const isOverdue = bucket === "overdue";
        return (
          <div key={bucket} className="space-y-2">
            <div className={
              "flex items-center gap-2 text-sm font-medium " +
              (isOverdue ? "text-red-600" : "text-gray-700")
            }>
              <Icon className="h-4 w-4" />
              {BUCKET_LABEL[bucket]} ({items.length})
            </div>
            <Card className="p-0 overflow-hidden">
              <div className="divide-y divide-gray-200">
                {items.map((a) => <AssignmentRow key={a.id} a={a} />)}
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function AssignmentRow({ a }: { a: WorkspaceAssignment }) {
  const tpl = a.workspace_templates;
  const Icon = tpl?.type === "audit" ? ClipboardCheck : FileText;
  const dueLabel = a.due_at
    ? new Date(a.due_at).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "—";

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
            <span>{a.workspaces?.name ?? "—"}</span>
            {a.store?.store_number && (
              <>
                <span>·</span>
                <span>Store #{a.store.store_number}</span>
              </>
            )}
            <span>·</span>
            <span>Due {dueLabel}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
