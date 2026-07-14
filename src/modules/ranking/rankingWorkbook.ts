// Native .xlsx workbook export for the ranking — the formatted spreadsheet
// leaders know from the sheet: title banner, gold column-group headers,
// colored 1-5 score cells, and the Stores / DOs / SDOs / RVPs / Company
// sections stacked per scope (PTD + WTD as two tabs). Uses exceljs
// (lazy-loaded) because styled cells are beyond the CSV/SheetJS path.

import type { FullRunScope, RankingResultRow, RankingRun } from "./api";

type Fmt = "text" | "int" | "money" | "pct" | "num1" | "score" | "tot";
interface Col { group: string; header: string; key: string; fmt: Fmt }

// Store columns — the full mockup layout, grouped.
const STORE_COLS: Col[] = [
  { group: "Store Info", header: "Rank", key: "rank", fmt: "int" },
  { group: "Store Info", header: "Store #", key: "__store", fmt: "text" },
  { group: "Store Info", header: "Location", key: "location", fmt: "text" },
  { group: "Store Info", header: "GM", key: "gm", fmt: "text" },
  { group: "Sales", header: "Total Points", key: "totalPoints", fmt: "tot" },
  { group: "Sales", header: "Sales", key: "sales", fmt: "money" },
  { group: "Sales", header: "LY Sales", key: "lySales", fmt: "money" },
  { group: "Sales", header: "% vs LY", key: "pctVsLy", fmt: "pct" },
  { group: "Sales", header: "Tickets", key: "tickets", fmt: "int" },
  { group: "Sales", header: "LY Tickets", key: "lyTickets", fmt: "int" },
  { group: "Sales", header: "Tickets vs LY %", key: "ticketsVsLyPct", fmt: "pct" },
  { group: "Sales", header: "Sales Score", key: "salesScore", fmt: "score" },
  { group: "Food Cost", header: "COGS Eff %", key: "cogsEff", fmt: "pct" },
  { group: "Food Cost", header: "FC $ Miss", key: "fcMiss", fmt: "money" },
  { group: "Food Cost", header: "FC Annualized", key: "fcAnnualized", fmt: "money" },
  { group: "Food Cost", header: "FC Score", key: "fcScore", fmt: "score" },
  { group: "Labor", header: "Labor %", key: "laborPct", fmt: "pct" },
  { group: "Labor", header: "PTO %", key: "ptoPct", fmt: "pct" },
  { group: "Labor", header: "Chart", key: "chart", fmt: "pct" },
  { group: "Labor", header: "Var to Chart", key: "varianceToChart", fmt: "pct" },
  { group: "Labor", header: "Labor $ Miss", key: "laborMiss", fmt: "money" },
  { group: "Labor", header: "Hours Over", key: "hoursOver", fmt: "int" },
  { group: "Labor", header: "Avg Hrs Over/Store", key: "avgHoursOverPerStore", fmt: "num1" },
  { group: "Labor", header: "Labor Annualized", key: "laborAnnualized", fmt: "money" },
  { group: "Labor", header: "Labor Score", key: "laborScore", fmt: "score" },
  { group: "Financial", header: "Fin $ Miss", key: "finMiss", fmt: "money" },
  { group: "Financial", header: "Fin Annualized", key: "finAnnualized", fmt: "money" },
  { group: "Financial", header: "Fin Score", key: "finScore", fmt: "tot" },
  { group: "Operations", header: "BSC Training %", key: "bscTrainingPct", fmt: "pct" },
  { group: "Operations", header: "BSC Score", key: "bscScore", fmt: "score" },
  { group: "Operations", header: "On Time %", key: "onTimePct", fmt: "pct" },
  { group: "Operations", header: "On Time Score", key: "onTimeScore", fmt: "score" },
  { group: "Operations", header: "Calls /10k Tkts", key: "callsPer10k", fmt: "num1" },
  { group: "Operations", header: "Complaints Score", key: "complaintsScore", fmt: "score" },
  { group: "Operations", header: "EcoSure", key: "ecosure", fmt: "pct" },
  { group: "Operations", header: "EcoSure Score", key: "ecosureScore", fmt: "score" },
  { group: "Operations", header: "VOG", key: "vog", fmt: "pct" },
  { group: "Operations", header: "VOG Score", key: "vogScore", fmt: "score" },
  { group: "Operations", header: "Training %", key: "totalTrainingPct", fmt: "pct" },
  { group: "Operations", header: "Training Score", key: "totalTrainingScore", fmt: "score" },
  { group: "Operations", header: "Shops", key: "msCount", fmt: "int" },
  { group: "Operations", header: "Shop Avg", key: "msScore", fmt: "pct" },
  { group: "Operations", header: "Ops Score", key: "opsScore", fmt: "tot" },
  { group: "Info Only", header: "Voids $", key: "voids", fmt: "money" },
  { group: "Info Only", header: "Voids %", key: "voidsPct", fmt: "pct" },
  { group: "Info Only", header: "DOH", key: "doh", fmt: "num1" },
  { group: "Info Only", header: "Ending $", key: "endingDollars", fmt: "money" },
  { group: "Info Only", header: "$ Over Goal", key: "dollarsOverGoal", fmt: "money" },
];

