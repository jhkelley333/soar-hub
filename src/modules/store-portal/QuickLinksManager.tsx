// Admin — Quick Links editor for the Store Command Center. Two link kinds:
// a straight redirect (opens the URL in a new tab on the store screen) or an
// info panel. A panel is a composable list of items — link buttons, info text
// cards, and uploaded documents (the Coke Support pattern). Global across all
// stores; order with the arrows.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileText, Info, Link2, PanelsTopLeft, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { deletePortalLink, fetchPortalLinks, panelItems, savePortalLink, uploadPortalDoc, type AdminQuickLink, type PanelItem } from "./api";

export function QuickLinksManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<AdminQuickLink | "new" | null>(null);
  const q = useQuery({ queryKey: ["store-portal-quicklinks"], queryFn: fetchPortalLinks });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["store-portal-quicklinks"] });
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const save = useMutation({ mutationFn: savePortalLink, onSuccess: invalidate, onError: err });
  const remove = useMutation({ mutationFn: deletePortalLink, onSuccess: invalidate, onError: err });

  const links = q.data?.links ?? [];
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= links.length) return;
    const a = links[i], b = links[j];
    save.mutate({ id: a.id, label: a.label, kind: a.kind, url: a.url ?? undefined, emoji: a.emoji ?? undefined, description: a.description ?? undefined, panel: a.panel ?? undefined, is_active: a.is_active, sort_order: b.sort_order });
    save.mutate({ id: b.id, label: b.label, kind: b.kind, url: b.url ?? undefined, emoji: b.emoji ?? undefined, description: b.description ?? undefined, panel: b.panel ?? undefined, is_active: b.is_active, sort_order: a.sort_order });
  };

  return (
    <div className="mt-10">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-bold text-heading">Quick Links</h2>
        <button onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90">
          <Plus className="h-3.5 w-3.5" /> Add link
        </button>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-muted">
        Shown on every store's Command Center. A <strong>redirect</strong> opens the site in a new tab; a <strong>panel</strong> pops a clean card you build from links, info blocks, and documents.
      </p>

      {q.isLoading ? <Skeleton className="h-32 w-full" /> : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {links.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-subtle">No quick links yet — add the first one.</p>
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l, i) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-sunk text-base">{l.emoji || "🔗"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-heading">{l.label}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                        {l.kind === "link" ? <Link2 className="h-3 w-3" /> : <PanelsTopLeft className="h-3 w-3" />}
                        {l.kind === "link" ? "Redirect" : "Panel"}
                      </span>
                      {!l.is_active && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-500">Hidden</span>}
                    </div>
                    <div className="truncate text-xs text-ink-subtle">
                      {l.kind === "link" ? l.url : l.panel?.subtitle || `${panelItems(l.panel).length} item${panelItems(l.panel).length === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn onClick={() => swap(i, i - 1)} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn onClick={() => swap(i, i + 1)} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn onClick={() => setEditing(l)} title="Edit"><Pencil className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn danger onClick={() => remove.mutate(l.id)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <LinkEditor
          link={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { invalidate(); setEditing(null); }}
        />
      )}
    </div>
  );
}

function IconBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={cn("rounded-md border border-border bg-surface p-1.5 transition",
        danger ? "text-red-500 hover:border-red-300 hover:bg-red-50" : "text-ink-muted hover:border-accent hover:text-heading")}>
      {children}
    </button>
  );
}

// ── Editor modal ──────────────────────────────────────────────────────────────
const FIELD = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";

// A panel item while being edited: one flat shape covering all three types,
// narrowed back down on save.
interface EditItem {
  type: PanelItem["type"];
  label: string;
  description: string;
  body: string;
  url: string;
  file_url: string;
  file_name: string;
}
const emptyItem = (type: PanelItem["type"]): EditItem =>
  ({ type, label: "", description: "", body: "", url: "", file_url: "", file_name: "" });
const toEditItem = (it: PanelItem): EditItem => ({
  type: it.type,
  label: it.label,
  description: "description" in it ? it.description ?? "" : "",
  body: it.type === "info" ? it.body ?? "" : "",
  url: it.type === "link" ? it.url : "",
  file_url: it.type === "doc" ? it.file_url : "",
  file_name: it.type === "doc" ? it.file_name ?? "" : "",
});

function LinkEditor({ link, onClose, onSaved }: { link: AdminQuickLink | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(link?.label ?? "");
  const [emoji, setEmoji] = useState(link?.emoji ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [kind, setKind] = useState<"link" | "panel">(link?.kind ?? "link");
  const [url, setUrl] = useState(link?.url ?? "");
  const [subtitle, setSubtitle] = useState(link?.panel?.subtitle ?? "");
  const [linesText, setLinesText] = useState((link?.panel?.lines ?? []).join("\n"));
  const [items, setItems] = useState<EditItem[]>(panelItems(link?.panel).map(toEditItem));
  const [active, setActive] = useState(link?.is_active ?? true);

  const patch = (i: number, p: Partial<EditItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = useMutation({
    mutationFn: () => savePortalLink({
      id: link?.id,
      label: label.trim(),
      emoji: emoji.trim() || undefined,
      description: description.trim() || undefined,
      kind,
      url: kind === "link" ? url.trim() : undefined,
      panel: kind === "panel" ? {
        subtitle: subtitle.trim() || null,
        lines: linesText.split("\n").map((l) => l.trim()).filter(Boolean),
        items: items
          .filter((it) => it.label.trim() && (it.type === "info" || (it.type === "link" ? it.url.trim() : it.file_url)))
          .map((it): PanelItem => it.type === "info"
            ? { type: "info", label: it.label.trim(), body: it.body.trim() || null }
            : it.type === "doc"
              ? { type: "doc", label: it.label.trim(), description: it.description.trim() || null, file_url: it.file_url, file_name: it.file_name || null }
              : { type: "link", label: it.label.trim(), description: it.description.trim() || null, url: it.url.trim() }),
      } : undefined,
      is_active: active,
    }),
    onSuccess: onSaved,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error"),
  });

  const canSave = !!label.trim() && (kind === "panel" || /^https?:\/\//i.test(url.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-heading">{link ? "Edit quick link" : "New quick link"}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-subtle transition hover:bg-surface-sunk"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-[4.5rem_1fr] gap-2.5">
          <label className="text-[11px] font-semibold text-ink-muted">Emoji
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🥤" className={cn(FIELD, "mt-1 text-center text-lg")} />
          </label>
          <label className="text-[11px] font-semibold text-ink-muted">Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Coke Support and Parts List" className={cn(FIELD, "mt-1")} />
          </label>
        </div>
        <label className="mt-2.5 block text-[11px] font-semibold text-ink-muted">Short description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shows under the label on the pill" className={cn(FIELD, "mt-1")} />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button onClick={() => setKind("link")}
            className={cn("rounded-lg border px-3 py-2 text-sm font-semibold transition",
              kind === "link" ? "border-midnight bg-midnight text-white" : "border-border text-ink-2 hover:border-accent")}>
            Redirect to a website
          </button>
          <button onClick={() => setKind("panel")}
            className={cn("rounded-lg border px-3 py-2 text-sm font-semibold transition",
              kind === "panel" ? "border-midnight bg-midnight text-white" : "border-border text-ink-2 hover:border-accent")}>
            Show an info panel
          </button>
        </div>

        {kind === "link" ? (
          <label className="mt-3 block text-[11px] font-semibold text-ink-muted">URL
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={cn(FIELD, "mt-1")} />
          </label>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5 rounded-xl border border-border bg-surface-muted p-3">
            <label className="text-[11px] font-semibold text-ink-muted">Panel subtitle
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="All things Coke support." className={cn(FIELD, "mt-1")} />
            </label>
            <label className="text-[11px] font-semibold text-ink-muted">Contact lines — one per line
              <textarea value={linesText} onChange={(e) => setLinesText(e.target.value)} rows={3}
                placeholder={"Contact Coke Support at 1-800-241-2653\nBubbler Parts call Hagar 1-800-427-6642"}
                className={cn(FIELD, "mt-1 resize-none")} />
            </label>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-ink-muted">Panel items — links, info blocks, and documents, in order</div>
              <div className="flex flex-col gap-2">
                {items.map((it, i) => (
                  <ItemRow key={i} item={it} onChange={(p) => patch(i, p)} onRemove={() => setItems(items.filter((_, j) => j !== i))} />
                ))}
                <div className="flex flex-wrap gap-1.5">
                  <AddItemBtn onClick={() => setItems([...items, emptyItem("link")])} icon={<Link2 className="h-3.5 w-3.5" />} label="Add link" />
                  <AddItemBtn onClick={() => setItems([...items, emptyItem("info")])} icon={<Info className="h-3.5 w-3.5" />} label="Add info block" />
                  <AddItemBtn onClick={() => setItems([...items, emptyItem("doc")])} icon={<FileText className="h-3.5 w-3.5" />} label="Add document" />
                </div>
              </div>
            </div>
          </div>
        )}

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Visible on store screens
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
          <button disabled={!canSave || save.isPending} onClick={() => save.mutate()}
            className="rounded-lg bg-midnight px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
            {save.isPending ? "Saving…" : "Save link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddItemBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:border-accent">
      {icon} {label}
    </button>
  );
}

const ITEM_META: Record<PanelItem["type"], { icon: React.ReactNode; title: string }> = {
  link: { icon: <Link2 className="h-3.5 w-3.5" />, title: "Link" },
  info: { icon: <Info className="h-3.5 w-3.5" />, title: "Info block" },
  doc: { icon: <FileText className="h-3.5 w-3.5" />, title: "Document" },
};

function ItemRow({ item, onChange, onRemove }: { item: EditItem; onChange: (p: Partial<EditItem>) => void; onRemove: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const meta = ITEM_META[item.type];

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await uploadPortalDoc(file);
      onChange({ file_url: r.file_url, file_name: r.file_name, label: item.label || r.file_name.replace(/\.[a-z0-9]+$/i, "") });
    } catch (e) {
      toast.push((e as Error)?.message ?? "Upload failed.", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">{meta.icon} {meta.title}</span>
        <button onClick={onRemove} className="rounded-md p-1 text-ink-subtle hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="grid gap-1.5">
        <input value={item.label} onChange={(e) => onChange({ label: e.target.value })}
          placeholder={item.type === "info" ? "myCoke Service Apple App" : item.type === "doc" ? "Coke Parts List" : "Coke Support Site"} className={FIELD} />
        {item.type === "link" && (
          <input value={item.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…" className={FIELD} />
        )}
        {item.type === "info" && (
          <textarea value={item.body} onChange={(e) => onChange({ body: e.target.value })} rows={2}
            placeholder="Download the myCoke Service app from the App Store to place service calls." className={cn(FIELD, "resize-none")} />
        )}
        {item.type === "doc" && (
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 hover:border-accent disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : item.file_url ? "Replace file" : "Upload file"}
            </button>
            {item.file_url
              ? <span className="min-w-0 truncate text-xs text-ink-muted">{item.file_name || "Uploaded"}</span>
              : <span className="text-xs text-ink-subtle">PDF, image, Word, or Excel — 10 MB max</span>}
          </div>
        )}
      </div>
    </div>
  );
}
