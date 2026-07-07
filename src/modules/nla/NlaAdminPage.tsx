// Admin — Assessment Templates. Review every NLA instrument (all versions),
// edit wording inline, preview it exactly as a rater sees it, and clone a new
// version for structural changes (the picker serves the highest ACTIVE version
// per role). Text edits apply in place; removing a rated competency is blocked
// server-side and routed through clone-a-version instead.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ClipboardCheck, Copy, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  addNlaTemplateItem, cloneNlaTemplate, fetchNlaAdminTemplate, fetchNlaAdminTemplates,
  removeNlaTemplateItem, updateNlaTemplate, updateNlaTemplateItem,
} from "./api";
import { RATING_META, RATING_ORDER, type NlaTemplateItem, type Rating } from "./types";

const STATUS_META: Record<string, { label: string; chip: string }> = {
  active: { label: "Active", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  draft: { label: "Draft", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  retired: { label: "Retired", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

export function NlaAdminPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId
    ? <TemplateEditor templateId={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} />
    : <TemplateList onOpen={setOpenId} />;
}

// ── List ──────────────────────────────────────────────────────────────────────
function TemplateList({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["nla-admin-templates"], queryFn: fetchNlaAdminTemplates });
  if (q.isLoading) return <div className="mx-auto max-w-4xl space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /></div>;
  if (q.isError) return <EmptyState title="Could not load templates" description={(q.error as Error)?.message ?? "Try again."} />;
  const rows = q.data?.templates ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-bold text-heading">Assessment Templates</h1>
      </div>
      <p className="mb-5 text-sm text-ink-muted">
        The Next Level Assessment instruments, by role and version. Leaders always get the highest <em>active</em> version — edit wording in place, or clone a new version for bigger changes.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2">Template</th><th className="px-4 py-2">For role</th>
                <th className="px-4 py-2">Version</th><th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Competencies</th><th className="px-4 py-2">Used by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen(t.id)}>
                  <td className="px-4 py-2.5 font-semibold text-heading">{t.title}</td>
                  <td className="px-4 py-2.5 text-ink-2">{t.target_role.toUpperCase()}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-2">v{t.version}</td>
                  <td className="px-4 py-2.5"><StatusChip status={t.status} /></td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-2">{t.item_count}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{t.assessment_count} assessment{t.assessment_count === 1 ? "" : "s"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.chip)}>{m.label}</span>;
}

// ── Editor + preview ──────────────────────────────────────────────────────────
function TemplateEditor({ templateId, onBack, onOpen }: { templateId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["nla-admin-template", templateId], queryFn: () => fetchNlaAdminTemplate(templateId) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["nla-admin-template", templateId] });
    qc.invalidateQueries({ queryKey: ["nla-admin-templates"] });
    qc.invalidateQueries({ queryKey: ["nla-templates"] });
  };
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const patchTpl = useMutation({
    mutationFn: (p: Parameters<typeof updateNlaTemplate>[1]) => updateNlaTemplate(templateId, p),
    onSuccess: invalidate, onError: err,
  });
  const clone = useMutation({
    mutationFn: () => cloneNlaTemplate(templateId),
    onSuccess: (r) => { toast.push(`Cloned as draft v${r.version}. You are now editing the new version.`, "success"); invalidate(); onOpen(r.template_id); },
    onError: err,
  });

  const groups = useMemo(() => {
    const m = new Map<string, NlaTemplateItem[]>();
    for (const it of q.data?.items ?? []) { if (!m.has(it.category)) m.set(it.category, []); m.get(it.category)!.push(it); }
    return Array.from(m.entries());
  }, [q.data]);

  if (q.isLoading) return <div className="mx-auto max-w-4xl space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <EmptyState title="Could not load template" description={(q.error as Error)?.message ?? "Try again."} />;
  const { template, items, assessment_count } = q.data!;

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted transition hover:text-heading">
        <ChevronLeft className="h-4 w-4" /> Templates
      </button>

      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              {template.target_role.toUpperCase()} · v{template.version} · used by {assessment_count} assessment{assessment_count === 1 ? "" : "s"}
            </div>
            <input
              defaultValue={template.title}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== template.title) patchTpl.mutate({ title: v }); }}
              className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xl font-bold text-heading hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreview((p) => !p)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition",
                preview ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-ink-2 hover:border-accent")}>
              {preview ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{preview ? "Edit" : "Preview"}
            </button>
            <button disabled={clone.isPending} onClick={() => clone.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink-2 transition hover:border-accent disabled:opacity-40">
              <Copy className="h-4 w-4" />{clone.isPending ? "Cloning…" : "Clone as new version"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-ink-muted">Status</span>
          {(["draft", "active", "retired"] as const).map((s) => (
            <button key={s} onClick={() => template.status !== s && patchTpl.mutate({ status: s })}
              className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition",
                template.status === s ? STATUS_META[s].chip : "bg-surface text-ink-subtle ring-border hover:text-ink")}>
              {STATUS_META[s].label}
            </button>
          ))}
          {template.status === "draft" && <span className="text-[11px] text-ink-subtle">Drafts are invisible to leaders until set Active.</span>}
        </div>
      </div>

      {/* body */}
      <div className="mt-5">
        {preview ? (
          <PreviewInstrument items={items} title={template.title} role={template.target_role} />
        ) : (
          <div className="space-y-6">
            {groups.map(([cat, its]) => (
              <div key={cat}>
                <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle">{cat}</div>
                <div className="space-y-3">
                  {its.map((it) => <ItemEditor key={it.id} item={it} onChanged={invalidate} />)}
                </div>
              </div>
            ))}
            {adding ? (
              <AddItemForm templateId={templateId} onDone={() => setAdding(false)} onSaved={invalidate} />
            ) : (
              <button onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink-2 transition hover:border-accent">
                <Plus className="h-4 w-4" /> Add competency
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TA = "w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";

function ItemEditor({ item, onChanged }: { item: NlaTemplateItem; onChanged: () => void }) {
  const toast = useToast();
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const patch = useMutation({
    mutationFn: (p: Parameters<typeof updateNlaTemplateItem>[1]) => updateNlaTemplateItem(item.id, p),
    onSuccess: onChanged, onError: err,
  });
  const remove = useMutation({ mutationFn: () => removeNlaTemplateItem(item.id), onSuccess: onChanged, onError: err });

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-2">
        <input defaultValue={item.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== item.name) patch.mutate({ name: v }); }}
          className="flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-heading hover:border-border focus:border-accent focus:outline-none" />
        <button onClick={() => remove.mutate()} title="Remove competency"
          className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <label className="mt-2 block text-[11px] font-semibold text-ink-muted">Description
        <textarea defaultValue={item.description ?? ""} rows={2} placeholder="What great looks like for this competency."
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.description ?? "")) patch.mutate({ description: v || null }); }}
          className={cn(TA, "mt-1")} />
      </label>
      <label className="mt-2 block text-[11px] font-semibold text-ink-muted">Example (optional)
        <textarea defaultValue={item.example ?? ""} rows={2} placeholder="Observable behaviors raters can look for."
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.example ?? "")) patch.mutate({ example: v || null }); }}
          className={cn(TA, "mt-1")} />
      </label>
    </div>
  );
}

