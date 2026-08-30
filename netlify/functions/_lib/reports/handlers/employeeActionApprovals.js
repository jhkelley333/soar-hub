// Report — "Employee Action approvals waiting" (daily reminder). Finds PTO and
// Training Credit requests still awaiting a decision and emails each responsible
// approver a digest of the items in THEIR queue, with how-to-approve steps.
// Runs daily; an item drops off as soon as it's approved, so the nudge repeats
// until it's actioned. Uses the report engine's per-recipient fan-out.
//
// Approver by pending step (mirrors employee-actions.js):
//   Training Credit 'Submitted'     -> DO (within bank) / RVP (over bank)
//   PTO 'Submitted'                 -> DO
//   PTO 'DO Approved'               -> SDO / RVP

import { resolveStoreLeadership } from "../../eaApprovers.js";

const SITE_URL = (process.env.SITE_URL || "https://mysoarhub.com").replace(/\/$/, "");
const day = (v) => (v ? String(v).slice(0, 10) : "");
const money = (v) => (v == null || v === "" ? "" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function approversFor(kind, status, lead) {
  if (kind === "training") return [...lead.dos, ...lead.rvps];
  if (kind === "pto") {
    if (status === "Submitted") return lead.dos;
    if (status === "DO Approved") return [...lead.sdos, ...lead.rvps];
  }
  return [];
}

function describe(it) {
  const store = `store #${it.store_number}`;
  const submitted = day(it.created_at);
  if (it.kind === "training") {
    const amt = money(it.requested_amount);
    return `Training Credit — ${it.employee_name} @ ${store}${amt ? ` · ${amt}` : ""} · submitted ${submitted}`;
  }
  const range = it.start_date ? ` · ${day(it.start_date)}${it.end_date ? `–${day(it.end_date)}` : ""}` : "";
  const step = it.status === "DO Approved" ? " · DO-approved, needs SDO/RVP" : " · needs DO";
  return `PTO — ${it.employee_name} @ ${store}${range} · submitted ${submitted}${step}`;
}

export async function employeeActionApprovals({ supa }) {
  const [{ data: tc }, { data: pto }] = await Promise.all([
    supa.from("training_credit_requests").select("*").eq("status", "Submitted"),
    supa.from("pto_requests").select("*").in("status", ["Submitted", "DO Approved"]),
  ]);
  const items = [
    ...(tc || []).map((r) => ({ kind: "training", ...r })),
    ...(pto || []).map((r) => ({ kind: "pto", ...r })),
  ];
  if (!items.length) {
    return { rowCount: 0, subject: "Employee Action approvals — none pending", text: "No PTO or Training Credit requests are awaiting approval.", summary: { pending: 0, recipients: 0 } };
  }

  // Resolve the responsible leaders per store (cached), group items by approver.
  const leadCache = new Map();
  const getLead = async (sn) => {
    if (!leadCache.has(sn)) leadCache.set(sn, await resolveStoreLeadership(supa, sn));
    return leadCache.get(sn);
  };
  const byApprover = new Map(); // email -> { name, items: [] }
  let unassigned = 0;
  for (const it of items) {
    const lead = await getLead(String(it.store_number));
    const approvers = approversFor(it.kind, it.status, lead);
    if (!approvers.length) { unassigned += 1; continue; }
    for (const a of approvers) {
      if (!a?.email) continue;
      const key = a.email.toLowerCase();
      if (!byApprover.has(key)) byApprover.set(key, { name: a.preferred_name || a.full_name || a.email, items: [] });
      byApprover.get(key).items.push(it);
    }
  }
  if (!byApprover.size) {
    return { rowCount: 0, subject: "Employee Action approvals — no approver resolved", text: `${items.length} pending, but no in-scope approver resolved (${unassigned} unassigned).`, summary: { pending: items.length, recipients: 0, unassigned } };
  }

  const url = `${SITE_URL}/employee-actions?tab=approvals`;
  const howTo = [
    "How to approve:",
    `  1. Open SOAR Hub → Employee Actions → the Approvals tab:`,
    `     ${url}`,
    "  2. Find the request, review the details, and click Approve (or Request Changes).",
    "  PTO needs a DO approval first, then an SDO/RVP; Training Credits approve in one step.",
  ].join("\n");

  const perRecipient = [...byApprover.entries()]
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .map(([email, { name, items: mine }]) => {
      const lines = mine
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((it) => `  • ${describe(it)}`);
      const n = mine.length;
      const text =
        `Hi ${name},\n\n` +
        `${n} employee-action ${n === 1 ? "request is" : "requests are"} waiting for your approval:\n\n` +
        `${lines.join("\n")}\n\n` +
        `${howTo}\n\n` +
        `You'll keep getting this daily reminder until each is approved.`;
      return { to: [email], subject: `Action needed: ${n} approval${n === 1 ? "" : "s"} waiting in SOAR Hub`, text };
    });

  return {
    rowCount: perRecipient.length,
    perRecipient,
    summary: { pending: items.length, recipients: perRecipient.length, unassigned },
  };
}
