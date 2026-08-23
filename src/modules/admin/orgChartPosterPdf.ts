// SOAR QSR Org Chart — poster PDF. Reproduces the uploaded visual org chart:
// an executive header block on top, then RVP -> SDO tiers, and beneath each SDO
// its DOs stacked VERTICALLY in one or more columns (each DO box = leader /
// district territory / store list). Acting ("DO TEMP") coverage is highlighted
// yellow. jsPDF, client-side, downloadable from Org Admin.
import { jsPDF } from "jspdf";
import type { OrgArea, OrgDistrict, OrgManager, OrgRegion, OrgTreeResponse } from "./api";

// Executive leadership above the regions (the org tree only covers RVP and
// below). Fixed, editable header — positions are on a coarse grid (col units
// from page center); links draw the reporting lines. Keep in sync with the
// source chart.
const EXEC = [
  { id: "nik", name: "Nik Bhakta", title: "Principal", col: -3, row: 0 },
  { id: "ron", name: "Ron Parikh", title: "Principal", col: 3, row: 0 },
  { id: "khaled", name: "Khaled Habash", title: "COO", col: -3, row: 1 },
  { id: "jay", name: "Jay Patel", title: "COS", col: 2, row: 1 },
  { id: "syed", name: "Syed Zaidi", title: "Vice President of Accounting", col: 4.2, row: 1 },
  { id: "adam", name: "Adam Scott", title: "Vice President of People Development", col: -5, row: 2 },
  { id: "heath", name: "Heath Kelley", title: "Vice President of Operations", col: -3, row: 2 },
  { id: "pinakin", name: "Pinakin Bhakta", title: "Compliance Manager", col: 1.4, row: 2 },
  { id: "cory", name: "Cory Posey", title: "Director of Financial Analysis", col: 3.2, row: 2 },
  { id: "qsc", name: "QSCulinary", title: "Full Back Office Solutions", col: 5, row: 2 },
];
const EXEC_LINKS: [string, string][] = [
  ["nik", "ron"], ["nik", "khaled"], ["khaled", "heath"], ["khaled", "adam"],
  ["ron", "jay"], ["jay", "syed"], ["jay", "pinakin"], ["jay", "cory"], ["syed", "qsc"],
];
const EXEC_ORIGIN = "heath"; // exec box the RVP tier hangs from

// Districts to flag orange (e.g. a transitioning / newly-acquired group). Not
// derivable from the org tree, so it's an opt-in list of district names; empty
// by default. Add names here to tint those DO boxes orange.
const ORANGE_DISTRICTS = new Set<string>([]);

const NAVY: RGB = [30, 58, 95];
const SDO_BLUE: RGB = [46, 94, 140];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [20, 30, 45];
const LINE: RGB = [120, 130, 145];
const YELLOW: RGB = [255, 235, 59];
const ORANGE: RGB = [245, 166, 35];
const CHERRY: RGB = [206, 20, 44];
type RGB = [number, number, number];

const EXEC_W = 46, EXEC_H = 15, EXEC_COL = 26, EXEC_ROW_H = 26;
const RVP_W = 62, SDO_W = 56, TIER_H = 16;
const DO_W = 44, DO_H = 24, DO_VGAP = 4, SUBCOL_GAP = 6, SDO_GAP = 14, MAX_PER_COL = 9;
const M = 16;

interface DoNode { name: string; territory: string; stores: string; acting: boolean; orange: boolean; col: number; row: number; x: number; y: number; }
interface SdoNode { name: string; count: number; cx: number; dos: DoNode[]; cols: number; }
interface RvpNode { name: string; count: number; cx: number; sdos: SdoNode[]; }

function leaderInfo(managers: OrgManager[], role: string): { name: string; acting: boolean } {
  const scoped = managers.filter((m) => String(m.role).toLowerCase() === role);
  const pool = scoped.length ? scoped : managers;
  const primary = pool.filter((m) => !m.acting);
  const chosen = (primary.length ? primary : pool).map((m) => m.full_name || m.email).filter(Boolean);
  return { name: chosen.join(" / "), acting: primary.length === 0 && pool.some((m) => m.acting) };
}
const activeStores = (d: OrgDistrict) => d.stores.filter((s) => s.is_active !== false);
const areaCount = (a: OrgArea) => a.districts.reduce((n, d) => n + activeStores(d).length, 0);
const regionCount = (r: OrgRegion) => r.areas.reduce((n, a) => n + areaCount(a), 0);

