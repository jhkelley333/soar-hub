// Shared projection logic for the Org Alignment tool. Given the live org tree
// plus an alignment's staged new nodes and moves, compute the PROJECTED tree
// (what the org looks like after the alignment applies) with per-node change
// flags. Used by both the interactive builder (OrgAlignmentPage) and the
// "download changes" PDF, so the two never drift.
import type { OrgTree, AlignmentNode, AlignmentMove, NodeKind, MoveKind } from "./api";
import type { OrgManager, OrgTreeResponse } from "@/modules/admin/api";

export type PKind = "region" | "area" | "district" | "store";
export interface PNode {
  key: string;            // real id for existing nodes, ref for staged new nodes
  kind: PKind;
  label: string;
  sub?: string;           // code
  isNew: boolean;         // a staged new node
  moved: boolean;         // an existing node with a staged move
  moveId?: string;        // the staged move's id (for undo)
  nodeId?: string;        // existing real id (for moving)
  newId?: string;         // the staged new node's DB row id (for remove/undo)
  children: PNode[];
}

// Build the projected tree: current org tree + staged new nodes + staged moves.
export function projectTree(tree: OrgTree, nodes: AlignmentNode[], moves: AlignmentMove[]): PNode[] {
  const moveByNode = new Map(moves.map((m) => [m.node_id, m]));
  const targetKey = (m?: { new_parent_id: string | null; new_parent_ref: string | null } | null) =>
    m ? (m.new_parent_ref || m.new_parent_id || "") : "";

  const areaParent = (a: OrgTree["areas"][number]) => moveByNode.has(a.id) ? targetKey(moveByNode.get(a.id)) : a.region_id;
  const distParent = (d: OrgTree["districts"][number]) => moveByNode.has(d.id) ? targetKey(moveByNode.get(d.id)) : d.area_id;
  const storeParent = (s: OrgTree["stores"][number]) => moveByNode.has(s.id) ? targetKey(moveByNode.get(s.id)) : s.district_id;

  const newBy = (kind: NodeKind) => nodes.filter((n) => n.kind === kind);
  const newParentKey = (n: AlignmentNode) => n.parent_ref || n.parent_id || "";

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
// of the parent kind). Labels carry the code and, for existing nodes, the leader.
export function parentChoices(childKind: MoveKind, tree: OrgTree, nodes: AlignmentNode[], leaders: Map<string, string>): { key: string; label: string; isNew: boolean }[] {
  const pk: NodeKind = childKind === "store" ? "district" : childKind === "district" ? "area" : "region";
  const existing = pk === "region" ? tree.regions : pk === "area" ? tree.areas : tree.districts;
  return [
    ...existing.map((n) => { const l = leaders.get(n.id); return { key: n.id, label: `${n.code} · ${n.name}${l ? ` — ${l}` : ""}`, isNew: false }; }),
    ...nodes.filter((n) => n.kind === pk).map((n) => ({ key: n.ref, label: `${n.code} · ${n.name} (new)`, isNew: true })),
  ];
}

// Next code/number for a new region/area/district: highest existing code of that
// kind (live + staged), same prefix + zero-pad width, plus one.
export function nextCode(kind: NodeKind, tree: OrgTree, nodes: AlignmentNode[]): string {
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

// Current leader name at a node: primary (non-acting) holders win; joined " / ".
export function leaderLabel(managers: OrgManager[], role: string): string {
  const scoped = managers.filter((m) => m.role === role);
  const primary = scoped.filter((m) => !m.acting);
  const chosen = primary.length ? primary : scoped;
  return chosen.map((m) => m.full_name?.trim() || m.email).filter(Boolean).join(" / ");
}
// Map real node id → current leader name, for regions/areas/districts.
export function buildLeaderMap(tree: OrgTreeResponse): Map<string, string> {
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
