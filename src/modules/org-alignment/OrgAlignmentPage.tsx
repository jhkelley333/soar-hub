// /admin/org-alignment — stage a structural org realignment (new regions/areas/
// districts + reparent existing stores/districts/areas) and have it go live on
// an effective date. Nothing changes the live org tree until it's applied —
// automatically on the effective date, or via "Apply now". Applied alignments
// can be rolled back. Admin-only.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Check, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  fetchAlignments, fetchAlignment, fetchOrgTree, createAlignment, updateAlignment, deleteAlignment,
  addNode, addMove, removeNode, removeMove, applyAlignment, rollbackAlignment,
  type OrgAlignment, type OrgTree, type NodeKind, type MoveKind, type AlignmentStatus,
} from "./api";

const inputCls = "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";
const STATUS_STYLE: Record<AlignmentStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600", scheduled: "bg-blue-50 text-blue-700",
  applied: "bg-emerald-50 text-emerald-700", canceled: "bg-red-50 text-red-600",
};
const fmtDate = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");
const newRef = (kind: string) => `${kind}-${Math.random().toString(36).slice(2, 8)}`;
// Picker option value encodes existing id vs a staged new-node ref.
const enc = (v: { id?: string; ref?: string }) => (v.ref ? `ref:${v.ref}` : `id:${v.id}`);
const dec = (v: string): { id?: string; ref?: string } => (v.startsWith("ref:") ? { ref: v.slice(4) } : { id: v.slice(3) });

export function OrgAlignmentPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Org Alignment"
        description="Stage a market realignment and schedule it to go live on a date. Nothing changes the org tree until it applies."
      />
      {openId ? <AlignmentDetail id={openId} onBack={() => setOpenId(null)} /> : <AlignmentList onOpen={setOpenId} />}
    </>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────
function AlignmentList({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["org-alignments"], queryFn: fetchAlignments });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());

  const create = useMutation({
    mutationFn: () => createAlignment({ name: name.trim(), effective_date: date }),
    onSuccess: (r) => { setCreating(false); setName(""); qc.invalidateQueries({ queryKey: ["org-alignments"] }); onOpen(r.alignment.id); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't create.", "error"),
  });

  const alignments = q.data?.alignments ?? [];
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-3.5 w-3.5" /> New alignment</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-40 w-full" />
        : q.isError ? <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
        : alignments.length === 0 ? <EmptyState title="No alignments yet" description="Create one to stage a market realignment." />
        : (
          <div className="space-y-2">
            {alignments.map((a) => (
              <button key={a.id} onClick={() => onOpen(a.id)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-left hover:border-accent/60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-midnight">{a.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLE[a.status])}>{a.status}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    Effective {fmtDate(a.effective_date)} · {a.change_count?.nodes ?? 0} new node(s) · {a.change_count?.moves ?? 0} move(s)
                  </div>
                </div>
                <CalendarClock className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            ))}
          </div>
        )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New alignment" maxWidth="max-w-md"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create"}</Button></>}>
        <div className="space-y-3">
          <div><Label htmlFor="al-name">Name *</Label><Input id="al-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Market Realignment" /></div>
          <div><Label htmlFor="al-date">Effective date *</Label><input id="al-date" type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
        </div>
      </Modal>
    </div>
  );
}

