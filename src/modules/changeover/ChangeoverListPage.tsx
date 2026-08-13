// /changeover — store changeover checklists. SDO/RVP create a DO changeover,
// DOs create a GM changeover, each assigned to a store. Lists what the caller
// can see (created, assigned to them, or in their scope); click one to work it.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, ClipboardList, ArrowRight, UserCog, Store } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { createChangeover, fetchChangeovers, type ChangeoverListRow, type ChangeoverStatus } from "./api";
import { itemCount, templateFor, type ChangeoverKind } from "./templates";

const STATUS_META: Record<ChangeoverStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-zinc-100 text-zinc-600" },
  in_progress: { label: "In progress", cls: "bg-sky-100 text-sky-700" },
  complete: { label: "Complete", cls: "bg-emerald-100 text-emerald-700" },
};
const KIND_LABEL: Record<ChangeoverKind, string> = { do: "DO changeover", gm: "GM changeover" };

export function ChangeoverListPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["changeovers"], queryFn: fetchChangeovers });
  const [kindFilter, setKindFilter] = useState<"all" | ChangeoverKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ChangeoverStatus>("all");
  const [createKind, setCreateKind] = useState<ChangeoverKind | null>(null);

  const rows = useMemo(() => {
    let r = q.data?.rows ?? [];
    if (kindFilter !== "all") r = r.filter((x) => x.kind === kindFilter);
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    return r;
  }, [q.data, kindFilter, statusFilter]);

  const canCreate = q.data?.can_create;

  return (
    <>
      <PageHeader
        title="Store Changeovers"
        description="Changeover checklists — SDO/RVP run the DO list, DOs run the GM list. Assign one to a store and work through it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate?.do && (
              <Button variant="secondary" size="sm" onClick={() => setCreateKind("do")}>
                <Plus className="mr-1 h-3.5 w-3.5" /> DO changeover
              </Button>
            )}
            {canCreate?.gm && (
              <Button size="sm" onClick={() => setCreateKind("gm")}>
                <Plus className="mr-1 h-3.5 w-3.5" /> GM changeover
              </Button>
            )}
          </div>
        }
      />

      {createKind && <CreateModal kind={createKind} onClose={() => setCreateKind(null)} onCreated={(id) => nav(`/changeover/${id}`)} />}

      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", "do", "gm"] as const).map((k) => (
          <Chip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} label={k === "all" ? "All types" : KIND_LABEL[k]} />
        ))}
        <span className="mx-1 w-px bg-zinc-200" />
        {(["all", "open", "in_progress", "complete"] as const).map((s) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} label={s === "all" ? "All statuses" : STATUS_META[s].label} cls={s !== "all" ? STATUS_META[s].cls : undefined} />
        ))}
      </div>

      {q.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load changeovers" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No changeovers yet" description={canCreate?.do || canCreate?.gm ? "Start one with the buttons above." : "Nothing assigned to you yet."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => <ChangeoverCard key={r.id} r={r} onOpen={() => nav(`/changeover/${r.id}`)} />)}
        </div>
      )}
    </>
  );
}

function ChangeoverCard({ r, onOpen }: { r: ChangeoverListRow; onOpen: () => void }) {
  const total = itemCount(r.kind);
  const pct = total ? Math.round((r.checked_count / total) * 100) : 0;
  const meta = STATUS_META[r.status];
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-card transition hover:border-accent/60 hover:shadow-float">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
          {r.kind === "do" ? <UserCog className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />} {KIND_LABEL[r.kind]}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", meta.cls)}>{meta.label}</span>
      </div>
      <div className="flex items-center gap-1.5 text-sm font-semibold text-midnight">
        <Store className="h-4 w-4 text-zinc-400" /> #{r.store_number}{r.store_name ? ` · ${r.store_name}` : ""}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        {[r.outgoing_name && `Out: ${r.outgoing_name}`, r.incoming_name && `In: ${r.incoming_name}`].filter(Boolean).join(" · ") || "No names set"}
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{r.checked_count}/{total} done</span>
          {r.assigned_to_name && <span>→ {r.assigned_to_name}</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div className={cn("h-full rounded-full", r.status === "complete" ? "bg-emerald-500" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end text-xs font-semibold text-accent opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </div>
    </button>
  );
}

function CreateModal({ kind, onClose, onCreated }: { kind: ChangeoverKind; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const tpl = templateFor(kind);
  const [storeNumber, setStoreNumber] = useState("");
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [email, setEmail] = useState("");

  const create = useMutation({
    mutationFn: () => createChangeover({ kind, store_number: storeNumber.trim(), outgoing_name: outgoing.trim() || undefined, incoming_name: incoming.trim() || undefined, assigned_email: email.trim() || undefined }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["changeovers"] }); onCreated(r.id); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't create.", "error"),
  });

  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";
  return (
    <Modal open onClose={onClose} title={`New ${tpl.title}`} maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => create.mutate()} disabled={!storeNumber.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
        </>
      }>
      <p className="mb-3 text-xs text-zinc-500">{tpl.who}</p>
      <div className="space-y-3">
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Store number</span>
          <input value={storeNumber} onChange={(e) => setStoreNumber(e.target.value)} placeholder="e.g. 1056" className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">{tpl.subjectLabel} (optional)</span>
          <input value={outgoing} onChange={(e) => setOutgoing(e.target.value)} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">{tpl.incomingLabel} (optional)</span>
          <input value={incoming} onChange={(e) => setIncoming(e.target.value)} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Assign to (Hub email, optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="they can also check items off" className={cls} /></label>
      </div>
    </Modal>
  );
}

function Chip({ active, onClick, label, cls }: { active: boolean; onClick: () => void; label: string; cls?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition", active ? "bg-accent text-white ring-accent" : cls || "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")}>
      {label}
    </button>
  );
}
