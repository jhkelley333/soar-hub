// Hours of Operation — upload parsing. Accepts the template's per-day open/close
// columns (CSV/paste or .xlsx) and turns each row into { store_number, days }.
// A day is written only when it carries data: "Closed" in the *_open cell marks
// a dark day; a blank pair leaves that weekday untouched on import.
import { parseCSVWithHeader, toCSV } from "@/lib/csv";
import { DAY_LABELS } from "./hoursFmt";
import type { DayHours } from "./api";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const TEMPLATE_HEADERS = ["store_number", ...DAY_KEYS.flatMap((d) => [`${d}_open`, `${d}_close`])];

export interface ParsedHoursRow {
  store_number: string;
  days: DayHours[];
  summary: string;   // human preview, e.g. "Mon–Fri 7:00 AM–2:00 AM · Sat closed"
}
export interface ParseResult {
  rows: ParsedHoursRow[];
  rowErrors: { line: number; reason: string }[];
}

// "7:00 AM" / "07:00" / "7am" / "2:00 AM" -> "HH:MM"; "closed" -> "closed"; ""/bad -> null.
export function parseTimeCell(raw: string | null | undefined): "closed" | string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^closed$/i.test(v)) return "closed";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase().replace(/\./g, "") : "";
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const to12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
};

// Build ParsedHoursRow list from header-keyed records (CSV or xlsx-derived).
export function rowsFromRecords(records: Record<string, string>[]): ParseResult {
  const rows: ParsedHoursRow[] = [];
  const rowErrors: { line: number; reason: string }[] = [];
  records.forEach((rec, i) => {
    const line = i + 2; // header is line 1
    const num = String(rec.store_number ?? rec["store number"] ?? rec.store ?? "").trim();
    if (!num) { if (Object.values(rec).some((v) => String(v).trim())) rowErrors.push({ line, reason: "missing store_number" }); return; }
    const days: DayHours[] = [];
    const parts: string[] = [];
    DAY_KEYS.forEach((key, dow) => {
      const openCell = parseTimeCell(rec[`${key}_open`]);
      const closeCell = parseTimeCell(rec[`${key}_close`]);
      if (openCell === "closed") { days.push({ day_of_week: dow, is_closed: true, open: null, close: null }); parts.push(`${DAY_LABELS[dow].slice(0, 3)} closed`); return; }
      if (openCell && closeCell && closeCell !== "closed") {
        days.push({ day_of_week: dow, is_closed: false, open: openCell, close: closeCell });
        parts.push(`${DAY_LABELS[dow].slice(0, 3)} ${to12(openCell)}–${to12(closeCell)}`);
      }
      // else: leave that weekday untouched
    });
    if (!days.length) { rowErrors.push({ line, reason: `#${num}: no valid day columns` }); return; }
    rows.push({ store_number: num, days, summary: parts.join(" · ") });
  });
  return { rows, rowErrors };
}

export function parseHoursText(text: string): ParseResult {
  return rowsFromRecords(parseCSVWithHeader(text));
}

// Read the first worksheet of an .xlsx into header-keyed records, then parse.
export async function parseHoursXlsx(file: File): Promise<ParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], rowErrors: [{ line: 0, reason: "no sheet found" }] };
  const cell = (v: unknown) => (v == null ? "" : typeof v === "object" && v && "text" in (v as object) ? String((v as { text: unknown }).text) : String(v));
  const header: string[] = [];
  ws.getRow(1).eachCell((c, col) => { header[col - 1] = cell(c.value).trim().toLowerCase(); });
  const records: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    header.forEach((h, i) => { if (!h) return; const val = cell(row.getCell(i + 1).value).trim(); rec[h] = val; if (val) any = true; });
    if (any) records.push(rec);
  }
  return rowsFromRecords(records);
}

// A downloadable CSV template with one illustrative row.
export function hoursTemplateCsv(): string {
  const sample: Record<string, string> = { store_number: "1056" };
  DAY_KEYS.forEach((d, i) => {
    sample[`${d}_open`] = i >= 5 ? "8:00 AM" : "7:00 AM";
    sample[`${d}_close`] = "2:00 AM";
  });
  return toCSV(TEMPLATE_HEADERS, [sample]);
}
