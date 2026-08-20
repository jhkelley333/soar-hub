// Report 2B — "training credits used, prior week". Grand total + by-store
// detail (grouped RVP -> DO -> store) of training credit requests APPROVED in
// the prior full week. send_when_empty: false (no credits used → no email).
//
// "Used" = the credit was granted: approved_at falls in the week and the request
// isn't Rejected/Withdrawn. Anchoring on approved_at (not the training date)
// makes it a clean "what we committed last week" spend report.

import { resolveOrg } from "../../kpiOrg.js";
import { priorWeek } from "../dates.js";

const DEAD = new Set(["Rejected", "Withdrawn"]);
const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function weeklyTrainingCredits({ supa, definition, now }) {
  const { weekStart, weekEnd, weekEndExclusive } = priorWeek(now, definition.timezone || "America/Chicago");

  const { data: reqs } = await supa
    .from("training_credit_requests")
    .select("store_number, employee_name, training_type, training_other, requested_amount, status, approved_at, last_day_date")
    .not("approved_at", "is", null)
    .gte("approved_at", weekStart)
    .lt("approved_at", weekEndExclusive);

  const used = (reqs || []).filter((r) => !DEAD.has(r.status) && Number(r.requested_amount) > 0);
  const weekLabel = `${weekStart} to ${weekEnd}`;

  if (!used.length) {
    return {
      rowCount: 0,
      subject: `Training credits used — none (week of ${weekStart})`,
      text: `No training credits were approved in the week of ${weekLabel}.`,
      summary: { week_start: weekStart, week_end: weekEnd, total: 0, count: 0 },
    };
  }

  const stores = [...new Set(used.map((r) => String(r.store_number)))];
  const org = await resolveOrg(supa, stores);
  const grand = used.reduce((a, r) => a + (Number(r.requested_amount) || 0), 0);

  // Group RVP -> DO -> store; each store lists its approved requests.
  const tree = new Map();
  for (const r of used) {
    const sn = String(r.store_number);
    const o = org.get(sn) || {};
    const rvp = o.rvpName || "Unassigned RVP";
    const doName = o.doName || "Unassigned DO";
    if (!tree.has(rvp)) tree.set(rvp, new Map());
    const dos = tree.get(rvp);
    if (!dos.has(doName)) dos.set(doName, new Map());
    const storesMap = dos.get(doName);
    if (!storesMap.has(sn)) storesMap.set(sn, { name: o.store || `#${sn}`, items: [] });
    storesMap.get(sn).items.push(r);
  }

  const lines = [];
  lines.push(`Training credits used — week of ${weekLabel}`);
  lines.push(`${money(grand)} across ${used.length} request${used.length === 1 ? "" : "s"} · ${stores.length} store${stores.length === 1 ? "" : "s"}`);
  lines.push("");
  for (const [rvp, dos] of [...tree].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rvpTotal = [...dos.values()].reduce((a, sm) => a + [...sm.values()].reduce((b, s) => b + s.items.reduce((c, r) => c + Number(r.requested_amount || 0), 0), 0), 0);
    lines.push(`${rvp} — ${money(rvpTotal)}`);
    for (const [doName, storesMap] of [...dos].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  DO ${doName}`);
      for (const [sn, s] of [...storesMap].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const stTotal = s.items.reduce((a, r) => a + Number(r.requested_amount || 0), 0);
        lines.push(`    #${sn} ${s.name} — ${money(stTotal)}`);
        for (const r of s.items.sort((a, b) => a.employee_name.localeCompare(b.employee_name))) {
          const type = r.training_type === "Other" && r.training_other ? r.training_other : r.training_type;
          lines.push(`      ${r.employee_name}: ${type} — ${money(Number(r.requested_amount))}`);
        }
      }
    }
    lines.push("");
  }

  return {
    rowCount: used.length,
    subject: `Training credits used — ${money(grand)} (week of ${weekStart})`,
    text: lines.join("\n"),
    summary: { week_start: weekStart, week_end: weekEnd, total: Math.round(grand * 100) / 100, count: used.length, stores: stores.length },
  };
}
