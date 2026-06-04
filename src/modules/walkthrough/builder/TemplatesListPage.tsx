// Walkthrough builder — template list. Lists every template with quick
// activate/deactivate and an entry point to the wizard.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { getTemplate, listTemplates, setTemplateActive, type TemplateSummary } from "./api";
import { WalkthroughPreview } from "../WalkthroughPreview";

export function TemplatesListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: ["wt-templates"], queryFn: listTemplates });

  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ["wt-template-preview", previewId],
    queryFn: () => getTemplate(previewId!),
    enabled: !!previewId,
  });
  const previewDraft = previewQuery.data;

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      setTemplateActive(id, isActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wt-templates"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Update failed", "error"),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Walkthrough templates"
        description="Checklists GMs run in the field. Build, version, and activate."
        actions={
          <Button onClick={() => navigate("/admin/walkthrough-templates/new")}>
            <Plus className="mr-1.5 h-4 w-4" />
            New template
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : "Failed to load templates."}
          </CardBody>
        </Card>
      ) : !query.data?.length ? (
        <EmptyState
          title="No templates yet"
          description="Create your first walkthrough checklist."
          action={
            <Button onClick={() => navigate("/admin/walkthrough-templates/new")}>
              <Plus className="mr-1.5 h-4 w-4" />
              New template
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {query.data.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              onEdit={() => navigate(`/admin/walkthrough-templates/${t.id}`)}
              onPreview={() => setPreviewId(t.id)}
              onToggle={() => toggle.mutate({ id: t.id, isActive: !t.isActive })}
              toggling={toggle.isPending}
            />
          ))}
        </div>
      )}

      {previewId && previewDraft && (
        <WalkthroughPreview
          template={{
            id: previewDraft.id ?? previewId,
            name: previewDraft.name,
            type: previewDraft.type,
            version: previewDraft.version,
            sections: previewDraft.sections,
            scoring: previewDraft.scoring,
            tiers: previewDraft.tiers,
            globalRules: previewDraft.globalRules,
          }}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}

function TemplateCard({
  t,
  onEdit,
  onPreview,
  onToggle,
  toggling,
}: {
  t: TemplateSummary;
  onEdit: () => void;
  onPreview: () => void;
  onToggle: () => void;
  toggling: boolean;
}) {
  return (
    <Card>
      <CardBody className="flex items-center justify-between gap-4">
        <button type="button" onClick={onEdit} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-midnight">{t.name}</span>
            <Badge tone={t.isActive ? "success" : "neutral"}>
              {t.isActive ? "Active" : "Draft"}
            </Badge>
            <Badge tone="info">{t.type}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            v{t.version} · {t.sectionCount} sections · {t.itemCount} items ·{" "}
            updated {new Date(t.updatedAt).toLocaleDateString()}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onPreview}>
            <Eye className="mr-1 h-4 w-4" />
            Preview
          </Button>
          <Button variant="secondary" size="sm" onClick={onToggle} disabled={toggling}>
            {t.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
