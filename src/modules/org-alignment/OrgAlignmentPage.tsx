// /admin/org-alignment — stage a structural org realignment on an interactive
// tree (like Org Admin): move stores/districts/areas around and add new
// regions/areas/districts. Nothing changes the live org tree until it's applied
// — automatically on the effective date, or via "Apply now". The tree shows the
// PROJECTED state (after the staged changes) with pending badges. Admin-only.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Check, ChevronDown, ChevronRight, CornerDownRight, Plus, Trash2, Undo2, X } from "lucide-react";
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
  type OrgTree, type AlignmentNode, type AlignmentMove, type NodeKind, type MoveKind, type AlignmentStatus,
} from "./api";
import { fetchOrgTree as fetchAdminOrgTree, type OrgManager, type OrgTreeResponse } from "@/modules/admin/api";

const inputCls = "block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";
const STATUS_STYLE: Record<AlignmentStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600", scheduled: "bg-blue-50 text-blue-700",
  applied: "bg-emerald-50 text-emerald-700", canceled: "bg-red-50 text-red-600",
};
const fmtDate = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");
const newRef = (kind: string) => `${kind}-${Math.random().toString(36).slice(2, 8)}`;

// ── Projected tree ───────────────────────────────────────────────────────────
// A node in the tree the builder renders. `key` is the real id for existing
// nodes and the ref for staged new nodes; parent moves and new-node parents both
// point at a key.
type PKind = "region" | "area" | "district" | "store";
interface PNode {
  key: string;
  kind: PKind;
  label: string;
  sub?: string;
  isNew: boolean;         // a staged new node
  moved: boolean;         // an existing node with a staged move
  moveId?: string;        // the staged move's id (for undo)
  nodeId?: string;        // existing real id (for moving)
  newId?: string;         // the staged new node's DB row id (for remove/undo)
  children: PNode[];
}

// Build the projected tree: current org tree + staged new nodes + staged moves.
function projectTree(tree: OrgTree, nodes: AlignmentNode[], moves: AlignmentMove[]): PNode[] {
  const moveByNode = new Map(moves.map((m) => [m.node_id, m]));
  const targetKey = (m?: { new_parent_id: string | null; new_parent_ref: string | null } | null) =>
    m ? (m.new_parent_ref || m.new_parent_id || "") : "";

  // Effective parent key for each existing node (staged move wins).
  const areaParent = (a: OrgTree["areas"][number]) => moveByNode.has(a.id) ? targetKey(moveByNode.get(a.id)) : a.region_id;
  const distParent = (d: OrgTree["districts"][number]) => moveByNode.has(d.id) ? targetKey(moveByNode.get(d.id)) : d.area_id;
  const storeParent = (s: OrgTree["stores"][number]) => moveByNode.has(s.id) ? targetKey(moveByNode.get(s.id)) : s.district_id;

  const newBy = (kind: NodeKind) => nodes.filter((n) => n.kind === kind);
  const newParentKey = (n: AlignmentNode) => n.parent_ref || n.parent_id || "";

  // Group children by parent key.
  const storesByDist = new Map<string, PNode[]>();
  for (const s of tree.stores) {
    const p = storeParent(s);
    (storesByDist.get(p) || storesByDist.set(p, []).get(p)!).push({
      key: s.id, kind: "store", label: `#${s.number} ${s.name}`, isNew: false,
      moved: moveByNode.has(s.id), moveId: moveByNode.get(s.id)?.id, nodeId: s.id, children: [],
    });
  }
  const distNode = (key: string, name: string, code: string, isNew: boolean, mv?: AlignmentMove, newId?: string): PNode => ({
    key, kind: "district", label: name, sub: code, isNew, moved: !!mv, moveId: mv?.id, nodeId: isNew ? undefined : key, newId,
    children: (storesByDist.get(key) || []).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  });
  const distsByArea = new Map<string, PNode[]>();
  for (const d of tree.districts) (distsByArea.get(distParent(d)) || distsByArea.set(distParent(d), []).get(distParent(d))!).push(distNode(d.id, d.name, d.code, false, moveByNode.get(d.id)));
  for (const n of newBy("district")) (distsByArea.get(newParentKey(n)) || distsByArea.set(newParentKey(n), []).get(newParentKey(n))!).push(distNode(n.ref, n.name, n.code, true, undefined, n.id));

  const areaNode = (key: string, name: string, code: string, isNew: boolean, mv?: AlignmentMove, newId?: string): PNode => ({
    key, kind: "area", label: name, sub: code, isNew, moved: !!mv, moveId: mv?.id, nodeId: isNew ? undefined : key, newId,
    children: (distsByArea.get(key) || []).sort((a, b) => (a.sub || "").localeCompare(b.sub || "")),
  });
  const areasByRegion = new Map<string, PNode[]>();
  for (const a of tree.areas) (areasByRegion.get(areaParent(a)) || areasByRegion.set(areaParent(a), []).get(areaParent(a))!).push(areaNode(a.id, a.name, a.code, false, moveByNode.get(a.id)));
  for (const n of newBy("area")) (areasByRegion.get(newParentKey(n)) || areasByRegion.set(newParentKey(n), []).get(newParentKey(n))!).push(areaNode(n.ref, n.name, n.code, true, undefined, n.id));

  const regionNode = (key: string, name: string, code: string, isNew: boolean, newId?: string): PNode => ({
    key, kind: "region", label: name, sub: code, isNew, moved: false, newId, children: (areasByRegion.get(key) || []).sort((a, b) => (a.sub || "").localeCompare(b.sub || "")),
  });
  const regions: PNode[] = [
    ...tree.regions.map((r) => regionNode(r.id, r.name, r.code, false)),
    ...newBy("region").map((n) => regionNode(n.ref, n.name, n.code, true, n.id)),
  ].sort((a, b) => (a.sub || "").localeCompare(b.sub || ""));
  return regions;
}