// Leader columns (DO / SDO / RVP / Company) — mirror the store grid so every
// dollar/percent column totals at the leader tiers. Name + Stores replace
// Store #/Location/GM; everything else lines up with STORE_COLS.
const LEADER_COLS: Col[] = [
  { group: "Info", header: "Rank", key: "rank", fmt: "int" },
  { group: "Info", header: "Name", key: "name", fmt: "text" },
  { group: "Info", header: "Stores", key: "storeCount", fmt: "int" },
  { group: "Sales", header: "Total Points", key: "totalPoints", fmt: "tot" },
  { group: "Sales", header: "Sales", key: "sales", fmt: "money" },
  { group: "Sales", header: "LY Sales", key: "lySales", fmt: "money" },
  { group: "Sales", header: "% vs LY", key: "pctVsLy", fmt: "pct" },
  { group: "Sales", header: "Tickets", key: "tickets", fmt: "int" },
  { group: "Sales", header: "LY Tickets", key: "lyTickets", fmt: "int" },
  { group: "Sales", header: "Tickets vs LY %", key: "ticketsVsLyPct", fmt: "pct" },
  { group: "Sales", header: "Sales Score", key: "salesScore", fmt: "score" },
  { group: "Food Cost", header: "COGS Eff %", key: "cogsEff", fmt: "pct" },
  { group: "Food Cost", header: "FC $ Miss", key: "fcMiss", fmt: "money" },
  { group: "Food Cost", header: "FC Annualized", key: "fcAnnualized", fmt: "money" },
  { group: "Food Cost", header: "FC Score", key: "fcScore", fmt: "score" },
  { group: "Labor", header: "Labor %", key: "laborPct", fmt: "pct" },
  { group: "Labor", header: "PTO %", key: "ptoPct", fmt: "pct" },
  { group: "Labor", header: "Chart", key: "chart", fmt: "pct" },
  { group: "Labor", header: "Var to Chart", key: "varianceToChart", fmt: "pct" },
  { group: "Labor", header: "Labor $ Miss", key: "laborMiss", fmt: "money" },
  { group: "Labor", header: "Hours Over", key: "hoursOver", fmt: "int" },
  { group: "Labor", header: "Avg Hrs Over/Store", key: "avgHoursOverPerStore", fmt: "num1" },
  { group: "Labor", header: "Labor Annualized", key: "laborAnnualized", fmt: "money" },
  { group: "Labor", header: "Labor Score", key: "laborScore", fmt: "score" },
  { group: "Financial", header: "Fin $ Miss", key: "finMiss", fmt: "money" },
  { group: "Financial", header: "Fin Annualized", key: "finAnnualized", fmt: "money" },
  { group: "Financial", header: "Fin Score", key: "finScore", fmt: "tot" },
  { group: "Operations", header: "BSC Training %", key: "bscTrainingPct", fmt: "pct" },
  { group: "Operations", header: "BSC Score", key: "bscScore", fmt: "score" },
  { group: "Operations", header: "On Time %", key: "onTimePct", fmt: "pct" },
  { group: "Operations", header: "On Time Score", key: "onTimeScore", fmt: "score" },
  { group: "Operations", header: "Complaints Score", key: "complaintsScore", fmt: "score" },
  { group: "Operations", header: "VOG", key: "vog", fmt: "pct" },
  { group: "Operations", header: "VOG Score", key: "vogScore", fmt: "score" },
  { group: "Operations", header: "Ops Score", key: "opsScore", fmt: "tot" },
];

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const SCORE_FILL: Record<number, string> = {
  1: "FFC4443C", 2: "FFD98A2B", 3: "FFEAD25A", 4: "FF8FBF6B", 5: "FF2F7A47",
};
const NAVY = "FF132A45";
const GOLD = "FFF2C94C";
const HEAD = "FFEEF1F4";

