// P&L + Action Plan PDF — a store's income statement followed by the review's
// flags and each author's Root Cause / 21-day Action Steps. Built with jsPDF.
import { jsPDF } from "jspdf";
import type { PlLine } from "./types";
import type { PlReviewResponse } from "./api";

interface PdfStatement {
  store_number: string;
  store_name?: string | null;
  period_end: string;
  period_label?: string | null;
  stage?: string;
  lines: PlLine[];
  total_sales: number | null;
}

const usd = (v: number | null | undefined) =>
  v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
const pct = (v: number | null | undefined) => (v == null ? "" : `${v.toFixed(2)}%`);

export function exportPlPdf(s: PdfStatement, review: PlReviewResponse | null): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const bottom = H - M;
  let y = M;
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M; } };

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(13, 42, 76);
  doc.text(`#${s.store_number}${s.store_name ? ` · ${s.store_name}` : ""}`, M, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`P&L · ${s.period_label ?? s.period_end} · ${s.stage === "final" ? "Final" : "Prelim"}`, M, y); y += 8;

  // Income statement
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(13, 42, 76);
  doc.text("Income Statement", M, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(150);
  doc.text("Line", M, y); doc.text("$", W - M - 28, y, { align: "right" }); doc.text("% Sales", W - M, y, { align: "right" });
  y += 1.5; doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 3;
  for (const l of s.lines || []) {
    ensure(5);
    const bold = !!l.total;
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5); doc.setTextColor(bold ? 20 : 70);
    doc.text(String(l.label ?? "").slice(0, 62), M, y);
    doc.text(usd(l.amount), W - M - 28, y, { align: "right" });
    doc.text(pct(l.pct), W - M, y, { align: "right" });
    y += 4.2;
    if (bold) { doc.setDrawColor(235); doc.line(M, y - 1.4, W - M, y - 1.4); }
  }
  y += 5;

  // Action plan
  const flags = review?.flags ?? [];
  ensure(10);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(13, 42, 76);
  doc.text(`Action Plan${flags.length ? ` — ${flags.length} flag${flags.length === 1 ? "" : "s"}` : ""}`, M, y); y += 5;

  if (!flags.length) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text("No flags — within budget and in line with trend.", M, y); y += 6;
  }

  const notesByLine: Record<string, PlReviewResponse["notes"]> = {};
  for (const n of review?.notes ?? []) (notesByLine[n.line_key] ||= []).push(n);

  for (const f of flags) {
    ensure(16);
    const sev = f.severity === "high" ? "[HIGH] " : f.severity === "med" ? "[MED] " : "";
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(20, 30, 45);
    doc.text(`${sev}${f.label}`, M, y); y += 4.4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
    for (const ln of doc.splitTextToSize(f.message, W - 2 * M)) { ensure(4.3); doc.text(ln, M, y); y += 3.9; }
    doc.setTextColor(115);
    for (const c of f.context || []) {
      for (const ln of doc.splitTextToSize(`• ${c}`, W - 2 * M - 3)) { ensure(4.3); doc.text(ln, M + 3, y); y += 3.9; }
    }
    for (const n of notesByLine[f.line_key] || []) {
      ensure(10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(30);
      doc.text(`${n.author_name ?? "—"} (${n.author_role ?? ""})`, M + 3, y); y += 3.6;
      doc.setFont("helvetica", "normal"); doc.setTextColor(70);
      if (n.root_cause) for (const ln of doc.splitTextToSize(`Root cause: ${n.root_cause}`, W - 2 * M - 6)) { ensure(4); doc.text(ln, M + 6, y); y += 3.6; }
      if (n.action_steps) for (const ln of doc.splitTextToSize(`Action (21 days): ${n.action_steps}`, W - 2 * M - 6)) { ensure(4); doc.text(ln, M + 6, y); y += 3.6; }
    }
    y += 3;
  }

  doc.save(`PL-${s.store_number}-${s.period_end}.pdf`);
}
