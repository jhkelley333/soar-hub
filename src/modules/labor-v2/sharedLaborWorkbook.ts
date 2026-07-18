// "Labor File" — native .xlsx export of a shared labor sheet. Sections per tier
// (RVP → SDO → DO → Stores) plus the scope total, each row carrying all three
// windows (Labor % · Target · Var · $ Over · Hrs Over · AvS) and PTD credits.
// exceljs is lazy-loaded. Matches what the on-screen drill-down shows.

import type { ShareBand, ShareNode, SharedLaborResponse } from "./api";

type Fmt = "text" | "pct" | "var" | "over" | "hrs" | "avs" | "money";
interface Col { group: string; header: string; band?: "daily" | "wtd" | "ptd"; key?: keyof ShareBand; fmt: Fmt; credit?: "no_gm" | "pto" | "training" }

const WINDOW = (band: "daily" | "wtd" | "ptd", group: string): Col[] => [
  { group, header: "Labor %", band, key: "labor_pct", fmt: "pct" },
  { group, header: "Target %", band, key: "target_pct", fmt: "pct" },
  { group, header: "Var", band, key: "variance_pts", fmt: "var" },
  { group, header: "$ Over", band, key: "dollars_over", fmt: "over" },
  { group, header: "Hrs Over", band, key: "hours_over", fmt: "hrs" },
  { group, header: "AvS", band, key: "act_vs_sched", fmt: "avs" },
];

const COLS: Col[] = [
  { group: "Location", header: "Name", fmt: "text" },
  ...WINDOW("daily", "Daily"),
  ...WINDOW("wtd", "Week to Date"),
  ...WINDOW("ptd", "Period to Date"),
  { group: "Credits (PTD)", header: "No GM", fmt: "money", credit: "no_gm" },
  { group: "Credits (PTD)", header: "PTO", fmt: "money", credit: "pto" },
  { group: "Credits (PTD)", header: "Training", fmt: "money", credit: "training" },
];

const NAVY = "FF1F4E79";
const YELLOW = "FFFFF2CC";
const HEAD = "FFEEF1F4";
const OVER = "FFC0392B"; // red
const UNDER = "FF1E7E34"; // green
const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);

interface Row { name: string; daily: ShareBand; wtd: ShareBand; ptd: ShareBand; credits: ShareNode["credits"] }

const rowOf = (n: ShareNode, name: string): Row => ({ name, daily: n.daily, wtd: n.wtd, ptd: n.ptd, credits: n.credits });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeCell(cell: any, r: Row, c: Col) {
  if (c.fmt === "text") { cell.value = r.name; cell.font = { bold: true, color: { argb: "FF1C2733" } }; return; }
  let v: number | null = null;
  if (c.credit) v = r.credits[c.credit] ?? null;
  else if (c.band && c.key) v = r[c.band][c.key];
  if (!isNum(v)) { cell.value = ""; return; }
  cell.alignment = { horizontal: "right" };
  // Percentages: store the FRACTION with a real "%" format (value/100 + "0.0%").
  // A literal-% custom format renders fine on desktop but mobile viewers (the
  // phone) multiply it anyway, so 17.3 showed as 1730%. This is viewer-proof.
  if (c.fmt === "pct" || c.fmt === "var") { cell.value = v / 100; cell.numFmt = "0.0%"; }
  else {
    cell.value = v;
    cell.numFmt = c.fmt === "over" ? '"$"#,##0' : c.fmt === "hrs" ? "0.0" : c.fmt === "avs" ? "0" : '"$"#,##0';
  }
  // Over chart = red, under = green (variance / $ over / hrs over / AvS). Uses
  // the original percent-point / dollar value for the threshold.
  if (c.fmt === "var" || c.fmt === "over" || c.fmt === "hrs" || c.fmt === "avs") {
    cell.font = { color: { argb: v > 0.05 ? OVER : v < -0.05 ? UNDER : "FF1C2733" }, bold: c.fmt === "var" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addSection(ws: any, startRow: number, title: string, rows: Row[]): number {
  let row = startRow;
  ws.mergeCells(row, 1, row, 4);
  const t = ws.getCell(row, 1);
  t.value = title;
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  row++;

  // Group header row (merged per contiguous group).
  let gi = 0;
  while (gi < COLS.length) {
    let gj = gi;
    while (gj + 1 < COLS.length && COLS[gj + 1].group === COLS[gi].group) gj++;
    ws.mergeCells(row, gi + 1, row, gj + 1);
    const gc = ws.getCell(row, gi + 1);
    const g = COLS[gi].group;
    gc.value = g;
    gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: g === "Location" ? NAVY : YELLOW } };
    gc.font = { bold: true, color: { argb: g === "Location" ? "FFFFFFFF" : "FF1C2733" } };
    gc.alignment = { horizontal: "center" };
    gi = gj + 1;
  }
  row++;

  COLS.forEach((c, i) => {
    const hc = ws.getCell(row, i + 1);
    hc.value = c.header;
    hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    hc.font = { bold: true, size: 9, color: { argb: "FF6B7A89" } };
    hc.alignment = { horizontal: c.fmt === "text" ? "left" : "right", wrapText: true };
  });
  row++;

  for (const r of rows) {
    COLS.forEach((c, i) => writeCell(ws.getCell(row, i + 1), r, c));
    row++;
  }
  return row + 1;
}

export async function downloadSharedLaborFile(data: SharedLaborResponse, scopeLabel?: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Labor", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });

  const scope = scopeLabel || (data.scope.kind === "region" ? (data.scope.region ?? "Region") : "Company");
  ws.mergeCells(1, 1, 1, COLS.length);
  const banner = ws.getCell(1, 1);
  banner.value = `SOAR Labor File — ${scope} — ${data.date ?? "—"}`;
  banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6E0B4" } };
  banner.font = { bold: true, size: 14, color: { argb: "FF1C2733" } };
  banner.alignment = { horizontal: "center" };
  ws.getRow(1).height = 22;

  const grp = (n: ShareNode) => (n.leader ? `${n.leader} — ${n.name}` : n.name);
  let row = 3;
  if (data.company) row = addSection(ws, row, scope === "Company" ? "SOAR — Company" : scope, [rowOf(data.company, grp(data.company))]);

  const sections: [string, Row[]][] = [
    ["RVP · Region", (data.levels.region ?? []).map((n) => rowOf(n, grp(n)))],
    ["SDO · Market", (data.levels.area ?? []).map((n) => rowOf(n, grp(n)))],
    ["DO · District", (data.levels.district ?? []).map((n) => rowOf(n, grp(n)))],
    ["Stores", (data.levels.store ?? []).map((n) => rowOf(n, `#${n.store_number} ${n.store_name ?? ""}`.trim()))],
  ];
  for (const [title, rows] of sections) {
    if (rows.length) row = addSection(ws, row, title, rows);
  }

  ws.columns.forEach((col: { width?: number }, i: number) => { col.width = i === 0 ? 34 : 10; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeScope = scope.replace(/[\\/:*?"<>|]+/g, "-").trim();
  a.download = `Labor File - ${safeScope} - ${data.date ?? "current"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