export function exportOrgChartPosterPdf(tree: OrgTreeResponse | null): void {
  if (!tree || !tree.regions.length) return;

  // ── Layout pass: place SDO slots left→right; DOs stack down in sub-columns ──
  let cursor = M + 26; // room for the left logo
  let maxRows = 1;
  const rvps: RvpNode[] = [];
  for (const r of tree.regions.filter((x) => x.is_active !== false)) {
    const rvp: RvpNode = { name: leaderInfo(r.managers, "rvp").name || r.name, count: regionCount(r), cx: 0, sdos: [] };
    const areas = r.areas.filter((a) => a.is_active !== false);
    for (const a of areas) {
      const dists = a.districts.filter((d) => d.is_active !== false);
      const dos: DoNode[] = dists.map((d) => {
        const li = leaderInfo(d.managers, "do");
        return {
          name: (li.name || "—") + (li.acting ? "-(DO TEMP)" : ""),
          territory: d.name,
          stores: activeStores(d).map((s) => s.number).join(", "),
          acting: li.acting,
          orange: ORANGE_DISTRICTS.has(d.name),
          col: 0, row: 0, x: 0, y: 0,
        };
      });
      const cols = Math.max(1, Math.ceil(dos.length / MAX_PER_COL));
      const slotStart = cursor;
      dos.forEach((d, i) => {
        d.col = Math.floor(i / MAX_PER_COL);
        d.row = i % MAX_PER_COL;
        d.x = slotStart + d.col * (DO_W + SUBCOL_GAP);
      });
      maxRows = Math.max(maxRows, Math.min(dos.length, MAX_PER_COL));
      const slotW = cols * DO_W + (cols - 1) * SUBCOL_GAP;
      const sdo: SdoNode = { name: leaderInfo(a.managers, "sdo").name || a.name, count: areaCount(a), cx: slotStart + slotW / 2, dos, cols };
      rvp.sdos.push(sdo);
      cursor = slotStart + slotW + SDO_GAP;
    }
    if (!rvp.sdos.length) { rvp.cx = cursor + DO_W / 2; cursor += DO_W + SDO_GAP; }
    else rvp.cx = (rvp.sdos[0].cx + rvp.sdos[rvp.sdos.length - 1].cx) / 2;
    rvps.push(rvp);
  }

  const treeW = cursor - SDO_GAP + M + 26; // right logo room
  const execTop = M + 16;
  const execBottom = execTop + 3 * EXEC_ROW_H;
  const rvpY = execBottom + 16;
  const sdoY = rvpY + TIER_H + 20;
  const doStartY = sdoY + TIER_H + 16;
  const pageW = Math.max(300, treeW);
  const pageH = doStartY + maxRows * (DO_H + DO_VGAP) + M;
  const cx = pageW / 2;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pageW, pageH] });

  // Title + corner logos.
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...NAVY);
  doc.text("SOAR QSR Org Chart", cx, M + 2, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), cx, M + 7, { align: "center" });
  logo(doc, M + 12, M + 6);
  logo(doc, pageW - M - 12, M + 6);

  // ── Executive block ──
  const execXY = new Map<string, { x: number; y: number }>();
  for (const e of EXEC) execXY.set(e.id, { x: cx + e.col * EXEC_COL, y: execTop + e.row * EXEC_ROW_H });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  for (const [a, b] of EXEC_LINKS) {
    const pa = execXY.get(a)!, pb = execXY.get(b)!;
    if (pa.y === pb.y) { // sibling link — straight across
      doc.line(pa.x + EXEC_W / 2, pa.y + EXEC_H / 2, pb.x - EXEC_W / 2, pb.y + EXEC_H / 2);
    } else { // parent → child elbow
      const midY = (pa.y + EXEC_H + pb.y) / 2;
      doc.line(pa.x, pa.y + EXEC_H, pa.x, midY);
      doc.line(pa.x, midY, pb.x, midY);
      doc.line(pb.x, midY, pb.x, pb.y);
    }
  }
  for (const e of EXEC) {
    const p = execXY.get(e.id)!;
    box(doc, p.x - EXEC_W / 2, p.y, EXEC_W, EXEC_H, [
      { t: e.name, size: 8, bold: true, color: INK },
      { t: e.title, size: 6, bold: false, color: [90, 100, 115] },
    ], WHITE, INK);
  }

  // Bus from the exec origin down to the RVP tier.
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  const origin = execXY.get(EXEC_ORIGIN)!;
  if (rvps.length) {
    const busY = rvpY - 9;
    doc.line(origin.x, origin.y + EXEC_H, origin.x, busY);
    const xs = rvps.map((n) => n.cx);
    doc.line(Math.min(origin.x, ...xs), busY, Math.max(origin.x, ...xs), busY);
    for (const n of rvps) doc.line(n.cx, busY, n.cx, rvpY);
  }

  // ── RVP → SDO tiers ──
  for (const rvp of rvps) {
    box(doc, rvp.cx - RVP_W / 2, rvpY, RVP_W, TIER_H, tierLines(rvp.name, "Regional Vice President of Operations", rvp.count, WHITE, [205, 218, 233]), NAVY, WHITE);
    // RVP → its SDOs
    if (rvp.sdos.length) {
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
      const busY = sdoY - 9;
      doc.line(rvp.cx, rvpY + TIER_H, rvp.cx, busY);
      const xs = rvp.sdos.map((s) => s.cx);
      doc.line(Math.min(...xs), busY, Math.max(...xs), busY);
      for (const s of rvp.sdos) doc.line(s.cx, busY, s.cx, sdoY);
    }
    for (const sdo of rvp.sdos) {
      box(doc, sdo.cx - SDO_W / 2, sdoY, SDO_W, TIER_H, tierLines(sdo.name, "Senior Director of Operations", sdo.count, WHITE, [214, 226, 238]), SDO_BLUE, WHITE);
      // SDO → its DO columns: a left spine per sub-column with a stub per box.
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
      doc.line(sdo.cx, sdoY + TIER_H, sdo.cx, doStartY - 6);
      for (const d of sdo.dos) {
        d.y = doStartY + d.row * (DO_H + DO_VGAP);
        drawDo(doc, d);
      }
    }
  }

  doc.save(`SOAR QSR Org Chart - ${new Date().toISOString().slice(0, 10)}.pdf`);
}