function cellVal(r: RankingResultRow, c: Col): unknown {
  if (c.key === "rank") return r.rank ?? null;
  if (c.key === "totalPoints") return r.total_points ?? null;
  if (c.key === "__store") return r.entity_key;
  return r.metrics[c.key] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeCell(cell: any, value: unknown, fmt: Fmt) {
  if (fmt === "score") {
    if (isNum(value)) {
      cell.value = value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SCORE_FILL[value] ?? "FF9AA6B1" } };
      cell.font = { color: { argb: value === 3 || value === 4 ? "FF1C2733" : "FFFFFFFF" }, bold: true };
      cell.alignment = { horizontal: "center" };
    }
    return;
  }
  if (fmt === "text") { cell.value = value == null ? "" : String(value); return; }
  if (!isNum(value)) { cell.value = typeof value === "string" ? value : null; return; }
  cell.value = value;
  cell.numFmt =
    fmt === "money" ? '"$"#,##0'
      : fmt === "pct" ? "0.0%"
      : fmt === "num1" ? "0.0"
      : fmt === "tot" ? "0.0"
      : "#,##0";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addSection(ws: any, startRow: number, title: string | null, cols: Col[], rows: RankingResultRow[]): number {
  let row = startRow;
  const nCols = cols.length;
  if (title) {
    ws.mergeCells(row, 1, row, Math.min(nCols, 6));
    const t = ws.getCell(row, 1);
    t.value = title;
    t.font = { bold: true, size: 12, color: { argb: "FF132A45" } };
    row++;
  }
  // Group header row (merged spans per contiguous group).
  let gi = 0;
  while (gi < cols.length) {
    let gj = gi;
    while (gj + 1 < cols.length && cols[gj + 1].group === cols[gi].group) gj++;
    ws.mergeCells(row, gi + 1, row, gj + 1);
    const gc = ws.getCell(row, gi + 1);
    gc.value = cols[gi].group;
    gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cols[gi].group === "Store Info" || cols[gi].group === "Info" ? NAVY : GOLD } };
    gc.font = { bold: true, color: { argb: cols[gi].group === "Store Info" || cols[gi].group === "Info" ? "FFFFFFFF" : "FF1C2733" } };
    gc.alignment = { horizontal: "left" };
    gi = gj + 1;
  }
  row++;
  // Column header row.
  cols.forEach((c, i) => {
    const hc = ws.getCell(row, i + 1);
    hc.value = c.header;
    hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    hc.font = { bold: true, size: 9, color: { argb: "FF6B7A89" } };
    hc.alignment = { horizontal: c.fmt === "text" ? "left" : "right", wrapText: true };
  });
  const headerRow = row;
  row++;
  // Data rows.
  for (const r of rows) {
    cols.forEach((c, i) => writeCell(ws.getCell(row, i + 1), cellVal(r, c), c.fmt));
    row++;
  }
  return headerRow; // caller freezes on the store section's header
}

export async function downloadRankingWorkbook(
  run: RankingRun,
  scopes: { ptd: FullRunScope; wtd: FullRunScope },
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";

  // Stamp the RUN identity (not the export time) so a workbook can be matched
  // to the board's run bar. run.id short-hash is the definitive key.
  const runStamp = run.completed_at ? new Date(run.completed_at).toLocaleString("en-US") : "?";
  const runId = String(run.id ?? "").slice(0, 8);
  // Always emit both tabs so the workbook is consistent (a scope with no
  // rows gets a "not run" note rather than a missing tab).
  for (const scope of ["ptd", "wtd"] as const) {
    const data = scopes[scope] ?? {};
    const tabName = scope === "wtd" ? "Week to Date" : "Period to Date";
    const ws = wb.addWorksheet(tabName, { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });

    // Title banner.
    ws.mergeCells(1, 1, 1, 12);
    const banner = ws.getCell(1, 1);
    banner.value = `SOAR RANKING — ${scope === "wtd" ? "WEEK TO DATE" : "PERIOD TO DATE"} — Period ${run.period} Week ${run.week} · week ending ${run.week_ending} · run ${runId} · completed ${runStamp}`;
    banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    banner.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    ws.getRow(1).height = 20;

    if (!data.store?.length) {
      ws.getCell(3, 1).value = `No ${scope.toUpperCase()} data in this run.`;
      ws.getCell(3, 1).font = { italic: true, color: { argb: "FF6B7A89" } };
      ws.columns.forEach((col: { width?: number }, i: number) => { col.width = i === 2 ? 26 : 12; });
      continue;
    }

    let row = 3;
    addSection(ws, row, null, STORE_COLS, data.store);
    row += 2 + data.store.length + 1; // group hdr + col hdr + rows + gap

    const leaderTiers: [string, string][] = [
      ["do", "Directors of Operations"],
      ["sdo", "SDOs"],
      ["rvp", "RVPs"],
      ["entity", "Entities"],
      ["company", "Company"],
    ];
    for (const [tier, label] of leaderTiers) {
      const rows = data[tier as keyof FullRunScope];
      if (!rows || !rows.length) continue;
      row += 1;
      addSection(ws, row, label, LEADER_COLS, rows);
      row += 1 + 2 + rows.length; // title + group hdr + col hdr + rows
    }

    // Column widths.
    ws.columns.forEach((col: { width?: number }, i: number) => {
      col.width = i === 2 ? 26 : i === 1 || i === 0 ? 8 : 12;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soar-ranking-P${run.period}W${run.week}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
