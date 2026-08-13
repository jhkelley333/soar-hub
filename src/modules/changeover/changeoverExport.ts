// Download a completed (or in-progress) changeover as an .xlsx mirroring the
// original SOAR QSR sheet: checkbox, item, date, who, note — plus a signature line.
import type { ChecklistTemplate } from "./templates";
import type { ChangeoverDetail } from "./api";

export async function downloadChangeoverXlsx(tpl: ChecklistTemplate, c: ChangeoverDetail) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet(tpl.title.slice(0, 31));

  const bold = { bold: true };
  ws.getCell("A1").value = "SOAR QSR"; ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = tpl.title; ws.getCell("A2").font = { bold: true, size: 12 };
  ws.getCell("A4").value = "Store:"; ws.getCell("B4").value = `${c.store_number ?? ""} ${c.store_name ?? ""}`.trim();
  ws.getCell("A5").value = `${tpl.subjectLabel}:`; ws.getCell("B5").value = c.outgoing_name ?? "";
  ws.getCell("A6").value = `${tpl.incomingLabel}:`; ws.getCell("B6").value = c.incoming_name ?? "";
  ws.getCell("A7").value = "Status:"; ws.getCell("B7").value = c.status.replace("_", " ");
  for (const r of [4, 5, 6, 7]) ws.getCell(`A${r}`).font = bold;

  ws.getRow(9).values = ["", "Item", "Done", "By", "Note"];
  ws.getRow(9).font = bold;
  let row = 10;
  for (const s of tpl.sections) {
    ws.getCell(`A${row}`).value = s.title.toUpperCase(); ws.getCell(`A${row}`).font = bold; row++;
    for (const it of s.items) {
      const p = c.progress[it.key];
      ws.getCell(`A${row}`).value = p?.checked ? "☑" : "☐"; // ☑ / ☐
      ws.getCell(`B${row}`).value = it.label;
      ws.getCell(`C${row}`).value = p?.checked && p.checked_at ? new Date(p.checked_at).toLocaleDateString("en-US") : "";
      ws.getCell(`D${row}`).value = p?.checked_by_name ?? "";
      ws.getCell(`E${row}`).value = p?.note ?? "";
      row++;
    }
    row++;
  }
  if (c.notes) { ws.getCell(`A${row}`).value = "NOTES:"; ws.getCell(`A${row}`).font = bold; ws.getCell(`B${row}`).value = c.notes; row += 2; }
  row += 1;
  ws.getCell(`A${row}`).value = "Completed by:"; ws.getCell(`A${row}`).font = bold;
  ws.getCell(`D${row}`).value = "Date:"; ws.getCell(`D${row}`).font = bold;

  ws.getColumn(1).width = 8; ws.getColumn(2).width = 62; ws.getColumn(3).width = 14; ws.getColumn(4).width = 22; ws.getColumn(5).width = 40;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tpl.title} - ${c.store_number ?? "store"} - ${new Date().toLocaleDateString("en-CA")}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
