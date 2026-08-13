// /changeover/:id — work a changeover checklist. Check items off (with an
// optional per-item note), edit the store/people details, add overall notes,
// mark complete, and download the finished list.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, Trash2, StickyNote } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { deleteChangeover, fetchChangeover, updateChangeover, updateChangeoverItem, type ChangeoverDetail, type ItemProgress } from "./api";
import { countItems, type ChecklistItem, type ChecklistTemplate } from "./templates";
import { useChangeoverTemplates } from "./useTemplates";
import { downloadChangeoverXlsx } from "./changeoverExport";

export function ChangeoverDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["changeover", id], queryFn: () => fetchChangeover(id), enabled: !!id });

  return (
    <div>
      <button type="button" onClick={() => nav("/changeover")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Back to changeovers
      </button>
      {q.isLoading && <Skeleton className="h-96 w-full" />}
      {q.isError && <EmptyState title="Couldn't load this changeover" description={(q.error as Error)?.message ?? "Try again."} />}
      {q.data && <Detail c={q.data.checklist} canEdit={q.data.can_edit} />}
    </div>
  );
}

function Detail({ c, canEdit }: { c: ChangeoverDetail; canEdit: boolean }) {
  const { templates } = useChangeoverTemplates();
  const tpl = templates[c.kind];
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const total = countItems(tpl);
  const pct = total ? Math.round((c.checked_count / total) * 100) : 0;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["changeover", c.id] });

  const setStatus = useMutation({
    mutationFn: (status: "open" | "in_progress" | "complete") => updateChangeover(c.id, { status }),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["changeovers"] }); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update.", "error"),
  });
  const del = useMutation({
    mutationFn: () => deleteChangeover(c.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["changeovers"] }); toast.push("Changeover deleted.", "success"); nav("/changeover"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-midnight">{tpl.title}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              c.status === "complete" ? "bg-emerald-100 text-emerald-700" : c.status === "in_progress" ? "bg-sky-100 text-sky-700" : "bg-zinc-100 text-zinc-600")}>
              {c.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-0.5 text-sm text-zinc-500">#{c.store_number}{c.store_name ? ` · ${c.store_name}` : ""}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => downloadChangeoverXlsx(tpl, c)}><Download className="mr-1.5 h-3.5 w-3.5" /> Download</Button>
          {canEdit && c.status !== "complete" && <Button size="sm" onClick={() => setStatus.mutate("complete")} disabled={setStatus.isPending}><Check className="mr-1.5 h-3.5 w-3.5" /> Mark complete</Button>}
          {canEdit && c.status === "complete" && <Button variant="secondary" size="sm" onClick={() => setStatus.mutate("in_progress")} disabled={setStatus.isPending}>Reopen</Button>}
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
          <span>{c.checked_count} of {total} complete</span><span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className={cn("h-full rounded-full transition-all", c.status === "complete" ? "bg-emerald-500" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {tpl.sections.map((s) => (
            <Card key={s.title} className="p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{s.title}</div>
              <ul className="divide-y divide-zinc-100">
                {s.items.map((it) => <ItemRow key={it.key} checklistId={c.id} item={it} p={c.progress[it.key]} canEdit={canEdit} onSaved={invalidate} />)}
              </ul>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <DetailsCard c={c} tpl={tpl} canEdit={canEdit} onSaved={invalidate} />
          <NotesCard c={c} canEdit={canEdit} onSaved={invalidate} />
          {canEdit && (
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50"
              onClick={() => { if (window.confirm("Delete this changeover checklist? This can't be undone.")) del.mutate(); }}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete changeover
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function ItemRow({ checklistId, item, p, canEdit, onSaved }: { checklistId: string; item: ChecklistItem; p: ItemProgress | undefined; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const checked = !!p?.checked;
  const [noteOpen, setNoteOpen] = useState(!!p?.note);
  const [note, setNote] = useState(p?.note ?? "");
  useEffect(() => { setNote(p?.note ?? ""); }, [p?.note]);

  const toggle = useMutation({
    mutationFn: () => updateChangeoverItem(checklistId, item.key, { checked: !checked }),
    onSuccess: onSaved,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update.", "error"),
  });
  const saveNote = useMutation({
    mutationFn: () => updateChangeoverItem(checklistId, item.key, { note: note.trim() }),
    onSuccess: onSaved,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save note.", "error"),
  });

  return (
    <li className="py-2">
      <div className="flex items-start gap-2.5">
        <button type="button" disabled={!canEdit || toggle.isPending} onClick={() => toggle.mutate()}
          className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
            checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 bg-white hover:border-accent", !canEdit && "cursor-default opacity-70")}>
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={cn("text-sm", checked ? "text-zinc-400 line-through" : "text-midnight")}>{item.label}</div>
          {item.hint && <div className="mt-0.5 text-[11px] text-zinc-400">{item.hint}</div>}
          {checked && p?.checked_by_name && (
            <div className="mt-0.5 text-[11px] text-emerald-600">✓ {p.checked_by_name}{p.checked_at ? ` · ${new Date(p.checked_at).toLocaleDateString("en-US")}` : ""}</div>
          )}
          {noteOpen ? (
            <div className="mt-1.5 flex items-start gap-1.5">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!canEdit}
                placeholder="Note (optional)…" className="w-full rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-accent focus:outline-none" />
              {canEdit && <Button size="sm" variant="secondary" onClick={() => saveNote.mutate()} disabled={saveNote.isPending}>Save</Button>}
            </div>
          ) : (
            canEdit && <button type="button" onClick={() => setNoteOpen(true)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-accent"><StickyNote className="h-3 w-3" /> Add note</button>
          )}
        </div>
      </div>
    </li>
  );
}

function DetailsCard({ c, tpl, canEdit, onSaved }: { c: ChangeoverDetail; tpl: ChecklistTemplate; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [outgoing, setOutgoing] = useState(c.outgoing_name ?? "");
  const [incoming, setIncoming] = useState(c.incoming_name ?? "");
  const [email, setEmail] = useState("");
  const dirty = outgoing !== (c.outgoing_name ?? "") || incoming !== (c.incoming_name ?? "") || email.trim() !== "";

  const save = useMutation({
    mutationFn: () => updateChangeover(c.id, { outgoing_name: outgoing.trim(), incoming_name: incoming.trim(), ...(email.trim() ? { assigned_email: email.trim() } : {}) }),
    onSuccess: () => { setEmail(""); onSaved(); toast.push("Saved.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none disabled:bg-zinc-50";
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Details</div>
      <div className="space-y-2.5">
        <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">{tpl.subjectLabel}</span>
          <input value={outgoing} onChange={(e) => setOutgoing(e.target.value)} disabled={!canEdit} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">{tpl.incomingLabel}</span>
          <input value={incoming} onChange={(e) => setIncoming(e.target.value)} disabled={!canEdit} className={cls} /></label>
        <div>
          <span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">Assigned to</span>
          {c.assigned_to_name && <div className="mb-1 text-xs text-zinc-600">Currently: <b>{c.assigned_to_name}</b></div>}
          {canEdit && <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Hub email to (re)assign" className={cls} />}
        </div>
      </div>
      {canEdit && <Button size="sm" className="mt-3 w-full" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save details"}</Button>}
      <div className="mt-3 text-[11px] text-zinc-400">Created by {c.created_by_name ?? "—"} · {new Date(c.created_at).toLocaleDateString("en-US")}</div>
    </Card>
  );
}

function NotesCard({ c, canEdit, onSaved }: { c: ChangeoverDetail; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(c.notes ?? "");
  useEffect(() => { setNotes(c.notes ?? ""); }, [c.notes]);
  const save = useMutation({
    mutationFn: () => updateChangeover(c.id, { notes: notes.trim() }),
    onSuccess: () => { onSaved(); toast.push("Notes saved.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Notes</div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} rows={4}
        placeholder="Anything worth recording for this changeover…" className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none disabled:bg-zinc-50" />
      {canEdit && <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => save.mutate()} disabled={notes === (c.notes ?? "") || save.isPending}>{save.isPending ? "Saving…" : "Save notes"}</Button>}
    </Card>
  );
}