function drawDo(doc: jsPDF, d: DoNode) {
  const fill: RGB = d.acting ? YELLOW : d.orange ? ORANGE : WHITE;
  const textColor: RGB = INK;
  box(doc, d.x, d.y, DO_W, DO_H, [], fill, textColor);
  // Custom stacked content (name / territory / up to 3 store lines).
  const cx = d.x + DO_W / 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...textColor);
  doc.text(doc.splitTextToSize(d.name, DO_W - 4).slice(0, 2), cx, d.y + 4.5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(80, 95, 120);
  doc.text(doc.splitTextToSize(d.territory || "", DO_W - 4)[0] || "", cx, d.y + 11, { align: "center" });
  doc.setFontSize(6); doc.setTextColor(70, 70, 70);
  const lines = doc.splitTextToSize(d.stores || "—", DO_W - 4).slice(0, 3);
  let sy = d.y + 15;
  for (const ln of lines) { doc.text(ln, cx, sy, { align: "center" }); sy += 3; }
}

function tierLines(name: string, title: string, count: number, nameColor: RGB, subColor: RGB) {
  return [
    { t: name, size: 8.5, bold: true, color: nameColor },
    { t: title, size: 5.8, bold: false, color: subColor },
    { t: String(count), size: 7, bold: true, color: subColor },
  ];
}

function logo(doc: jsPDF, x: number, y: number) {
  doc.setFillColor(...CHERRY);
  doc.circle(x, y, 11, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
  doc.setFontSize(8); doc.text("SOAR", x, y - 0.5, { align: "center" });
  doc.setFontSize(6.5); doc.text("QSR", x, y + 4, { align: "center" });
}

// Rounded box with optional vertically-centered stacked text lines.
function box(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  lines: { t: string; size: number; bold: boolean; color: RGB }[],
  fill: RGB, _textDefault: RGB,
) {
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(120, 130, 145); doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 1.2, 1.2, "FD");
  if (!lines.length) return;
  const total = lines.reduce((s, l) => s + l.size * 0.42 + 1, 0);
  let ty = y + (h - total) / 2 + lines[0].size * 0.35;
  for (const l of lines) {
    if (!l.t) { ty += l.size * 0.42 + 1; continue; }
    doc.setFont("helvetica", l.bold ? "bold" : "normal"); doc.setFontSize(l.size); doc.setTextColor(l.color[0], l.color[1], l.color[2]);
    doc.text(doc.splitTextToSize(l.t, w - 3)[0], x + w / 2, ty, { align: "center" });
    ty += l.size * 0.42 + 1;
  }
}
