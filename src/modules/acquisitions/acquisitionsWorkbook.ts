// Acquisition upload template + current-data export. Same column set both ways,
// so a downloaded acquisition can be edited and re-uploaded (upload replaces the
// staged set). GM is intentionally omitted — GM assignments come later.
import type { AcqStore } from "./api";

// Header row → staged fields. Order = column order in the sheet.
const COLUMNS: { header: string; key: keyof AcqStore }[] = [
  { header: "Store #", key: "store_number" },
  { header: "Name", key: "name" },
  { header: "Address", key: "address" },
  { header: "City", key: "city" },
  { header: "State", key: "state" },
  { header: "Zip", key: "zip" },
  { header: "Store Email", key: "store_email" },
  { header: "Phone", key: "phone" },
  { header: "Region", key: "region_name" },
  { header: "Area", key: "area_name" },
  { header: "District", key: "district_name" },
  { header: "Notes", key: "notes" },
];

async function build(rows: AcqStore[] | null, filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Stores", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(COLUMNS.map((c) => c.header));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  if (rows) for (const r of rows) ws.addRow(COLUMNS.map((c) => (r[c.key] as string) ?? ""));
  else ws.addRow(["1234", "Example Store", "123 Main St", "Anytown", "TX", "75001", "sonic1234@example.com", "5551234567", "Region name", "Area name", "District name", ""]);
  ws.columns.forEach((c: { width?: number }, i: number) => { c.width = i === 0 ? 10 : i === 2 ? 28 : 18; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function downloadAcquisitionTemplate() {
  return build(null, "Acquisition Upload Template.xlsx");
}
export function downloadAcquisitionData(name: string, rows: AcqStore[]) {
  const safe = (name || "acquisition").replace(/[^\w -]+/g, "").slice(0, 60) || "acquisition";
  return build(rows, `${safe} - stores - ${new Date().toLocaleDateString("en-CA")}.xlsx`);
}