// Valid new-parent options for moving a node of childKind (existing + staged new
// of the parent kind), excluding the node's current parent. Labels carry the
// code (e.g. "D111", "Area 09") and, for existing nodes, the current leader.
function parentChoices(childKind: MoveKind, tree: OrgTree, nodes: AlignmentNode[], leaders: Map<string, string>): { key: string; label: string; isNew: boolean }[] {
  const pk: NodeKind = childKind === "store" ? "district" : childKind === "district" ? "area" : "region";
  const existing = pk === "region" ? tree.regions : pk === "area" ? tree.areas : tree.districts;
  return [
    ...existing.map((n) => { const l = leaders.get(n.id); return { key: n.id, label: `${n.code} · ${n.name}${l ? ` — ${l}` : ""}`, isNew: false }; }),
    ...nodes.filter((n) => n.kind === pk).map((n) => ({ key: n.ref, label: `${n.code} · ${n.name} (new)`, isNew: true })),
  ];
}

// Next code/number for a new region/area/district: take the highest existing
// code of that kind (live + staged), keep its prefix + zero-pad width, and add
// one. Falls back to a sensible default when there are none yet.
function nextCode(kind: NodeKind, tree: OrgTree, nodes: AlignmentNode[]): string {
  const codes: string[] = [
    ...(kind === "region" ? tree.regions : kind === "area" ? tree.areas : tree.districts).map((n) => n.code),
    ...nodes.filter((n) => n.kind === kind).map((n) => n.code),
  ];
  let best: { prefix: string; num: number; pad: number } | null = null;
  for (const c of codes) {
    const m = /^(.*?)(\d+)\s*$/.exec(c ?? "");
    if (!m) continue;
    const num = parseInt(m[2], 10);
    if (!best || num >= best.num) best = { prefix: m[1], num, pad: m[2].length };
  }
  if (!best) return kind === "region" ? "R1" : kind === "area" ? "Area 01" : "D101";
  return best.prefix + String(best.num + 1).padStart(best.pad, "0");
}

