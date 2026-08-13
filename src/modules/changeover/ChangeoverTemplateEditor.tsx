// Admin editor for the changeover checklist items. Add / edit / reorder /
// remove the questions per kind (DO / GM), grouped by section. Backs onto the
// changeover_template_items table (migration 0286). Editing here never touches
// in-progress checklists — those key their progress by item_key.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, ChevronDown, Trash2, Plus, X } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { deleteTemplateItem, moveTemplateItem, saveTemplateItem } from "./api";
import { useChangeoverTemplates } from "./useTemplates";
import type { ChangeoverKind, TemplateItem } from "./templates";

const KIND_LABEL: Record<ChangeoverKind, string> = { do: "DO changeover", gm: "GM changeover" };

export function ChangeoverTemplateEditor({ onClose }: { onClose: () => void }) {
  const { items, isLoading } = useChangeoverTemplates();
  const [kind, setKind] = useState<ChangeoverKind>("do");

  const sections = useMemo(() => {
    const forKind = items.filter((i) => i.kind === kind);
    const map = new Map<string, TemplateItem[]>();
    for (const it of forKind) (map.get(it.section) ?? map.set(it.section, []).get(it.section)!).push(it);
    return [...map.entries()]; // already ordered by the backend
  }, [items, kind]);

  return (
    <Modal open onClose={onClose} title="Edit changeover checklist" maxWidth="max-w-2xl">
      <div className="mb-3 flex gap-1 border-b border-zinc-200">
        {(["do", "gm"] as ChangeoverKind[]).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", kind === k ? "border-accent text-accent" : "border-transparent text-zinc-500 hover:text-zinc-700")}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {sections.map(([section, secItems]) => (
            <div key={section}>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500">{section}</div>
              <ul className="space-y-1.5">
                {secItems.map((it, i) => (
                  <ItemEditor key={it.id} it={it} isFirst={i === 0} isLast={i === secItems.length - 1} />
                ))}
              </ul>
              <AddItem kind={kind} section={section} />
            </div>
          ))}
          <AddItem kind={kind} newSection />
        </div>
      )}

      <div className="mt-4 flex justify-end border-t border-zinc-100 pt-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">Changes apply to new and in-progress checklists. Existing checked items are keyed and never lost when you edit or reorder.</p>
    </Modal>
  );
}

function ItemEditor({ it, isFirst, isLast }: { it: TemplateItem; isFirst: boolean; isLast: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(it.label);
  const [hint, setHint] = useState(it.hint ?? "");
  useEffect(() => { setLabel(it.label); setHint(it.hint ?? ""); }, [it.label, it.hint]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["changeover-templates"] });

  const save = useMutation({
    mutationFn: () => saveTemplateItem({ id: it.id, kind: it.kind, section: it.section, label: label.trim(), hint: hint.trim() || undefined }),
    onSuccess: invalidate,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  const move = useMutation({
    mutationFn: (dir: "up" | "down") => moveTemplateItem(it.id, dir),
    onSuccess: invalidate,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't reorder.", "error"),
  });
  const del = useMutation({
    mutationFn: () => deleteTemplateItem(it.id),
    onSuccess: invalidate,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  const saveIfChanged = () => { if (label.trim() && (label !== it.label || hint !== (it.hint ?? ""))) save.mutate(); };
  const cls = "w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none";

  return (
    <li className="flex items-start gap-1.5 rounded-lg bg-zinc-50 p-2 ring-1 ring-inset ring-zinc-100">
      <div className="flex flex-col">
        <button type="button" disabled={isFirst || move.isPending} onClick={() => move.mutate("up")} className="text-zinc-400 hover:text-accent disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={isLast || move.isPending} onClick={() => move.mutate("down")} className="text-zinc-400 hover:text-accent disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={saveIfChanged} className={cls} placeholder="Item / question" />
        <input value={hint} onChange={(e) => setHint(e.target.value)} onBlur={saveIfChanged} className={cn(cls, "text-xs text-zinc-500")} placeholder="Hint (optional)" />
      </div>
      <button type="button" onClick={() => { if (window.confirm(`Delete "${it.label}"?`)) del.mutate(); }} className="mt-0.5 text-zinc-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
    </li>
  );
}

function AddItem({ kind, section, newSection }: { kind: ChangeoverKind; section?: string; newSection?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [label, setLabel] = useState("");
  const [hint, setHint] = useState("");

  const add = useMutation({
    mutationFn: () => saveTemplateItem({ kind, section: (newSection ? sectionName : section)!.trim(), label: label.trim(), hint: hint.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["changeover-templates"] }); setLabel(""); setHint(""); setSectionName(""); if (newSection) setOpen(false); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't add.", "error"),
  });
  const ready = label.trim() && (newSection ? sectionName.trim() : true);
  const cls = "w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none";

  if (newSection && !open) {
    return <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"><Plus className="h-3.5 w-3.5" /> Add a section</button>;
  }
  return (
    <div className={cn("mt-1.5 space-y-1.5", newSection && "rounded-lg border border-dashed border-zinc-300 p-2")}>
      {newSection && (
        <div className="flex items-center gap-1.5">
          <input value={sectionName} onChange={(e) => setSectionName(e.target.value)} className={cls} placeholder="New section name" />
          <button type="button" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={cls} placeholder={newSection ? "First item" : "Add an item…"} onKeyDown={(e) => { if (e.key === "Enter" && ready) add.mutate(); }} />
        <Button size="sm" variant="secondary" onClick={() => add.mutate()} disabled={!ready || add.isPending}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
      {(newSection || label) && <input value={hint} onChange={(e) => setHint(e.target.value)} className={cn(cls, "text-xs text-zinc-500")} placeholder="Hint (optional)" />}
    </div>
  );
}
