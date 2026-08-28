// Report — "business disruptions, prior week". Grouped RVP -> DO -> store list
// of every disruption whose disruption_date falls in the prior full week, with
// the headline totals from the Business Disruptions dashboard: report count,
// stores still closed, and estimated lost sales. Anchors on disruption_date
// (when it happened), so it's a clean "what hit us last week" digest.

import { resolveOrg } from "../../kpiOrg.js";
import { priorWeek } from "../dates.js";

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => Number(n) || 0;
// Still closed = the store closed and has no reopen date recorded yet.
const stillClosed = (d) => d.store_closed === true && !d.reopen_date;
// Human list of what went wrong: closure types + issue types, de-duped.
const kinds = (d) => {
  const all = [...(d.closure_types || []), ...(d.issue_types || [])].map((s) => String(s).trim()).filter(Boolean);
  return [...new Set(all)].join(", ");
};

// CSV cell escaping — wrap in quotes and double any embedded quotes when the
// value carries a comma, quote, or newline (Excel-safe).
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

export async function weeklyBusinessDisruptions({ supa, definition, now }) {
  const { weekStart, weekEnd, weekEndExclusive } = priorWeek(now, definition.timezone || "America/Chicago");
  const weekLabel = `${weekStart} to ${weekEnd}`;

  const { data: rows } = await supa
    .from("business_disruptions")
    .select("store_number, disruption_date, status, store_closed, reopen_date, order_ahead_disabled, closure_types, issue_types, estimated_loss_sales, description, submitted_by_name")
    .gte("disruption_date", weekStart)
    .lt("disruption_date", weekEndExclusive)
    .order("disruption_date", { ascending: true });

  const list = rows || [];
  const totalLoss = list.reduce((a, d) => a + num(d.estimated_loss_sales), 0);
  const closedCount = list.filter(stillClosed).length;
  const openCount = list.filter((d) => d.status === "open").length;

  if (!list.length) {
    return {
      rowCount: 0,
      subject: `Business disruptions — none (week of ${weekStart})`,
      text: `No business disruptions were reported for the week of ${weekLabel}.`,
      summary: { week_start: weekStart, week_end: weekEnd, count: 0, still_closed: 0, est_loss_sales: 0 },
    };
  }

  const stores = [...new Set(list.map((d) => String(d.store_number)))];
  const org = await resolveOrg(supa, stores);

  // Group RVP -> DO -> store; each store lists its disruptions.
  const tree = new Map();
  for (const d of list) {
    const sn = String(d.store_number);
    const o = org.get(sn) || {};
    const rvp = o.rvpName || "Unassigned RVP";
    const doName = o.doName || "Unassigned DO";
    if (!tree.has(rvp)) tree.set(rvp, new Map());
    const dos = tree.get(rvp);
    if (!dos.has(doName)) dos.set(doName, new Map());
    const storesMap = dos.get(doName);
    if (!storesMap.has(sn)) storesMap.set(sn, { name: o.store || `#${sn}`, items: [] });
    storesMap.get(sn).items.push(d);
  }

  // Per-RVP loss, for the summary body (the detail now rides in the CSV).
  const rvpTotals = [...tree].map(([rvp, dos]) => {
    const loss = [...dos.values()].reduce((a, sm) => a + [...sm.values()].reduce((b, s) => b + s.items.reduce((c, d) => c + num(d.estimated_loss_sales), 0), 0), 0);
    return [rvp, loss];
  }).sort((a, b) => b[1] - a[1]);

  // Build the detail CSV — one row per disruption, RVP → DO → store context
  // flattened so it opens clean in Excel. Sorted RVP, DO, store, date.
  const header = ["RVP", "DO", "Store #", "Store", "Date", "Kinds", "Est. lost sales", "Status", "Still closed", "Reopen date", "Order-ahead off", "Submitted by", "Description"];
  const csvRows = list.map((d) => {
    const sn = String(d.store_number);
    const o = org.get(sn) || {};
    return {
      rvp: o.rvpName || "Unassigned RVP",
      do: o.doName || "Unassigned DO",
      sn, name: o.store || `#${sn}`,
      d,
    };
  }).sort((a, b) =>
    a.rvp.localeCompare(b.rvp) || a.do.localeCompare(b.do) ||
    a.name.localeCompare(b.name) || String(a.d.disruption_date).localeCompare(String(b.d.disruption_date)),
  ).map(({ rvp, do: doName, sn, name, d }) => csvRow([
    rvp, doName, sn, name,
    String(d.disruption_date || "").slice(0, 10),
    kinds(d),
    num(d.estimated_loss_sales).toFixed(2),
    d.status || "",
    stillClosed(d) ? "yes" : "no",
    d.reopen_date ? String(d.reopen_date).slice(0, 10) : "",
    d.order_ahead_disabled ? "yes" : "no",
    d.submitted_by_name || "",
    d.description || "",
  ]));
  const csv = [csvRow(header), ...csvRows].join("\r\n");
  const filename = `business-disruptions_${weekStart}_to_${weekEnd}.csv`;

  // Concise summary body — the full per-store detail is the attached CSV.
  const bodyLines = [
    `Business disruptions — week of ${weekLabel}`,
    `${list.length} report${list.length === 1 ? "" : "s"} · ${stores.length} store${stores.length === 1 ? "" : "s"} · ${money(totalLoss)} est. lost sales`,
    `${openCount} still open · ${closedCount} still closed`,
    "",
    "Est. lost sales by RVP:",
    ...rvpTotals.map(([rvp, loss]) => `  ${rvp} — ${money(loss)}`),
    "",
    `Full detail is attached as ${filename} (one row per disruption).`,
    "Open it in Excel or Google Sheets to sort/filter by RVP, DO, store, or type.",
  ];

  return {
    rowCount: list.length,
    subject: `Business disruptions — ${list.length} report${list.length === 1 ? "" : "s"}, ${money(totalLoss)} lost (week of ${weekStart})`,
    text: bodyLines.join("\n"),
    attachments: [{ filename, content: Buffer.from(csv, "utf8").toString("base64") }],
    summary: {
      week_start: weekStart, week_end: weekEnd,
      count: list.length, stores: stores.length, still_open: openCount, still_closed: closedCount,
      est_loss_sales: Math.round(totalLoss * 100) / 100, csv: true,
    },
  };
}
