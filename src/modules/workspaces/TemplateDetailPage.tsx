// /workspaces/:wsId/templates/:tplId — template detail. Shows the
// version list with publish state, lets the owner/editor:
//   - View any version (read-only for non-drafts)
//   - Fork a new draft from the currently published version
//   - Publish a draft (auto-archives previous published)
//   - Edit a draft inline (delegates to VersionEditor)
//
// The currently-published version is what new assignments pin to.

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, FileText, ClipboardCheck, GitBranch, Send,
  Archive, Edit, Eye, CheckCircle2, FileEdit,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getTemplate,
  createTemplateVersion,
  publishTemplateVersion,
  archiveTemplate,
} from "./api";
import { VersionEditor } from "./VersionEditor";
import type { TemplateVersion, VersionStatus } from "./types";

function statusBadge(status: VersionStatus): { tone: "neutral" | "info"; icon: React.ReactNode } {
  if (status === "published") return { tone: "info", icon: <CheckCircle2 className="h-3 w-3" /> };
  if (status === "draft")     return { tone: "neutral", icon: <FileEdit className="h-3 w-3" /> };
  return { tone: "neutral", icon: <Archive className="h-3 w-3" /> };
}

export function TemplateDetailPage() {
  const { wsId, tplId } = useParams<{ wsId: string; tplId: string }>();
  const navigate = useNavigate();
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["template", tplId],
    queryFn: () => getTemplate(tplId!),
    enabled: !!tplId,
  });

  const forkMut = useMutation({
    mutationFn: () => createTemplateVersion(tplId!),
    onSuccess: (res) => {
      query.refetch();
      setEditingVersionId(res.version.id);
    },
  });

  const publishMut = useMutation({
    mutationFn: (versionId: string) => publishTemplateVersion(versionId),
    onSuccess: () => query.refetch(),
  });

  const archiveMut = useMutation({
    mutationFn: () => archiveTemplate(tplId!),
    onSuccess: () => navigate(`/workspaces/${wsId}`),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load template: {(query.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to={`/workspaces/${wsId}`}>
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
      </Card>
    );
  }

  const { template, versions } = query.data;
  const Icon = template.type === "audit" ? ClipboardCheck : FileText;
  const draft     = versions.find((v) => v.status === "draft");
  const published = versions.find((v) => v.status === "published");

  // If user clicked Edit or View on a version, render the editor full-width.
  if (editingVersionId || viewingVersionId) {
    const versionId = editingVersionId || viewingVersionId!;
    const ver = versions.find((v) => v.id === versionId);
    return (
      <VersionEditor
        templateId={tplId!}
        templateName={template.name}
        templateType={template.type}
        version={ver!}
        readOnly={!editingVersionId}
        onBack={() => { setEditingVersionId(null); setViewingVersionId(null); query.refetch(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/workspaces/${wsId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to workspace
        </Link>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-gray-400" />
              {template.name}
            </span>
          }
          description={template.description ?? undefined}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={template.type === "audit" ? "warning" : "neutral"}>
                {template.type}
              </Badge>
              {template.is_archived && <Badge tone="neutral">archived</Badge>}
            </div>
          }
        />
      </div>

      {template.type === "audit" && template.audit_pass_threshold != null && (
        <Card className="p-3 text-sm bg-amber-50/50 border-amber-200">
          <strong>Audit settings:</strong>{" "}
          Pass threshold {template.audit_pass_threshold}%
          {template.critical_fails_audit && " · critical-fail overrides"}
        </Card>
      )}

      {/* Quick-action banner */}
      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <strong>{versions.length}</strong> version{versions.length === 1 ? "" : "s"} ·{" "}
          {published ? (
            <>v{published.version_number} is currently <Badge tone="info">published</Badge></>
          ) : (
            <>no published version yet</>
          )}
          {draft && <> · v{draft.version_number} is a <Badge tone="neutral">draft</Badge></>}
        </div>
        <div className="flex items-center gap-2">
          {!draft && (
            <Button
              onClick={() => forkMut.mutate()}
              disabled={forkMut.isPending}
              variant="primary"
            >
              <GitBranch className="h-4 w-4 mr-1" />
              {published ? "Fork new draft" : "Create draft"}
            </Button>
          )}
          {draft && (
            <Button
              onClick={() => setEditingVersionId(draft.id)}
              variant="primary"
            >
              <Edit className="h-4 w-4 mr-1" /> Edit draft
            </Button>
          )}
        </div>
      </Card>

      {/* Versions list */}
      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-gray-200">
          {versions.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              onView={() => setViewingVersionId(v.id)}
              onEdit={() => setEditingVersionId(v.id)}
              onPublish={() => publishMut.mutate(v.id)}
              publishing={publishMut.isPending}
            />
          ))}
        </div>
      </Card>

      {!template.is_archived && (
        <Card className="p-4">
          <Button
            variant="secondary"
            onClick={() => {
              if (confirm("Archive this template? Assignments using existing published versions stay valid, but the template is hidden from the default list.")) {
                archiveMut.mutate();
              }
            }}
          >
            <Archive className="h-4 w-4 mr-1" /> Archive template
          </Button>
        </Card>
      )}
    </div>
  );
}

function VersionRow({
  version, onView, onEdit, onPublish, publishing,
}: {
  version: TemplateVersion;
  onView: () => void;
  onEdit: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const sb = statusBadge(version.status);

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">v{version.version_number}</span>
          <Badge tone={sb.tone}>
            <span className="flex items-center gap-1">{sb.icon} {version.status}</span>
          </Badge>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          Created {new Date(version.created_at).toLocaleString()}
          {version.published_at && ` · published ${new Date(version.published_at).toLocaleString()}`}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {version.status === "draft" ? (
          <>
            <Button variant="secondary" onClick={onEdit}>
              <Edit className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button onClick={onPublish} disabled={publishing}>
              <Send className="h-4 w-4 mr-1" /> {publishing ? "Publishing..." : "Publish"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onView}>
            <Eye className="h-4 w-4 mr-1" /> View
          </Button>
        )}
      </div>
    </div>
  );
}
