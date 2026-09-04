// Daily Close-Time Watch report. Compares each store's last clock-out against
// its scheduled Hours-of-Operation close (shared _lib/closeTime.js) for the most
// recent captured business day, and emails:
//   - each RVP their own region's early closes (only when there are any), and
//   - the definition's added addresses the full org-wide list (every day).
// Per-recipient fan-out, so the dispatcher sends each their own view.

import { evaluateCloseDay, GRACE_MIN } from "../../closeTime.js";
import { resolveRecipients } from "../core.js";

const SITE_URL = (process.env.SITE_URL || "https://mysoarhub.com").replace(/\/$/, "");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function namesMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const fl = (t) => (t.length >= 2 ? `${t[0]} ${t[t.length - 1]}` : t[0]);
  return fl(na.split(" ")) === fl(nb.split(" "));
}
const to12 = (t) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; return `${(h % 12) || 12}:${String(m).padStart(2, "0")}${ap}`; };
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// Group a set of flagged rows by RVP → DO into text lines.
function digestLines(rows) {
  const byRvp = new Map();
  for (const r of rows) {
    const k = r.rvpName || "Unassigned region";
    if (!byRvp.has(k)) byRvp.set(k, []);
    byRvp.get(k).push(r);
  }
  const out = [];
  for (const [rvp, list] of [...byRvp.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`${rvp} — ${list.length} early close${list.length === 1 ? "" : "s"}`);
    for (const r of list.sort((a, b) => a.delta - b.delta)) {
      out.push(`  • #${r.store_number} ${r.name} — out ${to12(r.out)} vs close ${to12(r.close)} (${r.delta} min)${r.doName ? ` · DO ${r.doName}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export async function closeTimeWatchDaily({ supa, definition }) {
  // Anchor on the most recent captured business day.
  const { data: last } = await supa.from("labor_v2_daily").select("business_date").order("business_date", { ascending: false }).limit(1);
  const businessDate = last?.[0]?.business_date;
  if (!businessDate) {
    return { rowCount: 0, subject: "Close-Time Watch — no data", text: "No labor has been captured yet.", summary: { flagged: 0 } };
  }

  const { rows, evaluated } = await evaluateCloseDay(supa, businessDate);
  const flagged = rows.filter((r) => r.status === "flag");
  const url = `${SITE_URL}/admin/close-time-watch`;
  const dateLabel = fmtDate(businessDate);

  const perRecipient = [];

  // Each RVP → their region's early closes (only when they have some).
  const { data: rvps } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("role", "rvp").eq("is_active", true);
  for (const rvp of rvps || []) {
    if (!rvp.email) continue;
    const name = rvp.preferred_name || rvp.full_name || rvp.email;
    const mine = flagged.filter((f) => namesMatch(f.rvpName, name) || namesMatch(f.rvpName, rvp.full_name));
    if (!mine.length) continue;
    const text =
      `Hi ${name},\n\n` +
      `${mine.length} store${mine.length === 1 ? "" : "s"} in your region clocked out before scheduled close on ${dateLabel}:\n\n` +
      `${digestLines(mine)}\n\n` +
      `A store is flagged when its last clock-out was more than ${GRACE_MIN} minutes before its scheduled Hours-of-Operation close.\n` +
      `See the full board (daily / weekly / monthly): ${url}`;
    perRecipient.push({ to: [rvp.email], subject: `Close-Time Watch — ${mine.length} early close${mine.length === 1 ? "" : "s"} in your region (${dateLabel})`, text });
  }

  // Added addresses → org-wide list, every day (all-clear included).
  const extra = await resolveRecipients(supa, definition.recipients);
  if (extra.length) {
    const text = flagged.length
      ? `Close-Time Watch — ${dateLabel}\n\n` +
        `${flagged.length} of ${evaluated} evaluated store${evaluated === 1 ? "" : "s"} clocked out before scheduled close:\n\n` +
        `${digestLines(flagged)}\n\n` +
        `Flagged = last clock-out more than ${GRACE_MIN} minutes before the scheduled close.\n` +
        `Full board: ${url}`
      : `Close-Time Watch — ${dateLabel}\n\n` +
        `✓ All clear — no early closes across ${evaluated} evaluated store${evaluated === 1 ? "" : "s"}.\n\n` +
        `Full board: ${url}`;
    perRecipient.push({ to: extra, subject: `Close-Time Watch — ${flagged.length} early close${flagged.length === 1 ? "" : "s"} (${dateLabel})`, text });
  }

  return {
    rowCount: flagged.length,
    perRecipient,
    summary: { business_date: businessDate, evaluated, flagged: flagged.length, rvp_emails: perRecipient.length - (extra.length ? 1 : 0), added_addresses: extra.length },
  };
}
