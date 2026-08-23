// SOAR QSR Org Chart — poster PDF. Reproduces the uploaded visual org chart: an
// executive block on top, then a connected tree of RVP -> SDO -> DO boxes (each
// DO box carrying its district name + store list), with elbow connectors between
// tiers. One wide landscape page sized to the tree, like the source poster.
// jsPDF, client-side, downloadable from Org Admin.
import { jsPDF } from "jspdf";
import type { OrgArea, OrgDistrict, OrgManager, OrgRegion, OrgTreeResponse } from "./api";

// Executive header — the leadership above the regions. The org tree only covers
// RVP and below, so this block is a fixed, editable header (kept in sync with the
// source chart). Row-major, laid out centered across the top.
const EXEC_ROWS: { name: string; title: string }[][] = [
  [{ name: "Nik Bhakta", title: "Principal" }, { name: "Ron Parikh", title: "Principal" }],
  [{ name: "Khaled Habash", title: "COO" }, { name: "Jay Patel", title: "COS" }, { name: "Syed Zaidi", title: "VP of Accounting" }],
  [
    { name: "Adam Scott", title: "VP of People Development" },
    { name: "Heath Kelley", title: "VP of Operations" },
    { name: "Pinakin Bhakta", title: "Compliance Manager" },
    { name: "Cory Posey", title: "Director of Financial Analysis" },
    { name: "QSCulinary", title: "Full Back Office Solutions" },
  ],
];

const NAVY: [number, number, number] = [30, 58, 95];
const SDO_BLUE: [number, number, number] = [46, 94, 140];
const DO_BG: [number, number, number] = [220, 231, 241];
const EXEC_BG: [number, number, number] = [21, 50, 75];
const LINE: [number, number, number] = [148, 163, 184];

const DO_W = 48;
const RVP_W = 60;
const SDO_W = 54;
const BOX_H = 17;
const DO_H = 26;
const GAPX = 8;
const M = 14;

function leaderName(managers: OrgManager[], role: string): string {
  const scoped = managers.filter((m) => String(m.role).toLowerCase() === role);
  const pool = scoped.length ? scoped : managers;
  const primary = pool.filter((m) => !m.acting);
  const chosen = (primary.length ? primary : pool).map((m) => m.full_name || m.email).filter(Boolean);
  return chosen.length ? chosen.join(" / ") : "";
}
const activeStores = (d: OrgDistrict) => d.stores.filter((s) => s.is_active !== false);
const areaCount = (a: OrgArea) => a.districts.reduce((n, d) => n + activeStores(d).length, 0);
const regionCount = (r: OrgRegion) => r.areas.reduce((n, a) => n + areaCount(a), 0);

interface Node {
  tier: "rvp" | "sdo" | "do";
  cx: number; // center x
  name: string; title: string; extra: string;
  children: Node[];
}

