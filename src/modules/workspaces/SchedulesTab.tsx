// Schedules tab inside /workspaces/:id. Lists recurring-assignment
// schedules: cadence summary, last/next spawn, active toggle. The
// sweeper Netlify function picks up active schedules and spawns
// assignments — this UI just configures them.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, CalendarClock, Power, PowerOff, Edit, Trash2,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import {
  listSchedules, toggleSchedule, deleteSchedule, listTemplates,
} from "./api";
import { ScheduleEditorModal } from "./ScheduleEditorModal";
import type { WorkspaceSchedule, WorkspaceTemplate, Cadence } from "./types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cadenceSummary(s: WorkspaceSchedule): string {
  const t = s.spawn_time?.slice(0, 5) ?? "08:00";
  if (s.cadence === "daily") return `Every day at ${t}`;
  if (s.cadence === "weekly") {
    return `Every ${DAY_NAMES[s.day_of_week ?? 1] ?? "?"} at ${t}`;
  }
  if (s.cadence === "biweekly") {
    return `Every other ${DAY_NAMES[s.day_of_week ?? 1] ?? "?"} at ${t}`;
  }
  if (s.cadence === "monthly") {
    return `Day ${s.day_of_month ?? "?"} of each month at ${t}`;
  }
  if (s.cadence === "quarterly") {
    return `Day ${s.day_of_month ?? "?"} of each quarter at ${t}`;
  }
  return s.cadence as string;
}

function assigneeSummary(rule: Record<string, unknown>): string {
  const kind = String(rule?.kind ?? "");
  if (kind === "fixed") return `fixed user (${String(rule.user_id ?? "").slice(0, 8)}…)`;
  if (kind === "role_relative") return `${rule.role} at ${rule.anchor}`;
  if (kind === "per_store") return `${rule.role_in_store} at each ${rule.scope_kind}`;
  return kind || "—";
}

export function SchedulesTab({
  workspaceId, canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSchedule | null>(null);

  const query = useQuery({
    queryKey: ["workspace-schedules", workspaceId],
    queryFn: () => listSchedules(workspaceId),
  });

  const tplQuery = useQuery({
    queryKey: ["workspace-templates", workspaceId, false],
    queryFn: () => listTemplates(workspaceId, false),
  });
  const templates: WorkspaceTemplate[] = tplQuery.data?.templates ?? [];

  const toggleMut = useMutation({
    mutationFn: (args: { id: string; is_active: boolean }) =>
      toggleSchedule(args.id, args.is_active),
    onSuccess: () => query.refetch(),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => query.refetch(),
  });

  const schedules = query.data?.schedules ?? [];

  const tplById = new Map(templates.map((t) => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold">Schedules ({schedules.length})</h3>
        {canEdit && (
          <Button
            onClick={() => { setEditing(null); setShowEditor(true); }}
            disabled={!templates.some((t) => !t.is_archived)}
            title={
              templates.some((t) => !t.is_archived)
                ? "Create a recurring schedule"
                : "Create at least one published template first"
            }
          >
            <Plus className="h-4 w-4 mr-1" /> New schedule
          </Button>
        )}
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

      {query.isSuccess && !schedules.length && (
        <EmptyState
          title={<><CalendarClock className="h-6 w-6 inline mr-2" /> No schedules yet</>}
          description={
            canEdit
              ? "Set up a recurring schedule to auto-spawn assignments on a cadence (daily / weekly / monthly / quarterly)."
              : "An owner or editor will configure schedules here."
          }
        />
      )}

      {schedules.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {schedules.map((s) => (
              <Row
                key={s.id}
                schedule={s}
                template={tplById.get(s.template_id)}
                canEdit={canEdit}
                onToggle={() => toggleMut.mutate({ id: s.id, is_active: !s.is_active })}
                onEdit={() => { setEditing(s); setShowEditor(true); }}
                onDelete={() => {
                  if (confirm("Delete this schedule? Future assignments stop spawning. Existing assignments are unaffected.")) {
                    delMut.mutate(s.id);
                  }
                }}
                togglePending={toggleMut.isPending}
                deletePending={delMut.isPending}
              />
            ))}
          </div>
        </Card>
      )}

      <ScheduleEditorModal
        workspaceId={workspaceId}
        templates={templates.filter((t) => !t.is_archived)}
        existing={editing}
        open={showEditor}
        onClose={() => { setShowEditor(false); setEditing(null); }}
        onSaved={() => { setShowEditor(false); setEditing(null); query.refetch(); }}
      />
    </div>
  );
}

function Row({
  schedule, template, canEdit, onToggle, onEdit, onDelete, togglePending, deletePending,
}: {
  schedule: WorkspaceSchedule;
  template: WorkspaceTemplate | undefined;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  togglePending: boolean;
  deletePending: boolean;
}) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">
            {template?.name ?? "Unknown template"}
          </span>
          <Badge tone={schedule.is_active ? "success" : "neutral"}>
            {schedule.is_active ? "active" : "paused"}
          </Badge>
          {template?.type && (
            <Badge tone={template.type === "audit" ? "warning" : "neutral"}>
              {template.type}
            </Badge>
          )}
        </div>
        <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
          <span>{cadenceSummary(schedule)} ({schedule.spawn_tz})</span>
          <span>·</span>
          <span>Due {schedule.due_after_hours}h after spawn</span>
          <span>·</span>
          <span>Assignee: {assigneeSummary(schedule.assignee_rule)}</span>
        </div>
        <div className="text-xs text-gray-500">
          {schedule.last_spawned_at
            ? `Last spawned ${new Date(schedule.last_spawned_at).toLocaleString()}`
            : "Never spawned yet"}
          {schedule.next_spawn_at && (
            <> · next {new Date(schedule.next_spawn_at).toLocaleString()}</>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="secondary"
            onClick={onToggle}
            disabled={togglePending}
            title={schedule.is_active ? "Pause" : "Resume"}
          >
            {schedule.is_active ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Edit className="h-4 w-4" />
          </Button>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-50"
            title="Delete schedule"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// Re-exported for callers that want the type for the Cadence dropdown.
export type { Cadence };
