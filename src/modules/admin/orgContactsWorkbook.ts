// Location Contacts by Level — Excel export (Org Admin). Reproduces the exact
// sheet/column layout of the workbook the ops team sends in on every org change,
// populated from the app's org data (gm-roster contacts-export). exceljs, lazy-
// loaded, matching the labor/hours workbook pattern.
//
// Sheets:
//   1. Soar Contacts by level   — 3 rows/store (11=DO, 12=SDO, 13=Primary) + Total
//   2. Alex Sheet               — leadership roster with self-referential labels
//   3. GM only ORG              — one row/store, GM detail + tenure (grouped header)
//   4. Flash Report Data        — store → supervisor/market-leader feed (best-effort)
//   5. Flash Report Distribution List — email lists by level
//   6. ECOLAB Sheet for Tina    — like sheet 1, simpler columns + Count rows
import type { ContactsExportResponse, ContactsExportStore, LeaderContact } from "./gmRosterApi";

// Level-13 "Primary" food-safety contact — a fixed company contact on the source
// workbook. Kept here so it's one place to change.
const OWNER: LeaderContact = { name: "Heath Kelley", first: "Heath", last: "Kelley", phone: "(945)253-2608", email: "Team@soarqsr.com" };

const FEE = "SOAR";
const HEAD_FILL = "FF1E3A5F"; // house navy, matches hours/labor workbooks
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Parse "M/D/YY", "M/D/YYYY", or ISO into a Date (local), or null. Two-digit
// years map to 2000-2099.
function parseLooseDate(s: string | null): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return new Date(y, +m[1] - 1, +m[2]);
}
const yearsSince = (d: Date | null): number | "" => (d ? Math.round(((Date.now() - d.getTime()) / (365.25 * 864e5)) * 100) / 100 : "");
const daysSince = (d: Date | null): number | "" => (d ? Math.max(0, Math.round((Date.now() - d.getTime()) / 864e5)) : "");
const monthName = (s: string | null): string => { const d = parseLooseDate(s); return d ? MONTHS[d.getMonth()] : ""; };
const label = (name: string | null, suffix: string) => (name ? `${name}-${suffix}` : "");

type Ws = {
  addRow: (v: unknown[]) => { height?: number; font?: unknown; fill?: unknown; alignment?: unknown; eachCell?: (cb: (c: unknown, i: number) => void) => void };
  getRow: (n: number) => { font?: unknown; fill?: unknown; alignment?: unknown; height?: number };
  mergeCells: (range: string) => void;
  columns: { width?: number }[];
};

function styleHeader(row: { font?: unknown; fill?: unknown; alignment?: unknown; height?: number }) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
}

