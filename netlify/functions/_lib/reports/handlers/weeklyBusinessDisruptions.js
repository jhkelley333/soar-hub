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
const fmtDay = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
// Human list of what went wrong: closure types + issue types, de-duped.
const kinds = (d) => {
  const all = [...(d.closure_types || []), ...(d.issue_types || [])].map((s) => String(s).trim()).filter(Boolean);
  return [...new Set(all)].join(", ");
};

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

  const lines = [];
  lines.push(`Business disruptions — week of ${weekLabel}`);
  lines.push(`${list.length} report${list.length === 1 ? "" : "s"} · ${stores.length} store${stores.length === 1 ? "" : "s"} · ${money(totalLoss)} est. lost sales`);
  lines.push(`${openCount} still open · ${closedCount} still closed`);
  lines.push("");

  for (const [rvp, dos] of [...tree].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rvpLoss = [...dos.values()].reduce((a, sm) => a + [...sm.values()].reduce((b, s) => b + s.items.reduce((c, d) => c + num(d.estimated_loss_sales), 0), 0), 0);
    lines.push(`${rvp} — ${money(rvpLoss)}`);
    for (const [doName, storesMap] of [...dos].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  DO ${doName}`);
      for (const [sn, s] of [...storesMap].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const stLoss = s.items.reduce((a, d) => a + num(d.estimated_loss_sales), 0);
        lines.push(`    #${sn} ${s.name} — ${money(stLoss)}`);
        for (const d of s.items) {
          const flags = [];
          if (stillClosed(d)) flags.push("STILL CLOSED");
          else if (d.reopen_date) flags.push(`reopened ${fmtDay(d.reopen_date)}`);
          if (d.order_ahead_disabled) flags.push("order-ahead off");
          const kind = kinds(d);
          const bits = [fmtDay(d.disruption_date), kind || "—", money(num(d.estimated_loss_sales)) + " lost"];
          if (flags.length) bits.push(flags.join(", "));
          lines.push(`      ${bits.join(" · ")}`);
        }
      }
    }
    lines.push("");
  }

  return {
    rowCount: list.length,
    subject: `Business disruptions — ${list.length} report${list.length === 1 ? "" : "s"}, ${money(totalLoss)} lost (week of ${weekStart})`,
    text: lines.join("\n"),
    summary: {
      week_start: weekStart, week_end: weekEnd,
      count: list.length, stores: stores.length, still_open: openCount, still_closed: closedCount,
      est_loss_sales: Math.round(totalLoss * 100) / 100,
    },
  };
}
