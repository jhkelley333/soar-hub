import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ExecSummary } from "./computeExecSummary";
import { shortName } from "./computeExecSummary";

/**
 * Renders the single-page executive summary. Letter portrait, 0.6in margins.
 * KPI strip · narrative · data warnings · category table · exposure table ·
 * top/bottom board · leadership standings · footnote.
 *
 * Single page (not the handoff's two): this Hub has no ranking-packet
 * distribution feature, so there is no "packets sent" log to fill a second
 * page. Everything worth showing folds onto one page; margins and paddings are
 * tuned so the standings + footnote clear the fold.
 */

const INK: [number, number, number] = [18, 32, 46];
const SLATE: [number, number, number] = [72, 88, 107];
const LINE: [number, number, number] = [211, 218, 226];
const BAND: [number, number, number] = [239, 243, 247];
const ACCENT: [number, number, number] = [31, 92, 139];
const BAD: [number, number, number] = [178, 58, 46];
const GOOD: [number, number, number] = [27, 122, 66];
const ZEBRA: [number, number, number] = [247, 249, 251];

const PT = 72;
const MARGIN = 0.6 * PT;
const PAGE_W = 8.5 * PT;
const PAGE_H = 11 * PT;
const CONTENT_W = PAGE_W - MARGIN * 2;

// autoTable stashes the finished table's geometry on the doc; read finalY
// without reaching for `any`.
const finalY = (doc: jsPDF): number =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