export async function downloadContactsWorkbook(data: ContactsExportResponse): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SOAR Hub";
  const stores = [...data.stores].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

  buildContactsByLevel(wb.addWorksheet("Soar Contacts by level") as unknown as Ws, stores);
  buildAlexSheet(wb.addWorksheet("Alex Sheet") as unknown as Ws, data);
  buildGmOnlyOrg(wb.addWorksheet("GM only ORG") as unknown as Ws, stores);
  buildFlashReport(wb.addWorksheet("Flash Report Data") as unknown as Ws, stores);
  buildDistribution(wb.addWorksheet("Flash Report Distributrion List") as unknown as Ws, data);
  buildEcolab(wb.addWorksheet("ECOLAB Sheet for Tina") as unknown as Ws, stores);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toLocaleDateString("en-CA");
  a.download = `SOAR Location Contacts by Level - ${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 1. Soar Contacts by level ────────────────────────────────────────────────
function buildContactsByLevel(ws: Ws, stores: ContactsExportStore[]) {
  ws.addRow([
    "Drive-In Code", "Address", "City", "State", "FEE Name",
    "Food Safety Contact Level Position = Primary (13), Director (12) or Supervisor (11)",
    "", "First Name", "Last Name", "Phone number", "Email address", "", "", "", "11", "12",
  ]);
  styleHeader(ws.getRow(1));
  for (const s of stores) {
    const doLbl = label(s.do.name, "DO"), sdoLbl = label(s.sdo.name, "SDO");
    const line = (lvl: string, c: LeaderContact) =>
      [s.number, s.address ?? "", s.city ?? "", s.state ?? "", FEE, lvl, "", c.first, c.last, c.phone ?? "", c.email ?? "", "", "", "", doLbl, sdoLbl];
    ws.addRow(line("11", s.do));
    ws.addRow(line("12", s.sdo));
    ws.addRow(line("13", OWNER));
    ws.addRow([`${s.number} Total`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "0"]);
  }
  ws.columns.forEach((c, i) => { c.width = [12, 30, 16, 8, 10, 20, 3, 14, 16, 18, 30, 3, 3, 3, 20, 20][i] ?? 12; });
}

// ── 2. Alex Sheet (leadership roster) ────────────────────────────────────────
function buildAlexSheet(ws: Ws, data: ContactsExportResponse) {
  ws.addRow(["Position", "First Name", "Last Name", "Phone number", "Email address", "", "", "", "DO Name", "SDO Name", "RVP Name"]);
  styleHeader(ws.getRow(1));
  for (const l of data.leaders) {
    ws.addRow([
      l.role, l.first, l.last, l.phone ?? "", l.email ?? "", "", "0", "",
      label(l.name, "DO"), label(l.name, "SDO"), "-",
    ]);
  }
  ws.columns.forEach((c, i) => { c.width = [10, 14, 16, 18, 30, 3, 6, 3, 20, 20, 14][i] ?? 12; });
}

// ── 3. GM only ORG ───────────────────────────────────────────────────────────
function buildGmOnlyOrg(ws: Ws, stores: ContactsExportStore[]) {
  // Grouped header row + merges, matching the template.
  ws.addRow(["T", "", "Fill Out These Columns", "", "", "", "", "", "Do Not Edit", "", "", "Fill Out These Columns", "", "Do Not Edit", "", "", "NOTES"]);
  ws.mergeCells("A1:B1"); ws.mergeCells("C1:H1"); ws.mergeCells("I1:K1"); ws.mergeCells("L1:M1"); ws.mergeCells("N1:O1");
  const g = ws.getRow(1);
  g.font = { bold: true, color: { argb: "FFFFFFFF" } };
  g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
  g.alignment = { vertical: "middle", horizontal: "center" };
  ws.addRow([
    "Store #", "Store Name", "DO", "SDO", "RVP", "GM (Full Name)",
    "Original Date of Hire with SOAR", "Date of Placement as GM into this location",
    "Tenure with SOAR (Years)", "Tenure in Location (Years)", "Days",
    "GM Cell Phone Number", "GM Birthday", "Birth Month (Auto Fill)", "Store Email",
  ]);
  const h = ws.getRow(2);
  h.font = { bold: true }; h.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; h.height = 40;
  for (const s of stores) {
    const hire = parseLooseDate(s.gm.hire_date), place = parseLooseDate(s.gm.placement_date);
    const gmName = s.gm.status === "open" ? "OPEN" : (s.gm.name ?? "");
    ws.addRow([
      s.number, s.name ?? "", label(s.do.name, "DO"), label(s.sdo.name, "SDO"), label(s.rvp.name, "RVP"),
      gmName, s.gm.hire_date ?? "", s.gm.placement_date ?? "",
      yearsSince(hire), yearsSince(place), daysSince(place),
      s.gm.cell ?? "", s.gm.birthday ?? "", monthName(s.gm.birthday), s.email ?? "",
    ]);
  }
  ws.columns.forEach((c, i) => { c.width = [9, 26, 18, 20, 18, 20, 16, 16, 12, 12, 8, 18, 12, 14, 28][i] ?? 12; });
}

// ── 4. Flash Report Data (best-effort) ───────────────────────────────────────
// The source feed carries a store's DO (SUPERVISOR_PARTNER) + RVP (MARKET_LEADER)
// + ORGANIZATION, plus a run of contact blocks. We fill the identifying columns
// faithfully; the trailing placeholder blocks are left blank for the ops feed.
function buildFlashReport(ws: Ws, stores: ContactsExportStore[]) {
  ws.addRow([
    "STORE_ID", "SUPERVISOR_PARTNER_FIRST_NAME", "SUPERVISOR_PARTNER_LAST_NAME",
    "MARKET_LEADER_FIRST_NAME", "MARKET_LEADER_LAST_NAME", "ORGANIZATION_FIRST_NAME",
  ]);
  styleHeader(ws.getRow(1));
  for (const s of stores) {
    ws.addRow([s.number, s.do.first, s.do.last, s.rvp.first, s.rvp.last, FEE]);
  }
  ws.columns.forEach((c, i) => { c.width = [10, 24, 24, 24, 24, 18][i] ?? 12; });
}

// ── 5. Flash Report Distribution List ────────────────────────────────────────
function buildDistribution(ws: Ws, data: ContactsExportResponse) {
  ws.addRow(["Presidents\n Flash report", "RVPS\n Flash report", "SDO \nFlash reports", "DO \nFlash Reports"]);
  styleHeader(ws.getRow(1));
  const byRole = (r: string) => data.leaders.filter((l) => l.role === r).map((l) => l.email).filter(Boolean) as string[];
  const cols = [data.presidents ?? [], byRole("RVP"), byRole("SDO"), byRole("DO")];
  const maxLen = Math.max(0, ...cols.map((c) => c.length));
  for (let i = 0; i < maxLen; i++) ws.addRow(cols.map((c) => c[i] ?? ""));
  ws.columns.forEach((c) => { c.width = 30; });
}

// ── 6. ECOLAB Sheet for Tina ─────────────────────────────────────────────────
function buildEcolab(ws: Ws, stores: ContactsExportStore[]) {
  ws.addRow(["Drive-In Code", "Address", "City", "State", "FEE Name",
    "Food Safety Contact Level Position = Primary (13), Director (12) or Supervisor (11)",
    "First Name", "Last Name", "Phone number", "Email address", "", ""]);
  styleHeader(ws.getRow(1));
  for (const s of stores) {
    const line = (lvl: string, c: LeaderContact) =>
      [s.number, s.address ?? "", s.city ?? "", s.state ?? "", FEE, lvl, c.first, c.last, c.phone ?? "", c.email ?? "", "", ""];
    ws.addRow(line("11", s.do));
    ws.addRow(line("12", s.sdo));
    ws.addRow(line("13", OWNER));
    ws.addRow([`${s.number} Count`, "", "", "", "", "", "", "", "", "3", "", ""]);
  }
  ws.columns.forEach((c, i) => { c.width = [12, 30, 16, 8, 10, 20, 14, 16, 18, 30, 3, 3][i] ?? 12; });
}
