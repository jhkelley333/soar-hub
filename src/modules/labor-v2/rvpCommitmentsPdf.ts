// RVP Commitments — meeting PDF. One page-flowing report: a company summary
// (committed savings if every RVP hits target, and what the current gaps are
// costing) then a block per RVP — each metric's 4-week base, last-4-week actual
// average, target, on/off status, and the dollar impact (committed savings,
// realized, and the cost of the gap to target). jsPDF, client-side.
import { jsPDF } from "jspdf";
import type { CommitMetric, RvpCommitmentsResponse, RvpCommitWeek } from "./api";

type Dir = "up" | "down";
interface MDef { label: string; unit: "h" | "%"; dir: Dir; group: string }
const M: Record<CommitMetric, MDef> = {
  labor_hours_over: { label: "Hours Over Chart", unit: "h", dir: "down", group: "Labor" },
  labor_avs_pct: { label: "Actual vs Scheduled", unit: "%", dir: "down", group: "Labor" },
  cogs_efficiency: { label: "COGS Efficiency", unit: "%", dir: "up", group: "COGS" },
};
const ORDER: CommitMetric[] = ["labor_hours_over", "labor_avs_pct", "cogs_efficiency"];

// NOTE: jsPDF's WinAnsi font encoding lacks ≥ ≤ − — (they garble + trigger a
// letter-spaced font fallback), so this PDF uses ASCII equivalents only.
const fmtVal = (v: number | null, unit: "h" | "%") =>
  v == null ? "-" : unit === "h" ? `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}h` : `${v.toFixed(1)}%`;
const fmtTarget = (v: number | null, m: MDef) =>
  v == null ? "-" : `${m.dir === "up" ? ">=" : "<="} ${m.unit === "h" ? `${v}h` : `${v}%`}`;
const usd = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const per30 = (weekly: number | null | undefined) => (weekly == null ? null : Math.round((weekly * 30) / 7));
const fmtWeek = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Track = "on" | "off" | "no-target" | "no-data";
function track(actual: number | null, target: number | null, dir: Dir): Track {
  if (target == null) return "no-target";
  if (actual == null) return "no-data";
  return (dir === "up" ? actual >= target : actual <= target) ? "on" : "off";
}
const TRACK_LABEL: Record<Track, string> = { on: "On track", off: "Off track", "no-target": "No target", "no-data": "No data" };

// A compact week-to-week strip: each of the last completed weeks with its value,
// colored green when the move vs the prior week is good for this metric, red when
// worse, grey when flat / first. ASCII only (jsPDF-safe).
function drawWeekStrip(doc: jsPDF, x: number, y: number, series: RvpCommitWeek[], m: MDef, rightEdge: number) {
  doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); doc.setTextColor(165, 165, 165);
  doc.text("WK-TO-WK", x, y);
  let cx = x + 18;
  let prev: number | null = null;
  for (const w of series) {
    const wk = fmtWeek(w.weekEnd);
    if (cx > rightEdge - 20) break; // don't overflow the page
    doc.setFont("helvetica", "normal"); doc.setTextColor(160, 160, 160); doc.setFontSize(6.5);
    doc.text(wk, cx, y);
    cx += doc.getTextWidth(wk) + 1.4;
    const valStr = fmtVal(w.value, m.unit);
    let color: [number, number, number] = [90, 90, 90];
    if (w.value != null && prev != null && w.value !== prev) {
      const better = m.dir === "up" ? w.value > prev : w.value < prev;
      color = better ? [22, 130, 60] : [197, 40, 40];
    }
    doc.setFont("helvetica", "bold"); doc.setTextColor(color[0], color[1], color[2]);
    doc.text(valStr, cx, y);
    cx += doc.getTextWidth(valStr) + 4;
    if (w.value != null) prev = w.value;
  }
}

