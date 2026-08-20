// Report 2A — Monday "stores using the no-GM credit" digest. Prior full week
// (Mon-Sun), grouped RVP -> DO -> store. send_when_empty: true (zero stores on
// a no-GM credit is good news worth sending).

import { resolveOrg } from "../../kpiOrg.js";
import { priorWeek } from "../dates.js";

const REASON_LABEL = { loa: "LOA", no_gm: "No GM", in_training: "In Training" };
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function mondayNoGmCredit({ supa, definition, now }) {
  const { weekStart, weekEnd } = priorWeek(now, definition.timezone || "America/Chicago");

  // Records active any day within the week: started on/before the week end AND
  // (still open OR ended on/after the week start).
  const { data: creds } = await supa
    .from("no_gm_credits")
    .select("store_number, reason, start_date, end_date, note")
    .lte("start_date", weekEnd)
    .or(`end_date.is.null,end_date.gte.${weekStart}`);

  const byStore = new Map();
  for (const c of creds || []) {
    const sn = String(c.store_number);
    // Keep the earliest-started record per store for the digest line.
    if (!byStore.has(sn) || c.start_date < byStore.get(sn).start_date) byStore.set(sn, c);
  }
  const stores = [...byStore.keys()];
  const weekLabel = `${weekStart} to ${weekEnd}`;

  if (!stores.length) {
    return {
      rowCount: 0,
      subject: `No-GM credit — none last week (${weekStart})`,
      text: `Good news: no stores were on a no-GM labor credit for the week of ${weekLabel}.`,
      summary: { week_start: weekStart, week_end: weekEnd, stores: 0 },
    };
  }

  // Weekly credit rate for context (ea_settings, default 880).
  let weeklyRate = 880;
  try {
    const { data: rate } = await supa.from("ea_settings").select("value").eq("key", "no_gm_weekly_credit").maybeSingle();
    if (rate?.value?.amount != null) weeklyRate = Number(rate.value.amount) || weeklyRate;
  } catch { /* default */ }

  const org = await resolveOrg(supa, stores);

  // Group RVP -> DO -> stores.
  const tree = new Map();
  for (const sn of stores) {
    const o = org.get(sn) || {};
    const rvp = o.rvpName || "Unassigned RVP";
    const doName = o.doName || "Unassigned DO";
    if (!tree.has(rvp)) tree.set(rvp, new Map());
    const dos = tree.get(rvp);
    if (!dos.has(doName)) dos.set(doName, []);
    dos.get(doName).push({ sn, name: o.store || `#${sn}`, cred: byStore.get(sn) });
  }

  const lines = [];
  lines.push(`Stores on a no-GM labor credit — week of ${weekLabel}`);
  lines.push(`${stores.length} store${stores.length === 1 ? "" : "s"} · weekly credit ${money(weeklyRate)}/store · est. ${money(stores.length * weeklyRate)} total`);
  lines.push("");
  for (const [rvp, dos] of [...tree].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${rvp}`);
    for (const [doName, list] of [...dos].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  DO ${doName}`);
      for (const s of list.sort((a, b) => a.name.localeCompare(b.name))) {
        const reason = REASON_LABEL[s.cred.reason] || s.cred.reason;
        lines.push(`    #${s.sn} ${s.name} — ${reason} (since ${s.cred.start_date}${s.cred.end_date ? `, ended ${s.cred.end_date}` : ""})`);
      }
    }
    lines.push("");
  }

  return {
    rowCount: stores.length,
    subject: `No-GM credit — ${stores.length} store${stores.length === 1 ? "" : "s"} (week of ${weekStart})`,
    text: lines.join("\n"),
    summary: { week_start: weekStart, week_end: weekEnd, stores: stores.length, weekly_rate: weeklyRate },
  };
}
