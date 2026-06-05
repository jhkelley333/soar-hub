// Walkthrough builder — template list. Card grid with status, quick
// activate/deactivate, preview, duplicate, and an entry to the wizard.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, FileText, Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  duplicateTemplate,
  getTemplate,
  listTemplates,
  setTemplateActive,
  templateStoreUsage,
  type TemplateSummary,
} from "./api";
import { WalkthroughPreview } from "../WalkthroughPreview";

function relUpdated(ts: string): string {
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TemplatesListPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const query = useQuery({ queryKey: ["wt-templates"], queryFn: listTemplates });
  const usage = useQuery({ queryKey: ["wt-template-usage"], queryFn: templateStoreUsage });

  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ["wt-template-preview", previewId],
    queryFn: () => getTemplate(previewId!),
    enabled: !!previewId,
  });
  const previewDraft = previewQuery.data;

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setTemplateActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wt-templates"] }),
    onError: (e) => toast.push(e instanceof Error ? e.message : "Update failed", "error"),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wt-templates"] });
      toast.push("Template duplicated as a draft", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Duplicate failed", "error"),
  });

  const newBtn = (
    <Button onClick={() => navigate("/admin/walkthrough-templates/new")}>
      <Plus className="mr-1.5 h-4 w-4" />
      New template
    </Button>
  );

  return (
    <div className={embedded ? undefined : "mx-auto max-w-5xl"}>
      {embedded ? (
        <div className="mb-4 flex justify-end">{newBtn}</div>
      ) : (
        <PageHeader
          title="Walkthrough templates"
          description="Checklists GMs run in the field. Build, version, and activate."
          actions={newBtn}
        />
      )}

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : query.error ? (
        <Card><CardBody className="text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Failed to load templates."}</CardBody></Card>
      ) : !query.data?.length ? (
        <EmptyState
          title="No templates yet"
          description="Create your first walkthrough checklist."
          action={newBtn}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              usedBy={usage.data?.[t.id] ?? 0}
              onEdit={() => navigate(`/admin/walkthrough-templates/${t.id}`)}
              onPreview={() => setPreviewId(t.id)}
              onToggle={() => toggle.mutate({ id: t.id, isActive: !t.isActive })}
              onDuplicate={() => duplicate.mutate(t.id)}
              busy={toggle.isPending || duplicate.isPending}
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
  usedBy,
  onEdit,
  onPreview,
  onToggle,
  onDuplicate,
  busy,
}: {
  t: TemplateSummary;
  usedBy: number;
  onEdit: () => void;
  onPreview: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300">
      <div className="flex items-start justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
          <FileText className="h-4.5 w-4.5" strokeWidth={1.75} />
        </div>
        <div className="flex items-center gap-1.5">
          {t.isPublic && <Badge tone="info">Public</Badge>}
          <Badge tone={t.isActive ? "success" : "warning"}>{t.isActive ? "Published" : "Draft"}</Badge>
        </div>
      </div>

      <button type="button" onClick={onEdit} className="mt-3 text-left">
        <div className="font-semibold text-midnight">{t.name}</div>
        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
          v{t.version} · {t.sectionCount} sections · {t.itemCount} items
        </div>
      </button>

      <div className="mt-3 flex items-end justify-between border-t border-zinc-100 pt-3">
        <Meta label="Used by" value={usedBy ? `${usedBy} store${usedBy === 1 ? "" : "s"}` : "—"} />
        <Meta label="Updated" value={relUpdated(t.updatedAt)} />
        <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <IconAction label="Preview" onClick={onPreview}><Eye className="h-4 w-4" /></IconAction>
        <IconAction label="Duplicate" onClick={onDuplicate} disabled={busy}><Copy className="h-4 w-4" /></IconAction>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-midnight disabled:opacity-50"
        >
          {t.isActive ? "Deactivate" : "Publish"}
        </button>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-xs font-medium text-zinc-600">{value}</div>
    </div>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-midnight disabled:opacity-50")}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