// ── Current leaders ──────────────────────────────────────────────────────────
// The Org Admin tree carries managers at every level; we surface the current
// leader next to each existing region/area/district (RVP / SDO / DO). Primary
// (non-acting) holders win; multiple are joined with " / ".
function leaderLabel(managers: OrgManager[], role: string): string {
  const scoped = managers.filter((m) => m.role === role);
  const primary = scoped.filter((m) => !m.acting);
  const chosen = primary.length ? primary : scoped;
  return chosen.map((m) => m.full_name?.trim() || m.email).filter(Boolean).join(" / ");
}
// Map real node id → current leader name, for regions/areas/districts.
function buildLeaderMap(tree: OrgTreeResponse): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of tree.regions) {
    const rl = leaderLabel(r.managers, "rvp"); if (rl) m.set(r.id, rl);
    for (const a of r.areas) {
      const al = leaderLabel(a.managers, "sdo"); if (al) m.set(a.id, al);
      for (const d of a.districts) {
        const dl = leaderLabel(d.managers, "do"); if (dl) m.set(d.id, dl);
      }
    }
  }
  return m;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function OrgAlignmentPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Org Alignment"
        description="Move markets and stores around on the tree, then schedule the change to go live on a date. Nothing changes until it applies."
      />
      {openId ? <AlignmentDetail id={openId} onBack={() => setOpenId(null)} /> : <AlignmentList onOpen={setOpenId} />}
    </>
  );
}

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
      <div className="flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-3.5 w-3.5" /> New alignment</Button></div>
      {q.isLoading ? <Skeleton className="h-40 w-full" />
        : q.isError ? <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />
        : alignments.length === 0 ? <EmptyState title="No alignments yet" description="Create one to stage a market realignment." />
        : (
          <div className="space-y-2">
            {alignments.map((a) => (
              <button key={a.id} onClick={() => onOpen(a.id)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-left hover:border-accent/60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-semibold text-midnight">{a.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLE[a.status])}>{a.status}</span></div>
                  <div className="mt-0.5 text-xs text-zinc-500">Effective {fmtDate(a.effective_date)} · {a.change_count?.nodes ?? 0} new · {a.change_count?.moves ?? 0} move(s)</div>
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

function AlignmentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["org-alignment", id], queryFn: () => fetchAlignment(id) });
  const treeQ = useQuery({ queryKey: ["org-alignment-tree"], queryFn: fetchOrgTree });
  const leadersQ = useQuery({ queryKey: ["org-alignment-leaders"], queryFn: fetchAdminOrgTree });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["org-alignment", id] }); qc.invalidateQueries({ queryKey: ["org-alignments"] }); };

  const a = q.data?.alignment;
  const tree = treeQ.data;
  const locked = a?.status === "applied" || a?.status === "canceled";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addRegion, setAddRegion] = useState(false);

  const mut = <T, V = void>(fn: (v: V) => Promise<T>, msg?: string) => ({
    onSuccess: () => { if (msg) toast.push(msg, "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"), mutationFn: fn,
  });
  const schedule = useMutation(mut(() => updateAlignment({ id, status: "scheduled" }), "Scheduled — it'll go live on its effective date."));
  const unschedule = useMutation(mut(() => updateAlignment({ id, status: "draft" }), "Back to draft."));
  const cancel = useMutation(mut(() => updateAlignment({ id, status: "canceled" }), "Canceled."));
  const del = useMutation(mut(() => deleteAlignment(id), "Deleted."));
  const apply = useMutation(mut(() => applyAlignment(id), "Applied — the org tree is updated."));
  const rollback = useMutation(mut(() => rollbackAlignment(id), "Rolled back."));
  const stageMove = useMutation(mut((v: { kind: MoveKind; node_id: string; parent: { key: string; isNew: boolean } }) =>
    addMove({ alignment_id: id, kind: v.kind, node_id: v.node_id, ...(v.parent.isNew ? { new_parent_ref: v.parent.key } : { new_parent_id: v.parent.key }) })));
  const undoMove = useMutation(mut((mid: string) => removeMove(mid)));
  const stageNode = useMutation(mut((v: { kind: NodeKind; name: string; code: string; parent?: { key: string; isNew: boolean } }) =>
    addNode({ alignment_id: id, ref: newRef(v.kind), kind: v.kind, name: v.name, code: v.code, ...(v.parent ? (v.parent.isNew ? { parent_ref: v.parent.key } : { parent_id: v.parent.key }) : {}) })));
  const undoNode = useMutation(mut((nid: string) => removeNode(nid)));

  const projected = useMemo(() => (tree && a ? projectTree(tree, a.nodes ?? [], a.moves ?? []) : []), [tree, a]);
  const leaders = useMemo(() => (leadersQ.data ? buildLeaderMap(leadersQ.data) : new Map<string, string>()), [leadersQ.data]);
  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const expand = (k: string) => setExpanded((s) => new Set(s).add(k));

  if (q.isLoading || treeQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !a || !tree) return <EmptyState title="Couldn't load alignment" description={(q.error as Error)?.message ?? "Try again."} />;

  const changeCount = (a.nodes?.length ?? 0) + (a.moves?.length ?? 0);
  const nodeCtx = {
    tree, nodes: a.nodes ?? [], locked, expanded, toggle, expand, leaders,
    onMove: (kind: MoveKind, node_id: string, parent: { key: string; isNew: boolean }) => stageMove.mutate({ kind, node_id, parent }),
    onUndoMove: (mid: string) => undoMove.mutate(mid),
    onUndoNode: (nid: string) => undoNode.mutate(nid),
    onAddChild: (kind: NodeKind, name: string, code: string, parent: { key: string; isNew: boolean }) => stageNode.mutate({ kind, name, code, parent }),
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> All alignments</button>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><span className="text-lg font-bold text-midnight">{a.name}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLE[a.status])}>{a.status}</span></div>
            <div className="mt-0.5 text-xs text-zinc-500">Effective {fmtDate(a.effective_date)} · {changeCount} staged change{changeCount === 1 ? "" : "s"}{a.applied_at ? ` · applied ${fmtDate(a.applied_at.slice(0, 10))}` : ""}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a.status === "draft" && <Button size="sm" disabled={schedule.isPending || changeCount === 0} onClick={() => schedule.mutate()}><CalendarClock className="mr-1 h-3.5 w-3.5" /> Schedule</Button>}
            {a.status === "scheduled" && <Button size="sm" variant="secondary" disabled={unschedule.isPending} onClick={() => unschedule.mutate()}>Unschedule</Button>}
            {(a.status === "draft" || a.status === "scheduled") && (
              <Button size="sm" variant="secondary" disabled={apply.isPending || changeCount === 0} onClick={() => { if (window.confirm("Apply this alignment to the live org tree now?")) apply.mutate(); }}><Check className="mr-1 h-3.5 w-3.5" /> Apply now</Button>
            )}
            {a.status === "applied" && (
              <Button size="sm" variant="secondary" className="text-amber-700 ring-amber-200" disabled={rollback.isPending} onClick={() => { if (window.confirm("Roll back? Reverts every move and deletes the nodes it created.")) rollback.mutate(); }}><Undo2 className="mr-1 h-3.5 w-3.5" /> Roll back</Button>
            )}
            {a.status !== "applied" && a.status !== "canceled" && <Button size="sm" variant="ghost" className="text-zinc-500" disabled={cancel.isPending} onClick={() => { if (window.confirm("Cancel this alignment?")) cancel.mutate(); }}><X className="h-3.5 w-3.5" /></Button>}
            {a.status !== "applied" && <Button size="sm" variant="ghost" className="text-red-600" disabled={del.isPending} onClick={() => { if (window.confirm("Delete permanently?")) { del.mutate(); onBack(); } }}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        </CardBody>
      </Card>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> new</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> moving</span>
          <span className="ml-auto"><Button size="sm" variant="secondary" onClick={() => setAddRegion(true)}><Plus className="mr-1 h-3.5 w-3.5" /> Add region</Button></span>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-1.5">
        {projected.map((r) => <TreeRow key={r.key} node={r} depth={0} ctx={nodeCtx} />)}
      </div>

      <NodeFormModal open={addRegion} kind="region" defaultCode={nextCode("region", tree, a.nodes ?? [])} onClose={() => setAddRegion(false)}
        onSave={(name, code) => { stageNode.mutate({ kind: "region", name, code }); setAddRegion(false); }} />
    </div>
  );
}