export function exportRvpCommitmentsPdf(data: RvpCommitmentsResponse): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M0 = 14;
  const bottom = pageH - M0;
  let y = M0;
  const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M0; } };

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const baseWeeks = data.recent_week_ends ?? [];
  const window = baseWeeks.length ? `${fmtWeek(baseWeeks[baseWeeks.length - 1])}–${fmtWeek(baseWeeks[0])}` : null;

  // Title
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(30, 58, 95);
  doc.text("RVP Commitments", M0, y + 2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
  doc.text(date, pageW - M0, y + 2, { align: "right" });
  y += 8;
  doc.setFontSize(8.5); doc.setTextColor(90, 90, 90);
  const ctx = `Actual = average of the last 4 completed weeks${window ? ` (${window})` : ""}. 4-wk base = the 4 weeks before the commitment. Dollar figures are over the next 30 days (annualized in parentheses).`;
  doc.text(doc.splitTextToSize(ctx, pageW - 2 * M0), M0, y + 3);
  y += 12;

  // ── Company summary ──
  const savedTotal = per30(data.totals.total_weekly);
  const missTotal = per30(data.miss_totals?.total_weekly ?? null);
  doc.setFillColor(30, 58, 95);
  doc.roundedRect(M0, y, pageW - 2 * M0, 20, 2, 2, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("COMPANY", M0 + 4, y + 6);
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(200, 214, 232);
  doc.text("Savings if every RVP hits target", M0 + 4, y + 12);
  doc.text("Cost of current gaps to target", pageW / 2 + 4, y + 12);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
  doc.text(`${usd(savedTotal)} / 30d`, M0 + 4, y + 17.5);
  doc.text(`(${usd(data.totals.total_annual)}/yr)`, M0 + 46, y + 17.5);
  doc.setTextColor(255, 190, 190);
  doc.text(`${usd(missTotal)} / 30d`, pageW / 2 + 4, y + 17.5);
  doc.setTextColor(210, 210, 210); doc.setFontSize(9);
  doc.text(`(${usd(data.miss_totals?.total_annual ?? null)}/yr)`, pageW / 2 + 44, y + 17.5);
  y += 26;

  // ── Per-RVP blocks ──
  const rows = data.rows.filter((r) => r.rvp_name && r.stores > 0);
  for (const row of rows) {
    const metrics = ORDER.filter((k) => !(row.hidden_metrics ?? []).includes(k));
    const blockH = 12 + metrics.length * 11 + 16;
    ensure(blockH);

    // RVP header
    doc.setDrawColor(228, 228, 231); doc.setLineWidth(0.3);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 58, 95);
    doc.text(row.rvp_name || "Unassigned RVP", M0, y + 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
    doc.text(`${row.region} · ${row.stores} store${row.stores === 1 ? "" : "s"}`, M0, y + 8.5);
    y += 11;

    // Metric table header
    const cols = { metric: M0, base: M0 + 78, actual: M0 + 108, target: M0 + 140, status: M0 + 172 };
    doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.setFont("helvetica", "normal");
    doc.text("METRIC", cols.metric, y);
    doc.text("4-WK BASE", cols.base, y, { align: "right" });
    doc.text("ACTUAL · 4WK", cols.actual, y, { align: "right" });
    doc.text("TARGET", cols.target, y, { align: "right" });
    doc.text("STATUS", cols.status, y, { align: "right" });
    y += 1.5;
    doc.setDrawColor(228, 228, 231); doc.line(M0, y, pageW - M0, y);
    y += 4;

    for (const k of metrics) {
      const m = M[k];
      const base = row.baselines[k];
      const actual = row.actual4wk?.[k] ?? row.actuals[k];
      const target = row.targets[k];
      const st = track(actual, target, m.dir);
      doc.setFontSize(8.5); doc.setTextColor(40, 40, 40); doc.setFont("helvetica", "normal");
      doc.text(`${m.group} · ${m.label}`, cols.metric, y);
      doc.setTextColor(90, 90, 90);
      doc.text(fmtVal(base, m.unit), cols.base, y, { align: "right" });
      doc.setTextColor(st === "off" ? 197 : st === "on" ? 22 : 90, st === "off" ? 40 : st === "on" ? 130 : 90, st === "off" ? 40 : st === "on" ? 60 : 90);
      doc.setFont("helvetica", "bold");
      doc.text(fmtVal(actual, m.unit), cols.actual, y, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setTextColor(70, 70, 70);
      doc.text(fmtTarget(target, m), cols.target, y, { align: "right" });
      doc.setTextColor(st === "off" ? 197 : st === "on" ? 22 : 150, st === "off" ? 40 : st === "on" ? 130 : 150, st === "off" ? 40 : st === "on" ? 60 : 150);
      doc.text(TRACK_LABEL[st], cols.status, y, { align: "right" });
      y += 5;
      drawWeekStrip(doc, cols.metric + 2, y, row.recent?.[k] ?? [], m, pageW - M0);
      y += 6;
    }

    // Financial impact line
    y += 1;
    const saved = per30(row.target_dollars.total_weekly);
    const miss = per30(row.miss_dollars.total_weekly);
    doc.setFillColor(248, 248, 249);
    doc.roundedRect(M0, y, pageW - 2 * M0, 10, 1.5, 1.5, "F");
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.setTextColor(22, 130, 60);
    doc.text(`Savings if hit target: ${usd(saved)} / 30d (${usd(row.target_dollars.total_annual)}/yr)`, M0 + 3, y + 6.5);
    if (miss) {
      doc.setTextColor(197, 40, 40);
      doc.text(`Cost of gap now: ${usd(miss)} / 30d (${usd(row.miss_dollars.total_annual)}/yr)`, pageW / 2 + 6, y + 6.5);
    } else {
      doc.setTextColor(22, 130, 60);
      doc.text("On track — no gap cost.", pageW / 2 + 6, y + 6.5);
    }
    y += 16;
  }

  doc.save(`RVP Commitments - ${new Date().toISOString().slice(0, 10)}.pdf`);
}
