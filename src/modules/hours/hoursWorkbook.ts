// Hours of Operation — Excel export. One row per store, a column per weekday
// with the hours as text ("7:00 AM - 2:00 AM" / "Closed" / "—"). exceljs, lazy-
// loaded, matching the labor/ranking workbook pattern.
import type { HoursGridStore } from "./api";
import { DAY_LABELS, fmtRange } from "./hoursFmt";

const HEADER = ["Store #", "Location", "Address", "City", "State", "Zip", ...DAY_LABELS, "Upcoming Special"];

export async function downloadHoursWorkbook(stores: HoursGridStore[], scopeLabel = "All Locations"): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Hours of Operation", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });

  ws.addRow(HEADER);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  head.alignment = { vertical: "middle", horizontal: "center" };
  head.height = 20;

  for (const s of stores) {
    const row = ws.addRow([
      s.number, s.name, s.address ?? "", s.city ?? "", s.state ?? "", s.zip ?? "",
      ...s.days.map((d) => fmtRange(d)),
      s.upcoming_special || 0,
    ]);
    row.eachCell((cell, col) => {
      if (col >= 7 && col <= 13) cell.alignment = { horizontal: "center" };
      // Red text for a closed day so dark days stand out.
      if (col >= 7 && col <= 13 && String(cell.value).toLowerCase() === "closed") {
        cell.font = { color: { argb: "FFC0392B" } };
      }
    });
  }

  ws.columns.forEach((col: { width?: number }, i: number) => {
    col.width = i === 0 ? 9 : i === 1 ? 26 : i === 2 ? 30 : i >= 6 && i <= 12 ? 18 : 12;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = scopeLabel.replace(/[\\/:*?"<>|]+/g, "-").trim();
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  a.download = `Hours of Operation - ${safe} - ${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
