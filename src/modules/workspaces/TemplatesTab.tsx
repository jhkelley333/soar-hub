// Templates tab on /workspaces/:id. Lists templates in the workspace
// with type + question count + current version status. Editors land
// on /workspaces/:wsId/templates/:tplId.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText, ClipboardCheck, Archive } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { listTemplates } from "./api";
import { CreateTemplateModal } from "./CreateTemplateModal";
import type { WorkspaceTemplate } from "./types";

export function TemplatesTab({
  workspaceId, canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = useQuery({
    queryKey: ["workspace-templates", workspaceId, includeArchived],
    queryFn: () => listTemplates(workspaceId, includeArchived),
  });

  const templates = query.data?.templates ?? [];
  const active = templates.filter((t) => !t.is_archived);
  const archived = templates.filter((t) => t.is_archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Templates ({active.length})</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded"
            />
            Include archived
          </label>
          {canEdit && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> New template
            </Button>
          )}
        </div>
      </div>

      {query.isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}

      {query.isSuccess && !templates.length && (
        <EmptyState
          title={<><FileText className="h-6 w-6 inline mr-2" /> No templates yet</>}
          description={
            canEdit
              ? "Create your first template to build a form or audit."
              : "An owner or editor will create templates here."
          }
        />
      )}

      {active.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((t) => (
            <TemplateCard key={t.id} workspaceId={workspaceId} template={t} />
          ))}
        </div>
      )}

      {includeArchived && archived.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-3 text-sm font-medium text-gray-500 dark:text-gray-400">
            <Archive className="h-4 w-4" />
            Archived ({archived.length})
          </div>
          <div className="grid gap-3 md:grid-cols-2 opacity-70">
            {archived.map((t) => (
              <TemplateCard key={t.id} workspaceId={workspaceId} template={t} />
            ))}
          </div>
        </>
      )}

      <CreateTemplateModal
        workspaceId={workspaceId}
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

function TemplateCard({
  workspaceId, template,
}: {
  workspaceId: string;
  template: WorkspaceTemplate;
}) {
  const Icon = template.type === "audit" ? ClipboardCheck : FileText;
  return (
    <Link
      to={`/workspaces/${workspaceId}/templates/${template.id}`}
      className="block group"
    >
      <Card className="p-4 hover:shadow-md transition-shadow h-full">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-gray-400 shrink-0" />
            <h4 className="font-medium truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {template.name}
            </h4>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge tone={template.type === "audit" ? "warning" : "neutral"}>
              {template.type}
            </Badge>
            {template.is_archived && <Badge tone="neutral">archived</Badge>}
          </div>
        </div>
        {template.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
            {template.description}
          </p>
        )}
        {template.type === "audit" && template.audit_pass_threshold != null && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            Pass threshold: {template.audit_pass_threshold}%
            {template.critical_fails_audit && " · critical fails the audit"}
          </p>
        )}
      </Card>
    </Link>
  );
}
