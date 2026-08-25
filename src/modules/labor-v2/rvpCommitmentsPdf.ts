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

// A small up/down triangle (jsPDF can't render ▲▼). Points up/down by the raw
// week-over-week movement; colored by whether that move is good for the metric.
function drawArrow(doc: jsPDF, x: number, baseY: number, up: boolean, color: [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
  const w = 1.4, h = 1.7;
  if (up) doc.triangle(x, baseY, x + w, baseY, x + w / 2, baseY - h, "F");
  else doc.triangle(x, baseY - h, x + w, baseY - h, x + w / 2, baseY, "F");
}

// A compact week-to-week strip: each completed week's value with an up/down
// arrow vs the prior week — green when the move is good for this metric, red when
// worse, grey when flat / first.
function drawWeekStrip(doc: jsPDF, x: number, y: number, series: RvpCommitWeek[], m: MDef, rightEdge: number, fs: number) {
  doc.setFontSize(fs); doc.setFont("helvetica", "normal"); doc.setTextColor(165, 165, 165);
  doc.text("WK:", x, y);
  let cx = x + doc.getTextWidth("WK:") + 2;
  let prev: number | null = null;
  for (const w of series) {
    if (cx > rightEdge - 16) break;
    const wk = fmtWeek(w.weekEnd);
    doc.setFont("helvetica", "normal"); doc.setTextColor(160, 160, 160); doc.setFontSize(fs);
    doc.text(wk, cx, y);
    cx += doc.getTextWidth(wk) + 1.2;
    const valStr = fmtVal(w.value, m.unit);
    let color: [number, number, number] = [90, 90, 90];
    let dir = 0;
    if (w.value != null && prev != null && w.value !== prev) {
      const better = m.dir === "up" ? w.value > prev : w.value < prev;
      color = better ? [22, 130, 60] : [197, 40, 40];
      dir = w.value > prev ? 1 : -1;
    }
    doc.setFont("helvetica", "bold"); doc.setTextColor(color[0], color[1], color[2]); doc.setFontSize(fs);
    doc.text(valStr, cx, y);
    cx += doc.getTextWidth(valStr) + 0.8;
    if (dir !== 0) { drawArrow(doc, cx, y - fs * 0.1, dir > 0, color); cx += 2.4; }
    cx += 2.4;
    if (w.value != null) prev = w.value;
  }
}

export function exportRvpCommitmentsPdf(data: RvpCommitmentsResponse): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M0 = 12;
  const rows = data.rows.filter((r) => r.rvp_name && r.stores > 0);
  const metricsFor = (r: (typeof rows)[number]) => ORDER.filter((k) => !(r.hidden_metrics ?? []).includes(k));

  // Everything fits on ONE page: measure the content in base units, then scale
  // heights + fonts by a single factor so it never spills to a second page.
  const U = { title: 9, ctx: 5, summary: 17, colHead: 5, rvpHead: 6, metric: 5, wk: 4.4, fin: 6.5, gap: 3 };
  // +4 covers the 2mm gap under the summary band plus rounding slack, so a full
  // page never spills to a second one.
  let needed = U.title + U.ctx + U.summary + U.colHead + 4;
  for (const r of rows) needed += U.rvpHead + metricsFor(r).length * (U.metric + U.wk) + U.fin + U.gap;
  const avail = pageH - 2 * M0;
  const scale = Math.min(1, avail / Math.max(1, needed));
  const s = (v: number) => v * scale; // heights
  const fs = (v: number) => v * scale; // font sizes

  let y = M0;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const baseWeeks = data.recent_week_ends ?? [];
  const win = baseWeeks.length ? `${fmtWeek(baseWeeks[baseWeeks.length - 1])}-${fmtWeek(baseWeeks[0])}` : null;

  // Title
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs(16)); doc.setTextColor(30, 58, 95);
  doc.text("RVP Commitments", M0, y + s(5));
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs(9)); doc.setTextColor(120, 120, 120);
  doc.text(date, pageW - M0, y + s(5), { align: "right" });
  y += s(U.title);
  doc.setFontSize(fs(7.5)); doc.setTextColor(110, 110, 110);
  doc.text(`Actual = avg of the last 4 completed weeks${win ? ` (${win})` : ""}. 4-wk base = the 4 weeks before the commitment. $ over the next 30 days (annualized in parentheses).`, M0, y + s(3));
  y += s(U.ctx);

  // ── Company summary band ──
  const bandH = s(U.summary);
  doc.setFillColor(30, 58, 95);
  doc.roundedRect(M0, y, pageW - 2 * M0, bandH, 2, 2, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(fs(8.5));
  doc.text("COMPANY", M0 + 4, y + s(5.5));
  doc.setFontSize(fs(7.5)); doc.setFont("helvetica", "normal"); doc.setTextColor(200, 214, 232);
  doc.text("Savings if every RVP hits target", M0 + 4, y + s(11));
  doc.text("Cost of current gaps to target", pageW / 2 + 4, y + s(11));
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs(12)); doc.setTextColor(255, 255, 255);
  doc.text(`${usd(per30(data.totals.total_weekly))} / 30d`, M0 + 4, y + s(16));
  doc.setFontSize(fs(8.5)); doc.setTextColor(200, 214, 232);
  doc.text(`(${usd(data.totals.total_annual)}/yr)`, M0 + s(44), y + s(16));
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs(12)); doc.setTextColor(255, 190, 190);
  doc.text(`${usd(per30(data.miss_totals?.total_weekly ?? null))} / 30d`, pageW / 2 + 4, y + s(16));
  doc.setFontSize(fs(8.5)); doc.setTextColor(220, 200, 200);
  doc.text(`(${usd(data.miss_totals?.total_annual ?? null)}/yr)`, pageW / 2 + 4 + s(44), y + s(16));
  y += bandH + s(2);

  // ── Global column header (once) ──
  const cols = { metric: M0, base: M0 + 96, actual: M0 + 124, target: M0 + 156, status: pageW - M0 };
  doc.setFontSize(fs(6.5)); doc.setTextColor(150, 150, 150); doc.setFont("helvetica", "normal");
  doc.text("RVP / METRIC", cols.metric, y + s(3));
  doc.text("4-WK BASE", cols.base, y + s(3), { align: "right" });
  doc.text("ACTUAL 4WK", cols.actual, y + s(3), { align: "right" });
  doc.text("TARGET", cols.target, y + s(3), { align: "right" });
  doc.text("STATUS", cols.status, y + s(3), { align: "right" });
  y += s(U.colHead);

  // ── Per-RVP blocks ──
  for (const row of rows) {
    const metrics = metricsFor(row);
    // RVP header line (name + region/stores inline)
    doc.setFont("helvetica", "bold"); doc.setFontSize(fs(9.5)); doc.setTextColor(30, 58, 95);
    doc.text(row.rvp_name || "Unassigned RVP", M0, y + s(4));
    const nameW = doc.getTextWidth(row.rvp_name || "Unassigned RVP");
    doc.setFont("helvetica", "normal"); doc.setFontSize(fs(7.5)); doc.setTextColor(150, 150, 150);
    doc.text(`  ${row.region} · ${row.stores} store${row.stores === 1 ? "" : "s"}`, M0 + nameW, y + s(4));
    doc.setDrawColor(232, 232, 235); doc.setLineWidth(0.2); doc.line(M0, y + s(5.4), pageW - M0, y + s(5.4));
    y += s(U.rvpHead);

    for (const k of metrics) {
      const m = M[k];
      const base = row.baselines[k];
      const actual = row.actual4wk?.[k] ?? row.actuals[k];
      const target = row.targets[k];
      const st = track(actual, target, m.dir);
      const stCol: [number, number, number] = st === "off" ? [197, 40, 40] : st === "on" ? [22, 130, 60] : [140, 140, 140];
      doc.setFontSize(fs(8)); doc.setTextColor(45, 45, 45); doc.setFont("helvetica", "normal");
      doc.text(`${m.group} · ${m.label}`, cols.metric, y + s(3.5));
      doc.setTextColor(90, 90, 90);
      doc.text(fmtVal(base, m.unit), cols.base, y + s(3.5), { align: "right" });
      doc.setTextColor(stCol[0], stCol[1], stCol[2]); doc.setFont("helvetica", "bold");
      doc.text(fmtVal(actual, m.unit), cols.actual, y + s(3.5), { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setTextColor(70, 70, 70);
      doc.text(fmtTarget(target, m), cols.target, y + s(3.5), { align: "right" });
      doc.setTextColor(stCol[0], stCol[1], stCol[2]);
      doc.text(TRACK_LABEL[st], cols.status, y + s(3.5), { align: "right" });
      y += s(U.metric);
      drawWeekStrip(doc, cols.metric + 4, y + s(3), row.recent?.[k] ?? [], m, pageW - M0, fs(6.3));
      y += s(U.wk);
    }

    // Financial impact line
    const saved = per30(row.target_dollars.total_weekly);
    const miss = per30(row.miss_dollars.total_weekly);
    doc.setFillColor(248, 248, 249);
    doc.roundedRect(M0, y, pageW - 2 * M0, s(5.6), 1.2, 1.2, "F");
    doc.setFontSize(fs(7.5)); doc.setFont("helvetica", "bold"); doc.setTextColor(22, 130, 60);
    doc.text(`Savings if hit: ${usd(saved)} / 30d (${usd(row.target_dollars.total_annual)}/yr)`, M0 + 3, y + s(3.8));
    if (miss) {
      doc.setTextColor(197, 40, 40);
      doc.text(`Cost of gap now: ${usd(miss)} / 30d (${usd(row.miss_dollars.total_annual)}/yr)`, pageW / 2 + 4, y + s(3.8));
    } else {
      doc.setTextColor(120, 120, 120);
      doc.text("On track - no gap cost.", pageW / 2 + 4, y + s(3.8));
    }
    y += s(U.fin) + s(U.gap);
  }

  doc.save(`RVP Commitments - ${new Date().toISOString().slice(0, 10)}.pdf`);
}