interface Ctx {
  tree: OrgTree; nodes: AlignmentNode[]; locked: boolean;
  expanded: Set<string>; toggle: (k: string) => void; expand: (k: string) => void; leaders: Map<string, string>;
  onMove: (kind: MoveKind, node_id: string, parent: { key: string; isNew: boolean }) => void;
  onUndoMove: (mid: string) => void; onUndoNode: (nid: string) => void;
  onAddChild: (kind: NodeKind, name: string, code: string, parent: { key: string; isNew: boolean }) => void;
}
const KIND_TAG: Record<PKind, string> = { region: "R", area: "AREA", district: "D", store: "" };
const leaderFor = (ctx: Ctx, nodeId: string): string => ctx.leaders.get(nodeId) ?? "";
const CHILD_KIND: Record<PKind, NodeKind | null> = { region: "area", area: "district", district: null, store: null };

function TreeRow({ node, depth, ctx }: { node: PNode; depth: number; ctx: Ctx }) {
  const [moving, setMoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const hasChildren = node.children.length > 0;
  const open = ctx.expanded.has(node.key);
  const childKind = CHILD_KIND[node.kind];
  const canMove = !ctx.locked && node.kind !== "region" && !node.isNew; // existing area/district/store
  const moveKind = node.kind as MoveKind;

  return (
    <div>
      <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50" style={{ paddingLeft: depth * 18 + 8 }}>
        <button onClick={() => hasChildren && ctx.toggle(node.key)} className={cn("shrink-0 text-zinc-300", !hasChildren && "invisible")}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {KIND_TAG[node.kind] && <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">{KIND_TAG[node.kind]}{node.sub && node.kind !== "region" ? ` ${node.sub}` : ""}</span>}
        <span className={cn("truncate text-sm", node.kind === "store" ? "text-zinc-700" : "font-semibold text-midnight")}>{node.label}</span>
        {node.isNew && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">new</span>}
        {node.moved && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">moving</span>}
        {node.kind !== "store" && node.nodeId && leaderFor(ctx, node.nodeId) && (
          <span className="min-w-0 truncate text-xs text-zinc-400" title={leaderFor(ctx, node.nodeId)}>· {leaderFor(ctx, node.nodeId)}</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
          {canMove && !node.moved && <button onClick={() => setMoving((v) => !v)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-zinc-200 hover:text-accent">Move</button>}
          {node.moved && node.moveId && <button onClick={() => ctx.onUndoMove(node.moveId!)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:underline">undo move</button>}
          {node.isNew && node.newId && !ctx.locked && <button onClick={() => ctx.onUndoNode(node.newId!)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 hover:underline">remove</button>}
          {!ctx.locked && childKind && <button onClick={() => setAdding((v) => !v)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-zinc-200 hover:text-accent"><Plus className="inline h-3 w-3" /> {childKind}</button>}
        </div>
      </div>

      {moving && canMove && (
        <MovePicker node={node} moveKind={moveKind} ctx={ctx} depth={depth} onDone={() => setMoving(false)} />
      )}
      {adding && childKind && (
        <div style={{ paddingLeft: (depth + 1) * 18 + 8 }} className="py-1">
          <InlineNodeForm kind={childKind} defaultCode={nextCode(childKind, ctx.tree, ctx.nodes)} onCancel={() => setAdding(false)}
            onSave={(name, code) => { ctx.onAddChild(childKind, name, code, { key: node.key, isNew: node.isNew }); ctx.expand(node.key); setAdding(false); }} />
        </div>
      )}

      {open && node.children.map((c) => <TreeRow key={c.key} node={c} depth={depth + 1} ctx={ctx} />)}
    </div>
  );
}

function MovePicker({ node, moveKind, ctx, depth, onDone }: { node: PNode; moveKind: MoveKind; ctx: Ctx; depth: number; onDone: () => void }) {
  const [target, setTarget] = useState("");
  const choices = parentChoices(moveKind, ctx.tree, ctx.nodes, ctx.leaders).filter((c) => c.key !== node.key);
  return (
    <div style={{ paddingLeft: (depth + 1) * 18 + 8 }} className="flex items-center gap-2 py-1">
      <CornerDownRight className="h-3.5 w-3.5 text-zinc-300" />
      <select value={target} onChange={(e) => setTarget(e.target.value)} className={cn(inputCls, "w-56")}>
        <option value="">Move to…</option>
        {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <Button size="sm" disabled={!target} onClick={() => { const c = choices.find((x) => x.key === target)!; ctx.onMove(moveKind, node.nodeId!, { key: c.key, isNew: c.isNew }); onDone(); }}>Move</Button>
      <button onClick={onDone} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
    </div>
  );
}

function InlineNodeForm({ kind, defaultCode, onSave, onCancel }: { kind: NodeKind; defaultCode?: string; onSave: (name: string, code: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(defaultCode ?? "");
  return (
    <div className="flex items-center gap-2">
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">new {kind}</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={cn(inputCls, "w-44")} autoFocus />
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" title="Auto-assigned — edit if needed" className={cn(inputCls, "w-28")} />
      <Button size="sm" disabled={!name.trim() || !code.trim()} onClick={() => onSave(name.trim(), code.trim())}>Add</Button>
      <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
    </div>
  );
}

function NodeFormModal({ open, kind, defaultCode, onClose, onSave }: { open: boolean; kind: NodeKind; defaultCode?: string; onClose: () => void; onSave: (name: string, code: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(defaultCode ?? "");
  // Re-seed the auto-assigned code whenever the modal (re)opens.
  useEffect(() => { if (open) { setName(""); setCode(defaultCode ?? ""); } }, [open, defaultCode]);
  return (
    <Modal open={open} onClose={onClose} title={`New ${kind}`} maxWidth="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || !code.trim()} onClick={() => { onSave(name.trim(), code.trim()); setName(""); setCode(""); }}>Add</Button></>}>
      <div className="space-y-3">
        <div><Label htmlFor="nf-name">Name *</Label><Input id="nf-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="nf-code">Code *</Label><Input id="nf-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. R5 / AREA 09 / D203" /><p className="mt-1 text-xs text-zinc-400">Auto-assigned to the next number — edit if needed.</p></div>
      </div>
    </Modal>
  );
}
