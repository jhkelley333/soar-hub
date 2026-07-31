// Org chart PDF — "RVP and below" from the live org tree. One region (RVP) per
// page: RVP header, then each SDO (area), each DO (district), and that DO's
// stores. Generated with jsPDF (no server round-trip). Downloadable from Org
// Admin next to the CSV exports.
import { jsPDF } from "jspdf";
import type { OrgManager, OrgTreeResponse } from "./api";

// Primary (non-acting) leader name(s) at a node; falls back to acting, then "—".
function leaderName(managers: OrgManager[], role?: string): string {
  const scoped = role ? managers.filter((m) => m.role === role) : managers;
  const primary = scoped.filter((m) => !m.acting);
  const chosen = primary.length ? primary : scoped;
  const names = chosen.map((m) => m.full_name || m.email).filter(Boolean);
  return names.length ? names.join(" / ") : "—";
}

const TITLE = {
  rvp: "Regional Vice President of Operations",
  sdo: "Senior Director of Operations",
  do: "Director of Operations",
};

export function exportOrgChartPdf(tree: OrgTreeResponse | null): void {
  if (!tree || !tree.regions.length) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 12;
  const bottom = pageH - M;
  const date = new Date().toISOString().slice(0, 10);

  let y = 0;
  const ensure = (h: number) => {
    if (y + h > bottom) { doc.addPage(); y = M; }
  };
  const setFill = (hex: [number, number, number]) => doc.setFillColor(hex[0], hex[1], hex[2]);

  const regions = tree.regions.filter((r) => r.is_active !== false);
  regions.forEach((region, ri) => {
    if (ri > 0) doc.addPage();
    y = M;

    // Running header
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`SOAR QSR Org Chart  ·  ${date}`, M, y);
    y += 6;

    // ── RVP bar (region) ──────────────────────────────────────────────
    setFill([13, 42, 76]); // midnight
    doc.roundedRect(M, y, pageW - 2 * M, 14, 1.5, 1.5, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(leaderName(region.managers, "rvp"), M + 4, y + 6.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(200, 214, 232);
    doc.text(`${TITLE.rvp}   ·   ${region.name}${region.code ? ` (${region.code})` : ""}`, M + 4, y + 11.5);
    y += 18;

    for (const area of region.areas) {
      if (area.is_active === false) continue;
      // ── SDO bar (area) ──────────────────────────────────────────────
      ensure(11);
      setFill([224, 233, 245]);
      doc.setDrawColor(180, 198, 224); doc.setLineWidth(0.2);
      doc.roundedRect(M + 4, y, pageW - 2 * M - 4, 9, 1, 1, "FD");
      doc.setTextColor(13, 42, 76); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
      doc.text(leaderName(area.managers, "sdo"), M + 8, y + 4);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90, 110, 140);
      doc.text(`${TITLE.sdo}   ·   ${area.name}`, M + 8, y + 7.5);
      y += 12;

      for (const district of area.districts) {
        if (district.is_active === false) continue;
        const stores = district.stores.filter((s) => s.is_active !== false);
        // ── DO row (district) ────────────────────────────────────────
        ensure(8);
        doc.setDrawColor(210); doc.setLineWidth(0.2);
        doc.line(M + 10, y, M + 10, y + 5);
        const doName = leaderName(district.managers, "do");
        doc.setTextColor(20, 30, 45); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
        doc.text(doName, M + 12, y + 2.5);
        const nameW = doc.getTextWidth(doName);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
        const dLabel = `${TITLE.do}${district.code ? `  ·  ${district.code}` : ""}  ·  ${stores.length} store${stores.length === 1 ? "" : "s"}`;
        doc.text(dLabel, M + 12 + nameW + 4, y + 2.5);
        y += 5;

        // Stores — wrapped chips of "#num Name"
        doc.setFontSize(8); doc.setTextColor(60);
        const items = stores.map((s) => `#${s.number} ${s.name ?? ""}`.trim());
        const colW = (pageW - 2 * M - 16) / 3;
        for (let i = 0; i < items.length; i += 3) {
          ensure(5);
          for (let c = 0; c < 3 && i + c < items.length; c++) {
            const line = doc.splitTextToSize(items[i + c], colW - 4)[0];
            doc.text(line, M + 16 + c * colW, y + 3);
          }
          y += 4.5;
        }
        y += 2;
      }
      y += 2;
    }
  });

  doc.save(`SOAR-Org-Chart-${date}.pdf`);
}