// ── Detail / builder ─────────────────────────────────────────────────────────
function AlignmentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["org-alignment", id], queryFn: () => fetchAlignment(id) });
  const treeQ = useQuery({ queryKey: ["org-alignment-tree"], queryFn: fetchOrgTree });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["org-alignment", id] }); qc.invalidateQueries({ queryKey: ["org-alignments"] }); };

  const a = q.data?.alignment;
  const tree = treeQ.data;
  const locked = a?.status === "applied" || a?.status === "canceled";

  const mut = <T, V = void>(fn: (v: V) => Promise<T>, msg?: string) => ({
    onSuccess: () => { if (msg) toast.push(msg, "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
    mutationFn: fn,
  });

  const schedule = useMutation(mut(() => updateAlignment({ id, status: "scheduled" }), "Scheduled — it'll go live on its effective date."));
  const unschedule = useMutation(mut(() => updateAlignment({ id, status: "draft" }), "Back to draft."));
  const cancel = useMutation(mut(() => updateAlignment({ id, status: "canceled" }), "Canceled."));
  const del = useMutation(mut(() => deleteAlignment(id), "Deleted."));
  const apply = useMutation(mut(() => applyAlignment(id), "Applied — the org tree is updated."));
  const rollback = useMutation(mut(() => rollbackAlignment(id), "Rolled back."));
  const rmNode = useMutation(mut((nid: string) => removeNode(nid)));
  const rmMove = useMutation(mut((mid: string) => removeMove(mid)));

  if (q.isLoading || treeQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !a) return <EmptyState title="Couldn't load alignment" description={(q.error as Error)?.message ?? "Try again."} />;

  // Name resolvers over the live tree + this alignment's staged new nodes.
  const stagedByRef = new Map((a.nodes ?? []).map((n) => [n.ref, n]));
  const regionName = (id2: string | null) => tree?.regions.find((r) => r.id === id2)?.name ?? "?";
  const areaName = (id2: string | null) => tree?.areas.find((r) => r.id === id2)?.name ?? "?";
  const districtName = (id2: string | null) => tree?.districts.find((r) => r.id === id2)?.name ?? "?";
  const parentLabel = (kind: NodeKind, pid: string | null, pref: string | null) => {
    if (pref) return `${stagedByRef.get(pref)?.name ?? pref} (new)`;
    return kind === "area" ? regionName(pid) : kind === "district" ? areaName(pid) : "—";
  };
  const moveNodeLabel = (kind: MoveKind, nid: string) => {
    if (kind === "store") { const s = tree?.stores.find((x) => x.id === nid); return s ? `#${s.number} ${s.name}` : "?"; }
    if (kind === "district") return districtName(nid);
    return areaName(nid);
  };
  const moveParentLabel = (kind: MoveKind, pid: string | null, pref: string | null) => {
    if (pref) return `${stagedByRef.get(pref)?.name ?? pref} (new)`;
    return kind === "store" ? districtName(pid) : kind === "district" ? areaName(pid) : regionName(pid);
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> All alignments</button>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-midnight">{a.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLE[a.status])}>{a.status}</span>
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">Effective {fmtDate(a.effective_date)}{a.applied_at ? ` · applied ${fmtDate(a.applied_at.slice(0, 10))}` : ""}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a.status === "draft" && <Button size="sm" disabled={schedule.isPending} onClick={() => schedule.mutate()}><CalendarClock className="mr-1 h-3.5 w-3.5" /> Schedule</Button>}
            {a.status === "scheduled" && <Button size="sm" variant="secondary" disabled={unschedule.isPending} onClick={() => unschedule.mutate()}>Unschedule</Button>}
            {(a.status === "draft" || a.status === "scheduled") && (
              <Button size="sm" variant="secondary" disabled={apply.isPending} onClick={() => { if (window.confirm("Apply this alignment to the live org tree now?")) apply.mutate(); }}>
                <Check className="mr-1 h-3.5 w-3.5" /> Apply now
              </Button>
            )}
            {a.status === "applied" && (
              <Button size="sm" variant="secondary" className="text-amber-700 ring-amber-200" disabled={rollback.isPending} onClick={() => { if (window.confirm("Roll back this alignment? It reverts every move and deletes the nodes it created.")) rollback.mutate(); }}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Roll back
              </Button>
            )}
            {a.status !== "applied" && a.status !== "canceled" && (
              <Button size="sm" variant="ghost" className="text-zinc-500" disabled={cancel.isPending} onClick={() => { if (window.confirm("Cancel this alignment?")) cancel.mutate(); }}><X className="h-3.5 w-3.5" /></Button>
            )}
            {a.status !== "applied" && (
              <Button size="sm" variant="ghost" className="text-red-600" disabled={del.isPending} onClick={() => { if (window.confirm("Delete this alignment permanently?")) del.mutate(); onBack(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Staged new nodes */}
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">New nodes ({a.nodes?.length ?? 0})</h3>
        <div className="space-y-1.5">
          {(a.nodes ?? []).map((n) => (
            <div key={n.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">{n.kind}</span>
              <span className="font-medium text-midnight">{n.name}</span>
              <span className="font-mono text-[11px] text-zinc-400">{n.code}</span>
              {n.kind !== "region" && <span className="text-xs text-zinc-500">→ under {parentLabel(n.kind, n.parent_id, n.parent_ref)}</span>}
              {!locked && <button onClick={() => rmNode.mutate(n.id)} className="ml-auto text-zinc-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
          {(a.nodes?.length ?? 0) === 0 && <p className="text-xs text-zinc-400">No new nodes staged.</p>}
        </div>
        {!locked && tree && <AddNodeForm alignmentId={id} tree={tree} staged={a.nodes ?? []} onAdded={invalidate} />}
      </section>

      {/* Staged moves */}
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Moves ({a.moves?.length ?? 0})</h3>
        <div className="space-y-1.5">
          {(a.moves ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">{m.kind}</span>
              <span className="font-medium text-midnight">{moveNodeLabel(m.kind, m.node_id)}</span>
              <span className="text-xs text-zinc-500">→ {moveParentLabel(m.kind, m.new_parent_id, m.new_parent_ref)}</span>
              {!locked && <button onClick={() => rmMove.mutate(m.id)} className="ml-auto text-zinc-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
          {(a.moves?.length ?? 0) === 0 && <p className="text-xs text-zinc-400">No moves staged.</p>}
        </div>
        {!locked && tree && <AddMoveForm alignmentId={id} tree={tree} staged={a.nodes ?? []} onAdded={invalidate} />}
      </section>

      {a.status === "applied" && (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400"><RotateCcw className="h-3 w-3" /> This alignment is live. Roll it back to revert every change.</p>
      )}
    </div>
  );
}

// Parent options for a given child kind: existing nodes of the parent kind, plus
// staged new nodes of the parent kind in this alignment.
function parentOptions(childKind: NodeKind | MoveKind, tree: OrgTree, staged: OrgAlignment["nodes"]): { value: string; label: string }[] {
  // store -> district, district -> area, area -> region.
  const pk: NodeKind = childKind === "store" ? "district" : childKind === "district" ? "area" : "region";
  const existing = pk === "region" ? tree.regions : pk === "area" ? tree.areas : tree.districts;
  const opts = existing.map((n) => ({ value: enc({ id: n.id }), label: n.name }));
  for (const s of staged ?? []) if (s.kind === pk) opts.push({ value: enc({ ref: s.ref }), label: `${s.name} (new)` });
  return opts;
}

function AddNodeForm({ alignmentId, tree, staged, onAdded }: { alignmentId: string; tree: OrgTree; staged: OrgAlignment["nodes"]; onAdded: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<NodeKind>("district");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parent, setParent] = useState("");
  const opts = useMemo(() => (kind === "region" ? [] : parentOptions(kind, tree, staged)), [kind, tree, staged]);

  const add = useMutation({
    mutationFn: () => {
      const p = kind === "region" ? {} : dec(parent);
      return addNode({ alignment_id: alignmentId, ref: newRef(kind), kind, name: name.trim(), code: code.trim(), parent_id: p.id, parent_ref: p.ref });
    },
    onSuccess: () => { setName(""); setCode(""); setParent(""); onAdded(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't add.", "error"),
  });
  const ready = name.trim() && code.trim() && (kind === "region" || parent);

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-2.5 ring-1 ring-zinc-100">
      <select value={kind} onChange={(e) => { setKind(e.target.value as NodeKind); setParent(""); }} className={cn(inputCls, "w-28")}>
        <option value="region">Region</option><option value="area">Area</option><option value="district">District</option>
      </select>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={cn(inputCls, "w-40")} />
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className={cn(inputCls, "w-28")} />
      {kind !== "region" && (
        <select value={parent} onChange={(e) => setParent(e.target.value)} className={cn(inputCls, "w-44")}>
          <option value="">Parent {kind === "area" ? "region" : "area"}…</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      <Button size="sm" disabled={!ready || add.isPending} onClick={() => add.mutate()}><Plus className="mr-1 h-3.5 w-3.5" /> Add node</Button>
    </div>
  );
}

function AddMoveForm({ alignmentId, tree, staged, onAdded }: { alignmentId: string; tree: OrgTree; staged: OrgAlignment["nodes"]; onAdded: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<MoveKind>("store");
  const [nodeId, setNodeId] = useState("");
  const [parent, setParent] = useState("");
  const nodeOpts = useMemo(() => {
    if (kind === "store") return tree.stores.map((s) => ({ value: s.id, label: `#${s.number} ${s.name}` }));
    if (kind === "district") return tree.districts.map((d) => ({ value: d.id, label: d.name }));
    return tree.areas.map((r) => ({ value: r.id, label: r.name }));
  }, [kind, tree]);
  const parentOpts = useMemo(() => parentOptions(kind, tree, staged), [kind, tree, staged]);

  const add = useMutation({
    mutationFn: () => { const p = dec(parent); return addMove({ alignment_id: alignmentId, kind, node_id: nodeId, new_parent_id: p.id, new_parent_ref: p.ref }); },
    onSuccess: () => { setNodeId(""); setParent(""); onAdded(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't add.", "error"),
  });

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-2.5 ring-1 ring-zinc-100">
      <select value={kind} onChange={(e) => { setKind(e.target.value as MoveKind); setNodeId(""); setParent(""); }} className={cn(inputCls, "w-28")}>
        <option value="store">Store</option><option value="district">District</option><option value="area">Area</option>
      </select>
      <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} className={cn(inputCls, "w-52")}>
        <option value="">Move which {kind}…</option>
        {nodeOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select value={parent} onChange={(e) => setParent(e.target.value)} className={cn(inputCls, "w-44")}>
        <option value="">New {kind === "store" ? "district" : kind === "district" ? "area" : "region"}…</option>
        {parentOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Button size="sm" disabled={!nodeId || !parent || add.isPending} onClick={() => add.mutate()}><Plus className="mr-1 h-3.5 w-3.5" /> Add move</Button>
    </div>
  );
}
