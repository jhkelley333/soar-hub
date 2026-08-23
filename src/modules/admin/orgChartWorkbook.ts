// SOAR QSR Org Chart — auto-generated Excel export (Org Admin). Reproduces the
// visual boxed org chart from live org data: a title band, then a tiered tree of
// merged, colored boxes — RVP → SDO → DO, each DO box carrying its district name
// and store list. Regenerates on every org change. Not a pixel match of the
// hand-built original, but the same tiered, boxed visual style. exceljs, lazy-
// loaded, matching the other workbook exports.
import type { OrgArea, OrgDistrict, OrgManager, OrgRegion, OrgTreeResponse } from "./api";

const NAVY = "FF1E3A5F";
const RVP_FILL = "FF1E3A5F";
const SDO_FILL = "FF2E5E8C";
const DO_FILL = "FFDCE7F1";
const WHITE = "FFFFFFFF";
const INK = "FF1E293B";

const BOX_W = 6; // columns per box
const GAP = 1; // columns between sibling leaf boxes

type Tier = "rvp" | "sdo" | "do";
interface Placed { tier: Tier; label: string; fill: string; font: string; s: number; e: number; }

function leaderName(managers: OrgManager[], role: string): string {
  const m = managers.find((x) => String(x.role).toLowerCase() === role) || managers[0];
  return (m?.full_name || "").trim();
}
const districtStores = (d: OrgDistrict) => d.stores.filter((s) => s.is_active !== false);
const areaCount = (a: OrgArea) => a.districts.reduce((n, d) => n + districtStores(d).length, 0);
const regionCount = (r: OrgRegion) => r.areas.reduce((n, a) => n + areaCount(a), 0);

// exceljs types are loose here; the runtime object matches the calls used.
type Ws = {
  mergeCells: (t: number, l: number, b: number, r: number) => void;
  getCell: (r: number, c: number) => { value?: unknown; alignment?: unknown; font?: unknown; fill?: unknown; border?: unknown };
  getColumn: (c: number) => { width?: number };
  getRow: (r: number) => { height?: number };
};

function drawBox(ws: Ws, top: number, left: number, bottom: number, right: number, text: string, fill: string, font: string) {
  ws.mergeCells(top, left, bottom, right);
  const cell = ws.getCell(top, left);
  cell.value = text;
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.font = { bold: true, size: 9, color: { argb: font } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  const edge = { style: "thin" as const, color: { argb: "FF94A3B8" } };
  cell.border = { top: edge, left: edge, bottom: edge, right: edge };
}

export async function downloadOrgChartWorkbook(tree: OrgTreeResponse): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const ws = wb.addWorksheet("Org Chart", { views: [{ showGridLines: false }] }) as unknown as Ws;

  const placed: Placed[] = [];
  let cursor = 2; // first usable column (leave col A as a margin)

  // Lay leaves (DOs) left→right; parents center over their children's span.
  const activeRegions = tree.regions.filter((r) => r.is_active !== false);
  for (const r of activeRegions) {
    const rvpLabel = `${leaderName(r.managers, "rvp") || r.name}\nRegional Vice President of Operations\n${regionCount(r)}`;
    const rvpStart = cursor;
    const areas = r.areas.filter((a) => a.is_active !== false);
    if (!areas.length) {
      const s = cursor; cursor += BOX_W;
      placed.push({ tier: "rvp", s, e: s + BOX_W - 1, fill: RVP_FILL, font: WHITE, label: rvpLabel });
      cursor += GAP;
      continue;
    }
    for (const a of areas) {
      const sdoStart = cursor;
      const dists = a.districts.filter((d) => d.is_active !== false);
      if (!dists.length) {
        const s = cursor; cursor += BOX_W;
        placed.push({ tier: "sdo", s, e: s + BOX_W - 1, fill: SDO_FILL, font: WHITE,
          label: `${leaderName(a.managers, "sdo") || a.name}\nSenior Director of Operations\n${areaCount(a)}` });
        cursor += GAP;
        continue;
      }
      for (const d of dists) {
        const s = cursor; cursor += BOX_W;
        const stores = districtStores(d).map((x) => x.number).join(", ");
        placed.push({ tier: "do", s, e: s + BOX_W - 1, fill: DO_FILL, font: INK,
          label: `${leaderName(d.managers, "do") || "—"}\n${d.name}\n${stores}` });
        cursor += GAP;
      }
      const sdoEnd = cursor - GAP - 1;
      placed.push({ tier: "sdo", s: sdoStart, e: sdoEnd, fill: SDO_FILL, font: WHITE,
        label: `${leaderName(a.managers, "sdo") || a.name}\nSenior Director of Operations\n${areaCount(a)}` });
    }
    const rvpEnd = cursor - GAP - 1;
    placed.push({ tier: "rvp", s: rvpStart, e: rvpEnd, fill: RVP_FILL, font: WHITE, label: rvpLabel });
  }

  const maxCol = Math.max(BOX_W + 1, cursor - GAP - 1);

  // Title band.
  ws.mergeCells(1, 2, 2, maxCol);
  const title = ws.getCell(1, 2);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  title.value = `SOAR QSR Org Chart — ${today}`;
  title.alignment = { vertical: "middle", horizontal: "center" };
  title.font = { bold: true, size: 16, color: { argb: WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

  // Tier rows: RVP 4–6, SDO 8–10, DO 12–16 (DO taller for the store list).
  const ROWS: Record<Tier, [number, number]> = { rvp: [4, 6], sdo: [8, 10], do: [12, 16] };
  for (const p of placed) {
    const [t, b] = ROWS[p.tier];
    drawBox(ws, t, p.s, b, p.e, p.label, p.fill, p.font);
  }

  for (let c = 1; c <= maxCol; c++) ws.getColumn(c).width = 4;
  for (const r of [1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16]) ws.getRow(r).height = 18;

  const buf = await (wb as unknown as { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }).xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SOAR QSR Org Chart - ${new Date().toLocaleDateString("en-CA")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