export function renderExecSummaryPdf(s: ExecSummary): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({
    title: `SOAR QSR Weekly Ranking — ${s.header.subtitle}`,
    author: "SOAR Hub Ranking Engine",
  });

  let y = 0;

  const chrome = () => {
    doc.setFillColor(...INK);
    doc.rect(0, 0, PAGE_W, 0.86 * PT, "F");
    doc.setFillColor(95, 168, 211);
    doc.rect(0, 0.86 * PT, PAGE_W, 0.04 * PT, "F");
    doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(13.5);
    doc.text(s.header.title, MARGIN, 0.5 * PT);
    doc.setTextColor(175, 196, 214).setFont("helvetica", "normal").setFontSize(7.8);
    doc.text(s.header.subtitle, MARGIN, 0.68 * PT);

    doc.setTextColor(...SLATE).setFontSize(7);
    doc.text(
      `Generated ${new Date(s.header.generatedAtISO).toLocaleString("en-US")}  ·  Internal — not for distribution outside SOAR QSR`,
      MARGIN,
      PAGE_H - 0.4 * PT,
    );
    doc.setDrawColor(...LINE).setLineWidth(0.5);
    doc.line(MARGIN, PAGE_H - 0.52 * PT, PAGE_W - MARGIN, PAGE_H - 0.52 * PT);
  };

  const section = (title: string, kicker?: string) => {
    doc.setTextColor(...ACCENT).setFont("helvetica", "bold").setFontSize(8.2);
    doc.text(title.toUpperCase(), MARGIN, y);
    y += 9;
    if (kicker) {
      doc.setTextColor(...SLATE).setFont("helvetica", "normal").setFontSize(7.2);
      const lines = doc.splitTextToSize(kicker, CONTENT_W);
      doc.text(lines, MARGIN, y);
      y += lines.length * 9;
    }
    y += 2;
    doc.setDrawColor(...LINE).setLineWidth(0.6);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 6;
  };

  const paragraph = (text: string, size = 8.4, color = SLATE) => {
    doc.setTextColor(...color).setFont("helvetica", "normal").setFontSize(size);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * (size * 1.3);
  };

  chrome();
  y = 1.02 * PT;

  // KPI strip
  const cardW = CONTENT_W / s.kpis.length;
  const stripH = 40;
  doc.setFillColor(...BAND);
  doc.rect(MARGIN, y, CONTENT_W, stripH, "F");
  doc.setDrawColor(...LINE).setLineWidth(0.5);
  doc.rect(MARGIN, y, CONTENT_W, stripH, "S");
  s.kpis.forEach((k, i) => {
    const x = MARGIN + i * cardW + 5;
    if (i > 0) {
      doc.setDrawColor(255, 255, 255).setLineWidth(0.6);
      doc.line(MARGIN + i * cardW, y, MARGIN + i * cardW, y + stripH);
    }
    doc.setTextColor(...SLATE).setFont("helvetica", "bold").setFontSize(5.7);
    doc.text(k.label.toUpperCase(), x, y + 10);
    doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(12.2);
    doc.text(k.value, x, y + 24);
    const tone = k.tone === "bad" ? BAD : k.tone === "good" ? GOOD : SLATE;
    doc.setTextColor(...tone).setFont("helvetica", "normal").setFontSize(6.2);
    doc.text(doc.splitTextToSize(k.sub, cardW - 9), x, y + 32);
  });
  y += stripH + 10;

  paragraph(s.narrative);
  y += 6;

  if (s.dataWarnings.length) {
    doc.setFillColor(252, 243, 241);
    const warnLines = s.dataWarnings.flatMap((w) => doc.splitTextToSize(`• ${w}`, CONTENT_W - 12));
    const boxH = warnLines.length * 8.4 + 10;
    doc.rect(MARGIN, y, CONTENT_W, boxH, "F");
    doc.setDrawColor(...BAD).setLineWidth(1.5);
    doc.line(MARGIN, y, MARGIN, y + boxH);
    doc.setTextColor(...BAD).setFont("helvetica", "normal").setFontSize(6.7);
    doc.text(warnLines, MARGIN + 8, y + 9);
    y += boxH + 9;
  }

  section(
    "Where the points are going",
    "Average score by category across every store, with the share at the top and bottom of the scale.",
  );
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Category", "Avg", "of 5.0", "Stores at 5", "Stores at 1", "Context"]],
    body: s.categories.map((c) => [
      c.label,
      c.avg.toFixed(2),
      "", // bar drawn in didDrawCell
      `${c.atFive} (${Math.round((c.atFive / totalStores(s)) * 100)}%)`,
      `${c.atOne} (${Math.round((c.atOne / totalStores(s)) * 100)}%)`,
      c.context,
    ]),
    theme: "plain",
    styles: { fontSize: 7, cellPadding: 1.4, textColor: INK },
    headStyles: { fillColor: INK, textColor: 255, fontSize: 6.6, fontStyle: "bold" },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: {
      0: { cellWidth: 68 },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 74 },
      3: { cellWidth: 52, halign: "center" },
      4: { cellWidth: 52, halign: "center" },
      5: { cellWidth: "auto", textColor: SLATE, fontSize: 6.8 },
    },
    didDrawCell: (d) => {
      if (d.section !== "body" || d.column.index !== 2) return;
      const c = s.categories[d.row.index];
      const w = Math.max(2, (c.avg / 5) * (d.cell.width - 8));
      const fill = c.avg < 2.5 ? BAD : c.avg < 4 ? ACCENT : GOOD;
      doc.setFillColor(...fill);
      doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 2.5, w, 5, "F");
    },
  });
  y = finalY(doc) + 4;
  doc.setTextColor(...SLATE).setFont("helvetica", "normal").setFontSize(7.2);
  doc.text(doc.splitTextToSize(s.categoryNote, CONTENT_W), MARGIN, y);
  y += 13;

  section(
    "Dollars on the table",
    "Weekly miss against target and the run-rate exposure if the gap holds for a full year. Cash and late tickets are tracked but do not score.",
  );
  const totalRowIndex = s.exposure.findIndex((r) => r.isTotal);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Driver", "Stores missing", "Week miss", "Annualized", "Detail"]],
    body: s.exposure.map((r) => [r.driver, r.storesMissing, r.weekMiss, r.annualized, r.detail]),
    theme: "plain",
    styles: { fontSize: 7, cellPadding: 1.8, textColor: INK },
    headStyles: { fillColor: INK, textColor: 255, fontSize: 6.6, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 58, halign: "center" },
      2: { cellWidth: 58, halign: "right" },
      3: { cellWidth: 58, halign: "right" },
      4: { cellWidth: "auto", textColor: SLATE, fontSize: 6.8 },
    },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === totalRowIndex) {
        d.cell.styles.fillColor = BAND;
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.textColor = INK;
      }
    },
  });
  y = finalY(doc) + 10;

  section("Top and bottom of the board", s.board.note);
  const halfW = (CONTENT_W - 10) / 2;
  const boardBody = (rows: typeof s.board.top) =>
    rows.map((r) => [String(r.rank), r.storeNumber, shortName(r.location), r.gm.slice(0, 19), String(r.totalPoints)]);
  const boardCols = {
    0: { cellWidth: 20, halign: "center" as const },
    1: { cellWidth: 28 },
    2: { cellWidth: 100 },
    3: { cellWidth: 70 },
    4: { cellWidth: 22, halign: "center" as const },
  };
  const topPts = s.board.top[0]?.totalPoints ?? 0;
  const tiedAtTop = s.board.top.filter((r) => r.totalPoints === topPts).length;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN },
    tableWidth: halfW,
    head: [
      [{ content: `TOP 8 — ${topPts} POINTS, HELD BY ${tiedAtTop} STORE${tiedAtTop === 1 ? "" : "S"}`, colSpan: 5, styles: { fillColor: INK, halign: "left" as const } }],
      ["#", "Store", "Location", "GM", "Pts"],
    ],
    body: boardBody(s.board.top),
    theme: "plain",
    styles: { fontSize: 6.7, cellPadding: 1.1, textColor: INK },
    headStyles: { fillColor: [228, 234, 241], textColor: SLATE, fontSize: 6.2, fontStyle: "bold" },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: boardCols,
  });
  const leftEnd = finalY(doc);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN + halfW + 10 },
    tableWidth: halfW,
    head: [
      [{ content: "BOTTOM 8 — LOSING POINTS ON BOTH HALVES OF THE CARD", colSpan: 5, styles: { fillColor: BAD, halign: "left" as const } }],
      ["#", "Store", "Location", "GM", "Pts"],
    ],
    body: boardBody(s.board.bottom),
    theme: "plain",
    styles: { fontSize: 6.7, cellPadding: 1.1, textColor: INK },
    headStyles: { fillColor: [228, 234, 241], textColor: SLATE, fontSize: 6.2, fontStyle: "bold" },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: boardCols,
  });
  y = Math.max(leftEnd, finalY(doc)) + 10;

  // Leadership standings — folded onto the same page (was page 2 in the
  // original two-page layout).
  section("Leadership standings, period to date");
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Level", "Top", "Bottom", "Ranked"]],
    body: s.leaderStandings.map((r) => [r.level, r.top, r.bottom, String(r.ranked)]),
    theme: "plain",
    styles: { fontSize: 7.2, cellPadding: 2, textColor: INK },
    headStyles: { fillColor: INK, textColor: 255, fontSize: 6.8, fontStyle: "bold" },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: {
      0: { cellWidth: 72 },
      1: { cellWidth: 198 },
      2: { cellWidth: 188 },
      3: { cellWidth: "auto", halign: "center" },
    },
  });
  y = finalY(doc) + 8;

  doc.setTextColor(...SLATE).setFont("helvetica", "normal").setFontSize(7);
  doc.text(doc.splitTextToSize(`Note on figures: ${s.footnote}`, CONTENT_W), MARGIN, y);

  return doc;
}

function totalStores(s: ExecSummary): number {
  return s.board.top.length && s.leaderStandings.length
    ? s.leaderStandings[s.leaderStandings.length - 1].ranked
    : 1;
}

export function execSummaryFilename(s: ExecSummary): string {
  const period = s.header.subtitle.split("·")[0].trim().replace(/[^\w]+/g, "-");
  return `SOAR-Ranking-${period}-Executive-Summary.pdf`;
}