function AddItemForm({ templateId, onDone, onSaved }: { templateId: string; onDone: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => addNlaTemplateItem(templateId, { category: category.trim(), name: name.trim(), description: description.trim() || null }),
    onSuccess: () => { toast.push("Competency added.", "success"); onSaved(); onDone(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not add.", "error"),
  });
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-muted p-4">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Leadership)" className={cn(TA, "resize-auto")} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Competency name" className={cn(TA)} />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description (optional)" className={TA} />
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
        <button disabled={!category.trim() || !name.trim() || create.isPending} onClick={() => create.mutate()}
          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {create.isPending ? "Adding…" : "Add competency"}
        </button>
      </div>
    </div>
  );
}

// ── Preview — the instrument exactly as a rater sees it (nothing saves) ───────
function PreviewInstrument({ items, title, role }: { items: NlaTemplateItem[]; title: string; role: string }) {
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const groups = useMemo(() => {
    const m = new Map<string, NlaTemplateItem[]>();
    for (const it of items) { if (!m.has(it.category)) m.set(it.category, []); m.get(it.category)!.push(it); }
    return Array.from(m.entries());
  }, [items]);
  const done = Object.keys(ratings).length;

  return (
    <div>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
        Preview — this is exactly what a rater sees for “{title}”. Clicks here don’t save anything.
      </div>
      <div className="mb-4 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">Next Level Assessment · {role.toUpperCase()}</div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunk">
            <div className="h-full rounded-full bg-midnight transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">{done} / {items.length}</span>
        </div>
      </div>

      {groups.map(([cat, its]) => (
        <div key={cat} className="mb-6">
          <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle">{cat}</div>
          <div className="space-y-3">
            {its.map((it) => (
              <div key={it.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-heading">{it.name}</h3>
                    {it.description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{it.description}</p>}
                    {it.example && <p className="mt-1.5 text-xs italic text-ink-subtle">e.g. {it.example}</p>}
                  </div>
                  {ratings[it.competency_key] && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-200"><Check className="h-3 w-3 text-emerald-600" /></span>}
                </div>
                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  {RATING_ORDER.map((r) => {
                    const on = ratings[it.competency_key] === r;
                    return (
                      <button key={r} onClick={() => setRatings((prev) => ({ ...prev, [it.competency_key]: r }))}
                        className={cn("rounded-lg border px-3 py-2.5 text-left transition",
                          on ? "border-midnight bg-midnight text-white" : "border-border bg-surface hover:border-accent")}>
                        <div className="flex items-center gap-1.5">
                          <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", on ? "border-white bg-white" : "border-border")}>
                            {on && <Check className="h-2.5 w-2.5 text-midnight" />}
                          </span>
                          <span className="text-sm font-medium">{RATING_META[r].label}</span>
                        </div>
                        <div className={cn("mt-1 text-[11px] leading-snug", on ? "text-white/80" : "text-ink-subtle")}>{RATING_META[r].hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
