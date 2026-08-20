// /admin/definitions — manage the metric-definitions registry. Add/edit the
// plain-language explanations the reusable <MetricInfo term="…" /> tooltip reads
// from across the app. Adding a definition here makes it available everywhere
// with no deploy. Admin-only.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchDefinitions, upsertDefinition, deleteDefinition, type MetricDefinition } from "./api";

type Draft = { key: string; label: string; definition: string; source: string; category: string; sort_order: number };
const emptyDraft = (): Draft => ({ key: "", label: "", definition: "", source: "", category: "", sort_order: 100 });

export function DefinitionsAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["metric-definitions"], queryFn: fetchDefinitions, staleTime: 60_000 });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["metric-definitions"] });
  const save = useMutation({
    mutationFn: (d: Draft) => upsertDefinition(d),
    onSuccess: () => { toast.push("Saved.", "success"); invalidate(); setEditing(null); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });
  const del = useMutation({
    mutationFn: (key: string) => deleteDefinition(key),
    onSuccess: () => { toast.push("Deleted.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  const openNew = () => { setEditing(emptyDraft()); setIsNew(true); };
  const openEdit = (d: MetricDefinition) => { setEditing({ key: d.key, label: d.label, definition: d.definition, source: d.source ?? "", category: d.category ?? "", sort_order: d.sort_order }); setIsNew(false); };

  return (
    <>
      <PageHeader
        title="Metric definitions"
        description="Plain-language explanations the ⓘ info tooltips read from. Add one and it's available app-wide — no deploy."
        actions={<Button size="sm" onClick={openNew}><Plus className="mr-1 h-3.5 w-3.5" /> New definition</Button>}
      />

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load definitions" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (q.data?.definitions.length ?? 0) === 0 ? (
        <EmptyState title="No definitions yet" description="Add one to power the ⓘ tooltips." />
      ) : (
        <div className="space-y-2">
          {q.data!.definitions.map((d) => (
            <Card key={d.key}>
              <CardBody className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="text-sm font-semibold text-midnight">{d.label}</span>
                    <span className="font-mono text-[11px] text-zinc-400">{d.key}</span>
                    {d.category && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">{d.category}</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600">{d.definition}</p>
                  {d.source && <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Source · {d.source}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-600"
                    onClick={() => { if (window.confirm(`Delete "${d.label}"?`)) del.mutate(d.key); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={isNew ? "New definition" : `Edit — ${editing?.label ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={save.isPending || !editing?.key || !editing?.label || !editing?.definition}
              onClick={() => editing && save.mutate(editing)}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="def-key">Key *</Label>
              <Input id="def-key" value={editing.key} disabled={!isNew}
                onChange={(e) => setEditing({ ...editing, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                placeholder="daily_completion" />
              <p className="mt-0.5 text-[11px] text-zinc-400">Lowercase letters, numbers, underscores. Used as <span className="font-mono">&lt;MetricInfo term="…" /&gt;</span>. Can't change after creating.</p>
            </div>
            <div>
              <Label htmlFor="def-label">Label *</Label>
              <Input id="def-label" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="Daily Completion" />
            </div>
            <div>
              <Label htmlFor="def-text">Definition *</Label>
              <textarea id="def-text" rows={4} value={editing.definition}
                onChange={(e) => setEditing({ ...editing, definition: e.target.value })}
                className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Plain-language explanation for someone seeing this for the first time." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="def-source">Source</Label>
                <Input id="def-source" value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} placeholder="Daily count feed" />
              </div>
              <div>
                <Label htmlFor="def-cat">Category</Label>
                <Input id="def-cat" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="count" />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