export function exportOrgChartPosterPdf(tree: OrgTreeResponse | null): void {
  if (!tree || !tree.regions.length) return;

  // ── Layout: place DO leaves left→right; parents center over their children ──
  let cursor = M;
  const rvps: Node[] = [];
  for (const r of tree.regions.filter((x) => x.is_active !== false)) {
    const rvpNode: Node = { tier: "rvp", cx: 0, name: leaderName(r.managers, "rvp") || r.name, title: "Regional Vice President of Operations", extra: String(regionCount(r)), children: [] };
    const areas = r.areas.filter((a) => a.is_active !== false);
    for (const a of areas) {
      const sdoNode: Node = { tier: "sdo", cx: 0, name: leaderName(a.managers, "sdo") || a.name, title: "Senior Director of Operations", extra: String(areaCount(a)), children: [] };
      const dists = a.districts.filter((d) => d.is_active !== false);
      for (const d of dists) {
        const stores = activeStores(d).map((s) => s.number).join(", ");
        const doNode: Node = { tier: "do", cx: cursor + DO_W / 2, name: leaderName(d.managers, "do") || "—", title: d.name, extra: stores, children: [] };
        cursor += DO_W + GAPX;
        sdoNode.children.push(doNode);
      }
      if (!sdoNode.children.length) { sdoNode.cx = cursor + DO_W / 2; cursor += DO_W + GAPX; }
      else sdoNode.cx = (sdoNode.children[0].cx + sdoNode.children[sdoNode.children.length - 1].cx) / 2;
      rvpNode.children.push(sdoNode);
    }
    if (!rvpNode.children.length) { rvpNode.cx = cursor + DO_W / 2; cursor += DO_W + GAPX; }
    else rvpNode.cx = (rvpNode.children[0].cx + rvpNode.children[rvpNode.children.length - 1].cx) / 2;
    rvps.push(rvpNode);
  }

  const treeW = cursor - GAPX + M;
  const execH = 12 + EXEC_ROWS.length * (BOX_H + 6);
  const rvpY = execH + 16;
  const sdoY = rvpY + BOX_H + 20;
  const doY = sdoY + BOX_H + 20;
  const pageW = Math.max(260, treeW);
  const pageH = doY + DO_H + M + 6;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pageW, pageH] });
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

  // Title.
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...NAVY);
  doc.text("SOAR QSR Org Chart", pageW / 2, M - 4, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
  doc.text(date, pageW / 2, M, { align: "center" });

  // ── Executive block (centered rows) ──
  let ey = M + 4;
  const execWidth = 52;
  for (const row of EXEC_ROWS) {
    const rowW = row.length * execWidth + (row.length - 1) * GAPX;
    let ex = (pageW - rowW) / 2;
    for (const e of row) {
      drawBox(doc, ex, ey, execWidth, BOX_H, [{ t: e.name, size: 9, bold: true, color: [255, 255, 255] }, { t: e.title, size: 6.5, bold: false, color: [200, 214, 232] }], EXEC_BG);
      ex += execWidth + GAPX;
    }
    ey += BOX_H + 6;
  }

  // Connector from the exec block down to the RVP tier bus.
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  if (rvps.length) {
    const busY = rvpY - 8;
    doc.line(pageW / 2, ey - 3, pageW / 2, busY);
    const xs = rvps.map((n) => n.cx);
    doc.line(Math.min(...xs), busY, Math.max(...xs), busY);
    for (const n of rvps) doc.line(n.cx, busY, n.cx, rvpY);
  }

  // ── Tiers + elbow connectors ──
  for (const rvp of rvps) {
    drawBox(doc, rvp.cx - RVP_W / 2, rvpY, RVP_W, BOX_H, tierLines(rvp, [255, 255, 255], [200, 214, 232]), NAVY);
    connect(doc, rvp, rvpY + BOX_H, sdoY, RVP_W);
    for (const sdo of rvp.children) {
      drawBox(doc, sdo.cx - SDO_W / 2, sdoY, SDO_W, BOX_H, tierLines(sdo, [255, 255, 255], [210, 224, 238]), SDO_BLUE);
      connect(doc, sdo, sdoY + BOX_H, doY, SDO_W);
      for (const d of sdo.children) {
        const dx = d.cx - DO_W / 2;
        setFill(DO_BG);
        doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
        doc.roundedRect(dx, doY, DO_W, DO_H, 1.5, 1.5, "FD");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(20, 30, 45);
        doc.text(doc.splitTextToSize(d.name, DO_W - 4)[0], d.cx, doY + 5, { align: "center" });
        doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(80, 100, 130);
        doc.text(doc.splitTextToSize(d.title, DO_W - 4)[0], d.cx, doY + 9, { align: "center" });
        doc.setFontSize(6); doc.setTextColor(90, 90, 90);
        const storeLines = doc.splitTextToSize(d.extra || "—", DO_W - 4).slice(0, 4);
        let sy = doY + 13.5;
        for (const ln of storeLines) { doc.text(ln, d.cx, sy, { align: "center" }); sy += 3; }
      }
    }
  }

  doc.save(`SOAR QSR Org Chart - ${new Date().toISOString().slice(0, 10)}.pdf`);
}

function tierLines(n: Node, nameColor: [number, number, number], subColor: [number, number, number]) {
  return [
    { t: n.name, size: 9, bold: true, color: nameColor },
    { t: n.title, size: 6, bold: false, color: subColor },
    { t: `${n.extra} stores`, size: 6.5, bold: true, color: subColor },
  ];
}

// Elbow connector from a parent's bottom-center to each child's top-center.
function connect(doc: jsPDF, parent: Node, parentBottom: number, childTop: number, _w: number) {
  if (!parent.children.length) return;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  const busY = (parentBottom + childTop) / 2;
  doc.line(parent.cx, parentBottom, parent.cx, busY);
  const xs = parent.children.map((c) => c.cx);
  doc.line(Math.min(...xs), busY, Math.max(...xs), busY);
  for (const c of parent.children) doc.line(c.cx, busY, c.cx, childTop);
}

// Box with vertically-centered, horizontally-centered stacked text lines.
function drawBox(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  lines: { t: string; size: number; bold: boolean; color: [number, number, number] }[],
  fill: [number, number, number],
) {
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(148, 163, 184); doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");
  const total = lines.reduce((s, l) => s + l.size * 0.42 + 1, 0);
  let ty = y + (h - total) / 2 + lines[0].size * 0.35;
  for (const l of lines) {
    if (!l.t) { ty += l.size * 0.42 + 1; continue; }
    doc.setFont("helvetica", l.bold ? "bold" : "normal"); doc.setFontSize(l.size); doc.setTextColor(l.color[0], l.color[1], l.color[2]);
    const fit = doc.splitTextToSize(l.t, w - 4)[0];
    doc.text(fit, x + w / 2, ty, { align: "center" });
    ty += l.size * 0.42 + 1;
  }
}
