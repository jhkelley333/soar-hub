// /admin/acquisitions — stage an upcoming acquisition's stores, then merge them
// live in one action. Admin / VP / COO (System Settings → Acquisitions).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Building2, ArrowRight, CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { createAcquisition, fetchAcquisitions, type Acquisition } from "./api";

export function AcquisitionsPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["acquisitions"], queryFn: fetchAcquisitions });
  const [createOpen, setCreateOpen] = useState(false);
  const rows = q.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="Acquisitions"
        description="Stage an upcoming acquisition's stores (inactive), review them, then merge to go live across the hub."
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> New acquisition</Button>}
      />

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={(id) => nav(`/admin/acquisitions/${id}`)} />}

      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No acquisitions yet" description="Start one with New acquisition, then upload the stores." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => <AcqCard key={a.id} a={a} onOpen={() => nav(`/admin/acquisitions/${a.id}`)} />)}
        </div>
      )}
    </>
  );
}

function AcqCard({ a, onOpen }: { a: Acquisition; onOpen: () => void }) {
  const merged = a.status === "merged";
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-card transition hover:border-accent/60 hover:shadow-float">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-midnight"><Building2 className="h-4 w-4 text-zinc-400" /> {a.name}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", merged ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
          {merged ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}{merged ? "Merged" : "Draft"}
        </span>
      </div>
      <div className="text-xs text-zinc-500">
        {a.store_count} store{a.store_count === 1 ? "" : "s"}{merged ? ` · ${a.merged_count} live` : ""}
        {a.close_date ? ` · closes ${new Date(`${a.close_date}T12:00:00`).toLocaleDateString("en-US")}` : ""}
      </div>
      <div className="mt-3 flex items-center justify-end text-xs font-semibold text-accent opacity-0 transition group-hover:opacity-100">
        Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </div>
    </button>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [notes, setNotes] = useState("");
  const create = useMutation({
    mutationFn: () => createAcquisition({ name: name.trim(), close_date: closeDate || undefined, notes: notes.trim() || undefined }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["acquisitions"] }); onCreated(r.id); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't create.", "error"),
  });
  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";
  return (
    <Modal open onClose={onClose} title="New acquisition" maxWidth="max-w-md"
      footer={<><Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button></>}>
      <div className="space-y-3">
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith Group — 57 stores" className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Expected close date (optional)</span>
          <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cls} /></label>
      </div>
    </Modal>
  );
}
