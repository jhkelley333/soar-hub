// GM roster import — parse a paste or an .xlsx/.csv file into rows, then diff
// each against the current roster so the user can merge or decline per store.
import type { GmRosterRow } from "./gmRosterApi";

export type RosterField = "gm_name" | "gm_email" | "gm_cell" | "gm_birthday" | "hire_date" | "placement_date" | "store_name";
export const FIELD_LABELS: Record<RosterField, string> = {
  gm_name: "GM name", gm_email: "Email", gm_cell: "Cell", gm_birthday: "Birthday",
  hire_date: "Hire date", placement_date: "Placement date", store_name: "Store name",
};
const DIFF_FIELDS: RosterField[] = ["gm_name", "gm_cell", "gm_birthday", "hire_date", "placement_date", "gm_email", "store_name"];

export interface UploadRow { store_number: string; values: Partial<Record<RosterField, string>>; }

// Header → field, by substring (a header CONTAINS an alias). Ordered specific →
// generic so compound headers ("Original Date of Hire", "GM Cell Phone Number")
// resolve correctly and bare tokens ("store") only catch what's left. First
// match wins; store_number is last so "Store Name" isn't grabbed as the number.
const HEADER_MAP: { field: RosterField | "store_number"; aliases: string[] }[] = [
  { field: "gm_name", aliases: ["gm (full name)", "gm full name", "general manager", "gm name", "manager name"] },
  { field: "hire_date", aliases: ["date of hire", "hire date", "date hired", "soar hire", "hire with soar"] },
  { field: "placement_date", aliases: ["date of placement", "placement date", "store placement", "placement as", "date placed"] },
  { field: "gm_cell", aliases: ["cell phone", "gm cell", "cell number", "cell", "gm phone", "phone number", "mobile"] },
  { field: "gm_birthday", aliases: ["birthday", "birth date", "date of birth", "dob"] }, // NOT "birth month"
  { field: "gm_email", aliases: ["store email", "gm email", "email"] },
  { field: "store_name", aliases: ["store name", "location"] },
  { field: "store_number", aliases: ["store #", "store#", "store number", "store no", "di number", "di #", "di#", "unit #", "unit", "store"] },
];

function matchHeader(h: string): RosterField | "store_number" | null {
  const s = h.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  for (const { field, aliases } of HEADER_MAP) for (const a of aliases) if (s.includes(a)) return field;
  return null;
}

const digits = (v: string) => v.replace(/\D/g, "");

