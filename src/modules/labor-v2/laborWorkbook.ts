// Native .xlsx export of the leadership labor rollup, styled like the legacy
// "Daily/Weekly/Period to Date Labor" sheet: a green title banner, yellow
// Daily / Week to Date / Period to Date column groups, and a section per tier
// (RVP → SDO → DO → Stores) plus the SOAR total. Each row carries all three
// windows (Labor % · Sales · Var to Chart · $ Over · Hrs Over) and the PTD
// labor goal. exceljs is lazy-loaded (styled cells are beyond the CSV path).

import type { TeamBand, TeamLaborResponse } from "./types";

type Fmt = "text" | "pct" | "money" | "var" | "over" | "num1";
interface Col { group: string; header: string; band?: "day" | "wtd" | "ptd" | "goal"; key?: keyof TeamBand; fmt: Fmt }

// Per-window metric columns (Daily / WTD / PTD share the same five).
const WINDOW_COLS = (band: "day" | "wtd" | "ptd", group: string): Col[] => [
  { group, header: "Labor %", band, key: "labor_pct", fmt: "pct" },
  { group, header: "Sales", band, key: "sales", fmt: "money" },
  { group, header: "Var to Chart", band, key: "variance_pts", fmt: "var" },
  { group, header: "$ Over", band, key: "dollars_over_chart", fmt: "over" },
  { group, header: "Hrs Over", band, key: "hours_over_chart", fmt: "over" },
];

const COLS: Col[] = [
  { group: "Location", header: "Name", fmt: "text" },
  ...WINDOW_COLS("day", "Daily"),
  ...WINDOW_COLS("wtd", "Week to Date"),
  ...WINDOW_COLS("ptd", "Period to Date"),
  { group: "Period to Date", header: "PTD Goal", band: "goal", key: "target_pct", fmt: "pct" },
];

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const GREEN = "FFC6E0B4";   // title banner
const YELLOW = "FFFFF2CC";  // window group headers
const NAVY = "FF1F4E79";    // identity / tier label
const HEAD = "FFEEF1F4";
const OVER = "FFC0392B";     // red text — over chart
const UNDER = "FF1E7E34";    // green text — on/under chart

interface Row { name: string; day: TeamBand; wtd: TeamBand; ptd: TeamBand }

function bandOf(r: Row, band: Col["band"]): TeamBand | null {
  if (band === "day") return r.day;
  if (band === "wtd") return r.wtd;
  if (band === "ptd" || band === "goal") return r.ptd;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeCell(cell: any, r: Row, c: Col) {
  if (c.fmt === "text") { cell.value = r.name; cell.font = { bold: true, color: { argb: "FF1C2733" } }; return; }
  const band = bandOf(r, c.band);
  const v = band && c.key ? band[c.key] : null;
  if (!isNum(v)) { cell.value = v == null ? "" : String(v); return; }
  cell.alignment = { horizontal: "right" };
  // Percent points → fraction + real "%" format so mobile viewers don't multiply
  // a literal-% custom format again (17.3 was showing as 1730% on phones).
  if (c.fmt === "pct" || c.fmt === "var") { cell.value = v / 100; cell.numFmt = "0.0%"; }
  else if (c.fmt === "money" || c.fmt === "over") { cell.value = v; cell.numFmt = c.header === "Hrs Over" ? "0.0" : '"$"#,##0'; }
  else { cell.value = v; cell.numFmt = "0.0"; }
  // Red over chart, green under. Applies to variance + $/hrs over.
  if (c.fmt === "var" || c.fmt === "over") {
    cell.font = { color: { argb: v > 0.05 ? OVER : v < -0.05 ? UNDER : "FF1C2733" }, bold: c.fmt === "var" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addSection(ws: any, startRow: number, title: string, rows: Row[]): number {
  let row = startRow;
  ws.mergeCells(row, 1, row, 6);
  const t = ws.getCell(row, 1);
  t.value = title;
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  row++;

  // Window group header row (merged per contiguous group).
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

  // Column header row.
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
  return row + 1; // gap after the section
}

export async function downloadLaborWorkbook(data: TeamLaborResponse): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Labor", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });

  // Title banner.
  ws.mergeCells(1, 1, 1, COLS.length);
  const banner = ws.getCell(1, 1);
  banner.value = `Daily / Weekly / Period to Date Labor — ${data.date ?? "—"}`;
  banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  banner.font = { bold: true, size: 14, color: { argb: "FF1C2733" } };
  banner.alignment = { horizontal: "center" };
  ws.getRow(1).height = 22;

  const grp = (name: string, leader: string | null): string => leader || name;
  let row = 3;
  const sections: [string, Row[]][] = [
    ["RVPs", (data.levels.region ?? []).map((g) => ({ name: grp(g.name, g.leader), day: g.day, wtd: g.wtd, ptd: g.ptd }))],
    ["SDOs", (data.levels.area ?? []).map((g) => ({ name: grp(g.name, g.leader), day: g.day, wtd: g.wtd, ptd: g.ptd }))],
    ["DOs", (data.levels.district ?? []).map((g) => ({ name: grp(g.name, g.leader), day: g.day, wtd: g.wtd, ptd: g.ptd }))],
    ["Stores", (data.levels.store ?? []).map((s) => ({ name: `#${s.store_number} ${s.store_name}`, day: s.day, wtd: s.wtd, ptd: s.ptd }))],
  ];
  for (const [title, rows] of sections) {
    if (rows.length) row = addSection(ws, row, title, rows);
  }
  if (data.totals) {
    row = addSection(ws, row, "SOAR", [{ name: "SOAR QSR", day: data.totals.day, wtd: data.totals.wtd, ptd: data.totals.ptd }]);
  }

  // Column widths.
  ws.columns.forEach((col: { width?: number }, i: number) => { col.width = i === 0 ? 30 : 11; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soar-labor-${data.date ?? "current"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
