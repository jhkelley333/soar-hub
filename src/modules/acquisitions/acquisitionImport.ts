// Parse an .xlsx/.csv of acquired stores into staged rows. Columns are matched
// by header (substring, specific → generic). A store number is required per row.
import type { AcqStoreInput } from "./api";

type Field = keyof AcqStoreInput;
const HEADER_MAP: { field: Field; aliases: string[] }[] = [
  { field: "store_number", aliases: ["store #", "store#", "store number", "store no", "di number", "di #", "unit #", "unit", "number"] },
  { field: "name", aliases: ["store name", "location name", "location", "name"] },
  { field: "address", aliases: ["address", "street"] },
  { field: "city", aliases: ["city"] },
  { field: "state", aliases: ["state", "st"] },
  { field: "zip", aliases: ["zip", "postal"] },
  { field: "phone", aliases: ["store phone", "phone"] },
  { field: "region_name", aliases: ["region"] },
  { field: "area_name", aliases: ["area", "market"] },
  { field: "district_name", aliases: ["district"] },
  { field: "gm_email", aliases: ["gm email", "manager email", "email"] },
  { field: "gm_phone", aliases: ["gm phone", "gm cell", "manager phone", "gm mobile"] },
  { field: "gm_name", aliases: ["gm name", "gm (full name)", "general manager", "manager name", "gm"] },
  { field: "notes", aliases: ["notes", "note", "comment"] },
];

function matchHeader(h: string): Field | null {
  const s = h.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  for (const { field, aliases } of HEADER_MAP) for (const a of aliases) if (s.includes(a)) return field;
  return null;
}

function rowsFromMatrix(header: string[], body: string[][]): AcqStoreInput[] {
  const cols = header.map(matchHeader);
  const storeCol = cols.indexOf("store_number");
  if (storeCol < 0) return [];
  const out: AcqStoreInput[] = [];
  for (const cells of body) {
    const num = String(cells[storeCol] ?? "").replace(/\D/g, "");
    if (!num) continue;
    const row: AcqStoreInput = { store_number: num };
    cols.forEach((f, i) => {
      if (!f || f === "store_number") return;
      const v = String(cells[i] ?? "").trim();
      if (v) (row as unknown as Record<string, string>)[f] = v;
    });
    out.push(row);
  }
  return out;
}

export function parseAcquisitionPaste(text: string): AcqStoreInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(",")).map((x) => x.trim().replace(/^"|"$/g, ""));
  return rowsFromMatrix(split(lines[0]), lines.slice(1).map(split));
}

export async function parseAcquisitionXlsx(file: File): Promise<AcqStoreInput[]> {
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
  let hr = -1;
  for (let i = 0; i < Math.min(8, matrix.length); i++) if (matrix[i].map(matchHeader).includes("store_number")) { hr = i; break; }
  if (hr < 0) return [];
  return rowsFromMatrix(matrix[hr], matrix.slice(hr + 1));
}
