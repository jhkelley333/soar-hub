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

const DAY_NAME: Record<string, number> = { monday: 0, mon: 0, tuesday: 1, tue: 1, wednesday: 2, wed: 2, thursday: 3, thu: 3, friday: 4, fri: 4, saturday: 5, sat: 5, sunday: 6, sun: 6 };

// An exceljs cell value -> string. Time cells arrive as UTC Date objects (or
// Excel day fractions); rich text / formula results handled too. Times become
// "HH:MM" so parseTimeCell can consume them.
function cellToStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof v === "number") {
    if (v > 0 && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
    return String(v);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if ("result" in o) return cellToStr(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
  }
  return String(v);
}

// Turn a per-weekday (open, close) getter into the DayHours list + a summary.
// "Closed" in the open cell marks a dark day; a blank/invalid pair is skipped
// (weekday left unchanged on import).
function buildDays(get: (dow: number) => { open: string; close: string }): { days: DayHours[]; summary: string } {
  const days: DayHours[] = [];
  const parts: string[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const { open, close } = get(dow);
    const o = parseTimeCell(open);
    const c = parseTimeCell(close);
    if (o === "closed") { days.push({ day_of_week: dow, is_closed: true, open: null, close: null }); parts.push(`${DAY_LABELS[dow].slice(0, 3)} closed`); continue; }
    if (o && o !== "closed" && c && c !== "closed") {
      days.push({ day_of_week: dow, is_closed: false, open: o, close: c });
      parts.push(`${DAY_LABELS[dow].slice(0, 3)} ${to12(o)}–${to12(c)}`);
    }
  }
  return { days, summary: parts.join(" · ") };
}

// Build ParsedHoursRow list from flat header-keyed records (the CSV template:
// store_number + <weekday>_open / <weekday>_close columns).
export function rowsFromRecords(records: Record<string, string>[]): ParseResult {
  const rows: ParsedHoursRow[] = [];
  const rowErrors: { line: number; reason: string }[] = [];
  records.forEach((rec, i) => {
    const line = i + 2; // header is line 1
    const num = String(rec.store_number ?? rec["store number"] ?? rec["di number"] ?? rec.store ?? "").replace(/[^0-9]/g, "").trim();
    if (!num) { if (Object.values(rec).some((v) => String(v).trim())) rowErrors.push({ line, reason: "missing store_number" }); return; }
    const { days, summary } = buildDays((dow) => ({ open: rec[`${DAY_KEYS[dow]}_open`] ?? "", close: rec[`${DAY_KEYS[dow]}_close`] ?? "" }));
    if (!days.length) { rowErrors.push({ line, reason: `#${num}: no valid day columns` }); return; }
    rows.push({ store_number: num, days, summary });
  });
  return { rows, rowErrors };
}

export function parseHoursText(text: string): ParseResult {
  return rowsFromRecords(parseCSVWithHeader(text));
}

// Detect the grouped "Hours of Ops" layout: a header row with "DI Number" (or
// Store #) and a group row above it naming Monday..Sunday, each spanning an
// Open + Close column. Returns null when that layout isn't present.
function parseGroupedMatrix(rows: unknown[][]): ParseResult | null {
  let hr = -1, sc = -1;
  for (let r = 0; r < Math.min(8, rows.length) && hr < 0; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const s = cellToStr(rows[r][c]).trim().toLowerCase();
      if (/^(di ?number|di ?#|store ?number|store ?#|store)$/.test(s)) { hr = r; sc = c; break; }
    }
  }
  if (hr < 0) return null;
  const groupRow = hr > 0 ? rows[hr - 1] : rows[hr];
  const dayCol: Record<number, { o: number; cl: number }> = {};
  const seen = new Set<number>();
  for (let c = 0; c < groupRow.length; c++) {
    const w = cellToStr(groupRow[c]).trim().toLowerCase().split(/[^a-z]/)[0];
    if (w in DAY_NAME && !seen.has(DAY_NAME[w])) { dayCol[DAY_NAME[w]] = { o: c, cl: c + 1 }; seen.add(DAY_NAME[w]); }
  }
  if (seen.size < 7) return null; // not the full 7-day grouped layout
  const out: ParsedHoursRow[] = [];
  const rowErrors: { line: number; reason: string }[] = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const line = r + 1;
    const num = cellToStr(rows[r][sc]).replace(/[^0-9]/g, "");
    if (!num) continue; // blank / spacer row
    const { days, summary } = buildDays((dow) => ({ open: cellToStr(rows[r][dayCol[dow].o]), close: cellToStr(rows[r][dayCol[dow].cl]) }));
    if (!days.length) { rowErrors.push({ line, reason: `#${num}: no valid day columns` }); continue; }
    out.push({ store_number: num, days, summary });
  }
  return { rows: out, rowErrors };
}

// Read the first worksheet of an .xlsx. Auto-detects the grouped "Hours of Ops"
// export (DI Number + Monday..Sunday Open/Close); otherwise falls back to the
// flat template header.
export async function parseHoursXlsx(file: File): Promise<ParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], rowErrors: [{ line: 0, reason: "no sheet found" }] };
  const matrix: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const arr: unknown[] = [];
    for (let c = 1; c <= ws.columnCount; c++) arr.push(ws.getRow(r).getCell(c).value);
    matrix.push(arr);
  }
  const grouped = parseGroupedMatrix(matrix);
  if (grouped) return grouped;
  // Flat fallback: first row is the template header.
  const header = (matrix[0] || []).map((v) => cellToStr(v).trim().toLowerCase());
  const records = matrix.slice(1)
    .filter((r) => r.some((v) => cellToStr(v).trim()))
    .map((r) => { const rec: Record<string, string> = {}; header.forEach((h, i) => { if (h) rec[h] = cellToStr(r[i]).trim(); }); return rec; });
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
