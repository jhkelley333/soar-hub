// Org Alignment — "download changes" PDF. Renders the FULL projected org tree
// (regions > areas > districts > stores) with the alignment's staged changes
// highlighted: new in green, moved in blue, leader changes in violet. A summary
// of just the changes leads the document. Generated client-side with jsPDF.
//
// NB: jsPDF's standard fonts are WinAnsi/CP1252 — glyphs like ●, ○, → render as
// garbage and can trigger a font fallback that letter-spaces the whole run. So
// markers are drawn (filled dots) or ASCII, and every line is width-truncated so
// columns never collide.
import { jsPDF } from "jspdf";
import type { OrgAlignment, OrgTree, AlignmentNode } from "./api";
import { projectTree, type PNode } from "./projection";

const GREEN: [number, number, number] = [16, 122, 87];   // new
const BLUE: [number, number, number] = [29, 78, 216];    // moved
const VIOLET: [number, number, number] = [124, 58, 173]; // leader move
const INK: [number, number, number] = [24, 32, 46];
const MUTED: [number, number, number] = [125, 130, 140];
const FAINT: [number, number, number] = [190, 195, 203];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "alignment";

export function downloadChangesPdf(a: OrgAlignment, tree: OrgTree, leaders: Map<string, string>, userNames?: Map<string, string>): void {
  const nodes = a.nodes ?? [];
  const moves = a.moves ?? [];
  const leaderMoves = a.leader_moves ?? [];
  const leaderAdds = a.leader_adds ?? [];
  const roots = projectTree(tree, nodes, moves);

  // Lookups for the change summary (id/ref -> readable name).
  const byId = new Map<string, string>();
  for (const r of tree.regions) byId.set(r.id, `${r.code} · ${r.name}`);
  for (const ar of tree.areas) byId.set(ar.id, `${ar.code} · ${ar.name}`);
  for (const d of tree.districts) byId.set(d.id, `${d.code} · ${d.name}`);
  for (const s of tree.stores) byId.set(s.id, `#${s.number} ${s.name}`);
  const newByRef = new Map<string, AlignmentNode>(nodes.map((n) => [n.ref, n]));
  const parentLabel = (id: string | null, ref: string | null): string => {
    if (id && byId.has(id)) return byId.get(id)!;
    if (ref && newByRef.has(ref)) { const n = newByRef.get(ref)!; return `${n.code} · ${n.name} (new)`; }
    return "n/a";
  };

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const bottom = pageH - M;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  let y = M;
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M; } };
  const setColor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  // Truncate to a width in the CURRENT font/size, appending an ellipsis.
  const fit = (text: string, maxW: number): string => {
    if (maxW <= 0) return "";
    if (doc.getTextWidth(text) <= maxW) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(t + "…") > maxW) t = t.slice(0, -1);
    return t + "…";
  };
  const dot = (cx: number, cy: number, c: [number, number, number]) => {
    doc.setFillColor(c[0], c[1], c[2]); doc.circle(cx, cy, 1, "F");
  };

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); setColor(INK);
  doc.text(`Org Alignment — ${a.name}`, M, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); setColor(MUTED);
  const eff = new Date(`${a.effective_date}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  doc.text(`Effective ${eff}   ·   status: ${a.status}   ·   ${nodes.length} new · ${moves.length} moved · ${leaderMoves.length} leader move(s) · ${leaderAdds.length} invite(s)   ·   generated ${today}`, M, y); y += 7;

  // Legend — drawn swatches, no glyphs.
  doc.setFontSize(8.5);
  let lx = M;
  const legend = (label: string, c: [number, number, number]) => {
    dot(lx + 1, y - 0.8, c); setColor(INK); doc.text(label, lx + 3.5, y);
    lx += 3.5 + doc.getTextWidth(label) + 8;
  };
  legend("New", GREEN); legend("Moved", BLUE); legend("Leader change", VIOLET); legend("Unchanged", FAINT);
  y += 8;

  // ── Change summary ──────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); setColor(INK);
  doc.text("Staged changes", M, y); y += 5.5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const total = nodes.length + moves.length + leaderMoves.length + leaderAdds.length;
  if (total === 0) { setColor(MUTED); doc.text("No changes staged.", M + 2, y); y += 5; }
  const summary = (c: [number, number, number], text: string) => {
    ensure(5); setColor(c); doc.text(fit(text, pageW - 2 * M), M + 2, y); y += 4.8;
  };
  for (const n of nodes) summary(GREEN, `NEW ${n.kind}   ${n.code} · ${n.name}   ->  under ${parentLabel(n.parent_id, n.parent_ref)}`);
  for (const m of moves) summary(BLUE, `MOVE ${m.kind}   ${byId.get(m.node_id) ?? m.node_id}   ->  ${parentLabel(m.new_parent_id, m.new_parent_ref)}`);
  for (const lm of leaderMoves) {
    const role = lm.scope_type === "area" ? "SDO" : "DO";
    const from = (lm.from_scope_id && byId.get(lm.from_scope_id)) || "current";
    summary(VIOLET, `LEADER ${role}   ${userNames?.get(lm.user_id) ?? "Leader"}   ${from}  ->  ${parentLabel(lm.to_scope_id, lm.to_scope_ref)}`);
  }
  for (const la of leaderAdds) summary(GREEN, `NEW ${la.role.toUpperCase()} (invite)   ${la.full_name?.trim() || la.email} <${la.email}>  ->  ${parentLabel(la.to_scope_id, la.to_scope_ref)}`);
  y += 5;

  // ── Full projected tree ─────────────────────────────────────────────────
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); setColor(INK);
  ensure(6); doc.text("Projected org (after apply)", M, y); y += 6;

  const renderNode = (node: PNode, depth: number) => {
    if (node.kind === "store") return; // stores handled compactly under districts
    ensure(6);
    const x = M + depth * 7;
    const color = node.isNew ? GREEN : node.moved ? BLUE : INK;
    // status dot to the left of the row (drawn, print-safe)
    dot(x + 1, y - 0.8, node.isNew ? GREEN : node.moved ? BLUE : FAINT);
    const tx = x + 4;
    doc.setFont("helvetica", node.kind === "district" ? "normal" : "bold");
    doc.setFontSize(node.kind === "region" ? 11 : node.kind === "area" ? 9.8 : 9);
    setColor(color);
    // Code already carries its letter (R4 / Area 07 / D123) — no redundant prefix.
    const code = node.sub ? `${node.sub}  ` : "";
    const suffix = node.isNew ? "   [NEW]" : node.moved ? "   [MOVED]" : "";
    const main = fit(`${code}${node.label}${suffix}`, pageW - M - tx);
    doc.text(main, tx, y);
    const leader = node.nodeId ? leaders.get(node.nodeId) : "";
    if (leader) {
      const w = doc.getTextWidth(main);
      doc.setFont("helvetica", "italic"); doc.setFontSize(8); setColor(MUTED);
      const lead = fit(`— ${leader}`, pageW - M - (tx + w + 3));
      if (lead.length > 2) doc.text(lead, tx + w + 3, y);
    }
    y += node.kind === "region" ? 6.5 : node.kind === "area" ? 5.6 : 5;

    // District: its stores in truncated columns, moved ones flagged in blue.
    if (node.kind === "district" && node.children.length) {
      const stores = node.children;
      const cols = 3;
      const sx = M + (depth + 1) * 7;
      const gutter = 5;
      const colW = (pageW - M - sx) / cols;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.8);
      for (let i = 0; i < stores.length; i += cols) {
        ensure(4.3);
        for (let c = 0; c < cols && i + c < stores.length; c++) {
          const s = stores[i + c];
          setColor(s.moved ? BLUE : MUTED);
          doc.text(fit(`${s.moved ? "» " : ""}${s.label}`, colW - gutter), sx + c * colW, y);
        }
        y += 4.2;
      }
      y += 2.5;
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
    doc.text(`${a.name}  ·  page ${p} of ${pages}`, M, pageH - 6);
  }

  doc.save(`org-alignment-${slug(a.name)}-${a.effective_date}.pdf`);
}