// Parse a loose US date ("12/14/2021", "7/13/26", "03/29/1992") to YYYY-MM-DD,
// else null. 2-digit years pivot at 68 (JS convention): 00-68 → 20xx, 69-99 → 19xx.
export function parseDate(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  let mo: number, d: number, y: number;
  if (s.includes("-") && m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y = y <= 68 ? 2000 + y : 1900 + y; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "Feb 13, 1993" for display; falls back to the raw string.
export function fmtDate(v: string | null | undefined): string {
  const iso = parseDate(v);
  if (!iso) return v ? String(v) : "—";
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// "2y 7m" tenure/stability from a date to today; "" if unparseable.
export function sinceLabel(v: string | null | undefined): string {
  const iso = parseDate(v);
  if (!iso) return "";
  const [y, mo, d] = iso.split("-").map(Number);
  const then = new Date(y, mo - 1, d);
  const now = new Date();
  let months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;
  if (months < 0) return "";
  return `${Math.floor(months / 12)}y ${months % 12}m`;
}

// Normalize a field value for equality (dates→ISO, phones→digits, else trim/lower).
function norm(field: RosterField, v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (field === "hire_date" || field === "placement_date" || field === "gm_birthday") return parseDate(s) ?? s.toLowerCase();
  if (field === "gm_cell") return digits(s);
  return s.toLowerCase();
}

const currentValue = (r: GmRosterRow, f: RosterField): string | null => {
  switch (f) {
    case "gm_name": return r.roster_name;
    case "gm_email": return r.gm_email;
    case "gm_cell": return r.gm_cell;
    case "gm_birthday": return r.gm_birthday;
    case "hire_date": return r.hire_date;
    case "placement_date": return r.placement_date;
    case "store_name": return r.store_name;
  }
};

export interface FieldChange { field: RosterField; label: string; from: string | null; to: string; }
export interface DiffRow {
  store_number: string;
  store_name: string | null;
  status: "new" | "unchanged" | "changed"; // new = store not in current roster
  changes: FieldChange[];                  // provided fields that differ
  values: Partial<Record<RosterField, string>>;
}

// Compare each upload row against the current roster (by store number).
export function diffUpload(uploads: UploadRow[], current: GmRosterRow[]): DiffRow[] {
  const byNum = new Map(current.map((r) => [String(r.store_number), r]));
  return uploads.map((u) => {
    const cur = byNum.get(u.store_number) || null;
    if (!cur) return { store_number: u.store_number, store_name: u.values.store_name ?? null, status: "new", changes: [], values: u.values };
    const changes: FieldChange[] = [];
    for (const f of DIFF_FIELDS) {
      const up = u.values[f];
      if (up == null || String(up).trim() === "") continue; // only provided fields
      if (norm(f, up) !== norm(f, currentValue(cur, f))) {
        changes.push({ field: f, label: FIELD_LABELS[f], from: currentValue(cur, f), to: String(up).trim() });
      }
    }
    return { store_number: u.store_number, store_name: cur.store_name, status: changes.length ? "changed" : "unchanged", changes, values: u.values };
  });
}

// Build the full import row for an accepted store: current values with the
// upload's provided (non-empty) fields layered on top, so unmentioned fields
// are preserved (the backend upsert would otherwise null them).
export function mergedImportRow(u: UploadRow, current: GmRosterRow[]): Record<string, string> {
  const cur = current.find((r) => String(r.store_number) === u.store_number) || null;
  const pick = (f: RosterField): string => {
    const up = u.values[f];
    if (up != null && String(up).trim() !== "") return String(up).trim();
    return (cur ? currentValue(cur, f) : null) ?? "";
  };
  return {
    store_number: u.store_number,
    store_name: pick("store_name"),
    gm_name: pick("gm_name"),
    gm_email: pick("gm_email"),
    gm_cell: pick("gm_cell"),
    gm_birthday: pick("gm_birthday"),
    hire_date: pick("hire_date"),
    placement_date: pick("placement_date"),
  };
}

// ── Parsers ──────────────────────────────────────────────────────────────────
function rowsFromMatrix(header: string[], body: string[][]): UploadRow[] {
  const colField: (RosterField | "store_number" | null)[] = header.map(matchHeader);
  const storeCol = colField.indexOf("store_number");
  if (storeCol < 0) return [];
  const out: UploadRow[] = [];
  for (const cells of body) {
    const num = digits(String(cells[storeCol] ?? ""));
    if (!num) continue;
    const values: Partial<Record<RosterField, string>> = {};
    colField.forEach((f, i) => {
      if (!f || f === "store_number") return;
      const v = String(cells[i] ?? "").trim();
      if (v) values[f] = v;
    });
    out.push({ store_number: num, values });
  }
  return out;
}

// Paste: tab- or comma-separated, first row is a header we can map.
export function parsePaste(text: string): UploadRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((x) => x.trim().replace(/^"|"$/g, ""));
  return rowsFromMatrix(split(lines[0]), lines.slice(1).map(split));
}

// .xlsx (first sheet) via exceljs. Time/number cells → string; picks the header
// row automatically (first row that maps a store-number column).
export async function parseRosterXlsx(file: File): Promise<UploadRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const cell = (v: unknown): string => {
    if (v == null) return "";
    if (v instanceof Date) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
    if (typeof v === "object") { const o = v as Record<string, unknown>; if (typeof o.text === "string") return o.text; if ("result" in o) return cell(o.result); }
    return String(v);
  };
  const matrix: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const arr: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) arr.push(cell(ws.getRow(r).getCell(c).value).trim());
    matrix.push(arr);
  }
  // Find the header row: the first row (of the first 8) that maps a store column.
  let hr = -1;
  for (let i = 0; i < Math.min(8, matrix.length); i++) {
    if (matrix[i].map(matchHeader).includes("store_number")) { hr = i; break; }
  }
  if (hr < 0) return [];
  return rowsFromMatrix(matrix[hr], matrix.slice(hr + 1));
}
