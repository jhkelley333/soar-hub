// Org Alignment — "download changes" PDF. Renders the FULL projected org tree
// (regions → areas → districts → stores) with the alignment's staged changes
// highlighted: new nodes in green, moved nodes in blue. A summary of just the
// changes leads the document. Generated client-side with jsPDF, same as the Org
// Chart PDF. Structure only — leadership shown for context where known.
import { jsPDF } from "jspdf";
import type { OrgAlignment, OrgTree, AlignmentNode } from "./api";
import { projectTree, type PNode } from "./projection";

const GREEN: [number, number, number] = [16, 122, 87];   // new
const BLUE: [number, number, number] = [29, 78, 216];    // moved
const INK: [number, number, number] = [20, 30, 45];
const MUTED: [number, number, number] = [120, 120, 120];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "alignment";

export function downloadChangesPdf(a: OrgAlignment, tree: OrgTree, leaders: Map<string, string>): void {
  const nodes = a.nodes ?? [];
  const moves = a.moves ?? [];
  const roots = projectTree(tree, nodes, moves);

  // Lookups for the change summary (id/ref → readable name).
  const byId = new Map<string, string>();
  for (const r of tree.regions) byId.set(r.id, `${r.code} · ${r.name}`);
  for (const ar of tree.areas) byId.set(ar.id, `${ar.code} · ${ar.name}`);
  for (const d of tree.districts) byId.set(d.id, `${d.code} · ${d.name}`);
  for (const s of tree.stores) byId.set(s.id, `#${s.number} ${s.name}`);
  const newByRef = new Map<string, AlignmentNode>(nodes.map((n) => [n.ref, n]));
  const parentLabel = (id: string | null, ref: string | null): string => {
    if (id && byId.has(id)) return byId.get(id)!;
    if (ref && newByRef.has(ref)) { const n = newByRef.get(ref)!; return `${n.code} · ${n.name} (new)`; }
    return "—";
  };

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const bottom = pageH - M;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  let y = M;
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M; } };
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); setColor(INK);
  doc.text(`Org Alignment — ${a.name}`, M, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); setColor(MUTED);
  const eff = new Date(`${a.effective_date}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  doc.text(`Effective ${eff}  ·  status: ${a.status}  ·  ${nodes.length} new · ${moves.length} move(s)  ·  generated ${today}`, M, y); y += 6;

  // Legend
  doc.setFontSize(8.5);
  setColor(GREEN); doc.text("● new", M, y);
  setColor(BLUE); doc.text("● moved", M + 18, y);
  setColor(MUTED); doc.text("○ unchanged", M + 40, y);
  y += 7;

  // ── Change summary ──────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); setColor(INK);
  doc.text("Staged changes", M, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  if (nodes.length === 0 && moves.length === 0) {
    setColor(MUTED); doc.text("No changes staged.", M + 2, y); y += 5;
  }
  for (const n of nodes) {
    ensure(5); setColor(GREEN);
    doc.text(`NEW ${n.kind}  ${n.code} · ${n.name}  →  under ${parentLabel(n.parent_id, n.parent_ref)}`, M + 2, y);
    y += 4.6;
  }
  for (const m of moves) {
    ensure(5); setColor(BLUE);
    const who = byId.get(m.node_id) ?? m.node_id;
    doc.text(`MOVE ${m.kind}  ${who}  →  ${parentLabel(m.new_parent_id, m.new_parent_ref)}`, M + 2, y);
    y += 4.6;
  }
  y += 4;

  // ── Full projected tree ─────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); setColor(INK);
  ensure(6); doc.text("Projected org (after apply)", M, y); y += 5;

  const TAG: Record<string, string> = { region: "R", area: "AREA", district: "D", store: "" };
  const renderNode = (node: PNode, depth: number) => {
    if (node.kind === "store") return; // stores handled compactly under districts
    ensure(6);
    const x = M + depth * 6;
    const color = node.isNew ? GREEN : node.moved ? BLUE : INK;
    const mark = node.isNew ? "●" : node.moved ? "●" : "○";
    doc.setFont("helvetica", node.kind === "region" ? "bold" : "normal");
    doc.setFontSize(node.kind === "region" ? 10.5 : node.kind === "area" ? 9.8 : 9);
    setColor(node.isNew ? GREEN : node.moved ? BLUE : MUTED);
    doc.text(mark, x, y);
    setColor(color);
    const tag = TAG[node.kind] ? `${TAG[node.kind]}${node.sub ? ` ${node.sub}` : ""}  ` : "";
    const leader = node.nodeId ? leaders.get(node.nodeId) : "";
    const line = `${tag}${node.label}`;
    const suffix = node.isNew ? "   [NEW]" : node.moved ? "   [MOVED]" : "";
    doc.text(line + suffix, x + 4, y);
    if (leader) {
      const w = doc.getTextWidth(line + suffix);
      doc.setFont("helvetica", "italic"); setColor(MUTED); doc.setFontSize(8);
      doc.text(`— ${leader}`, x + 4 + w + 3, y);
    }
    y += node.kind === "region" ? 6 : 5;

    // District: list its stores compactly, highlighting moved ones.
    if (node.kind === "district" && node.children.length) {
      const stores = node.children;
      const colW = (pageW - 2 * M - (depth + 1) * 6) / 2;
      const sx = M + (depth + 1) * 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
      for (let i = 0; i < stores.length; i += 2) {
        ensure(4.4);
        for (let c = 0; c < 2 && i + c < stores.length; c++) {
          const s = stores[i + c];
          setColor(s.moved ? BLUE : MUTED);
          doc.text(`${s.moved ? "● " : ""}${s.label}${s.moved ? " [MOVED]" : ""}`, sx + c * colW, y);
        }
        y += 4.2;
      }
      y += 1.5;
      return;
    }
    for (const child of node.children) renderNode(child, depth + 1);
  };
  for (const r of roots) renderNode(r, 0);

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); setColor(MUTED);
    doc.text(`${a.name} · page ${p} of ${pages}`, M, pageH - 6);
  }

  doc.save(`org-alignment-${slug(a.name)}-${a.effective_date}.pdf`);
}
