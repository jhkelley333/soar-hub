// Automations tab inside /workspaces/:id. Lists automation rules
// (trigger → optional condition → action) with active toggle,
// run-now (dry-run on the manual path), edit, delete.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Zap, Power, PowerOff, Edit, Trash2, PlayCircle,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import {
  listAutomations, toggleAutomation, deleteAutomation, runAutomationNow,
} from "./api";
import { AutomationEditorModal } from "./AutomationEditorModal";
import type { WorkspaceAutomation } from "./types";

function triggerSummary(t: Record<string, unknown>): string {
  const kind = String(t?.kind ?? "");
  if (kind === "on_submit") return "When a submission lands";
  if (kind === "on_score_below") {
    const th = t.threshold != null ? `${t.threshold}%` : "?";
    return `When audit scores below ${th}`;
  }
  if (kind === "on_cap_overdue") {
    const g = t.grace_hours != null ? ` (+${t.grace_hours}h grace)` : "";
    return `When a CAP goes overdue${g}`;
  }
  if (kind === "on_cap_reopened") {
    const n = t.min_reopens != null ? ` ×${t.min_reopens}+` : "";
    return `When a CAP is reopened${n}`;
  }
  if (kind === "on_repeat_finding") {
    const n = t.min_occurrences != null ? ` (${t.min_occurrences}+)` : "";
    return `When a repeat finding hits${n}`;
  }
  if (kind === "scheduled") return `Scheduled (${t.cron ?? "?"})`;
  return kind || "—";
}

function actionSummary(a: Record<string, unknown>): string {
  const kind = String(a?.kind ?? "");
  if (kind === "send_email") {
    if (a.to_role) return `Email role: ${a.to_role}`;
    if (Array.isArray(a.to_emails)) return `Email ${(a.to_emails as string[]).length} address(es)`;
    if (Array.isArray(a.to_user_ids)) return `Email ${(a.to_user_ids as string[]).length} user(s)`;
    return "Email";
  }
  if (kind === "notify_in_app") {
    if (a.to_role) return `Notify role: ${a.to_role}`;
    if (Array.isArray(a.to_user_ids)) return `Notify ${(a.to_user_ids as string[]).length} user(s)`;
    return "Notify in-app";
  }
  if (kind === "create_assignment") return "Create assignment";
  if (kind === "create_cap")        return "Create CAP";
  if (kind === "log_only")          return "Log only (no side effect)";
  return kind || "—";
}

export function AutomationsTab({
  workspaceId, canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<WorkspaceAutomation | null>(null);

  const query = useQuery({
    queryKey: ["workspace-automations", workspaceId],
    queryFn: () => listAutomations(workspaceId),
  });

  const toggleMut = useMutation({
    mutationFn: (args: { id: string; is_active: boolean }) =>
      toggleAutomation(args.id, args.is_active),
    onSuccess: () => query.refetch(),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => query.refetch(),
  });

  const runMut = useMutation({
    mutationFn: (id: string) => runAutomationNow(id),
    onSuccess: (res) => {
      const msg = res.message || (res.dry_run ? "Ran (dry-run)" : "Triggered");
      alert(msg);
      query.refetch();
    },
    onError: (e) => alert((e as Error)?.message ?? "Run-now failed."),
  });

  const automations = query.data?.automations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold">Automations ({automations.length})</h3>
        {canEdit && (
          <Button onClick={() => { setEditing(null); setShowEditor(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New automation
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

      {query.isSuccess && !automations.length && (
        <EmptyState
          title={<><Zap className="h-6 w-6 inline mr-2" /> No automations yet</>}
          description={
            canEdit
              ? "Wire up a trigger → action rule. E.g. 'when a CAP goes overdue, email the DO.'"
              : "An owner or editor will configure automations here."
          }
        />
      )}

      {automations.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {automations.map((a) => (
              <Row
                key={a.id}
                auto={a}
                canEdit={canEdit}
                onToggle={() => toggleMut.mutate({ id: a.id, is_active: !a.is_active })}
                onEdit={() => { setEditing(a); setShowEditor(true); }}
                onDelete={() => {
                  if (confirm(`Delete automation "${a.name}"? Past fires stay in the activity log; future events will no longer trigger this rule.`)) {
                    delMut.mutate(a.id);
                  }
                }}
                onRunNow={() => {
                  if (confirm(`Run "${a.name}" now? Manual runs are dry-run by default — check the alert for the outcome.`)) {
                    runMut.mutate(a.id);
                  }
                }}
                togglePending={toggleMut.isPending}
                deletePending={delMut.isPending}
                runPending={runMut.isPending}
              />
            ))}
          </div>
        </Card>
      )}

      <AutomationEditorModal
        workspaceId={workspaceId}
        existing={editing}
        open={showEditor}
        onClose={() => { setShowEditor(false); setEditing(null); }}
        onSaved={() => { setShowEditor(false); setEditing(null); query.refetch(); }}
      />
    </div>
  );
}

function Row({
  auto, canEdit, onToggle, onEdit, onDelete, onRunNow,
  togglePending, deletePending, runPending,
}: {
  auto: WorkspaceAutomation;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  togglePending: boolean;
  deletePending: boolean;
  runPending: boolean;
}) {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="font-medium text-sm truncate">{auto.name}</span>
          <Badge tone={auto.is_active ? "success" : "neutral"}>
            {auto.is_active ? "active" : "paused"}
          </Badge>
        </div>
        <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
          <span>{triggerSummary(auto.trigger)}</span>
          <span>→</span>
          <span>{actionSummary(auto.action)}</span>
          {auto.condition && (
            <>
              <span>·</span>
              <span className="italic">with condition</span>
            </>
          )}
        </div>
        <div className="text-xs text-gray-500">
          Fired {auto.fire_count}×
          {auto.last_fired_at && ` · last ${new Date(auto.last_fired_at).toLocaleString()}`}
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="secondary"
            onClick={onRunNow}
            disabled={runPending}
            title="Test run (dry-run)"
          >
            <PlayCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            onClick={onToggle}
            disabled={togglePending}
            title={auto.is_active ? "Pause" : "Resume"}
          >
            {auto.is_active ? (
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
            title="Delete automation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
