// Report handler registry. Each report key maps to a handler that runs its
// query and renders the email. Adding a report (Phase 2+) = add a handler here
// + a report_definitions row — the dispatcher never changes.
//
// Handler contract:
//   async ({ supa, definition, now }) => {
//     rowCount,          // number of rows the report found (drives send_when_empty)
//     subject, text,     // rendered email (html optional)
//     html?,
//     summary?,          // small object stored on the run for the admin UI
//   }
// The dispatcher resolves the definition's recipients and sends. A handler that
// needs per-recipient resolution (e.g. "each user's own RVP") can instead return
// { perRecipient: [{ to, subject, text, html }], rowCount, summary } and the
// dispatcher fans those out individually.

import { mondayNoGmCredit } from "./handlers/mondayNoGmCredit.js";
import { weeklyTrainingCredits } from "./handlers/weeklyTrainingCredits.js";
import { trainingOverBudget } from "./handlers/trainingOverBudget.js";
import { weeklyBusinessDisruptions } from "./handlers/weeklyBusinessDisruptions.js";

// Engine smoke test — no query; confirms the render + Resend path end to end.
async function smokeTest({ definition, now }) {
  const stamp = now.toISOString();
  return {
    rowCount: 1,
    subject: "SOAR Hub — report engine smoke test",
    text:
      `This is the report engine smoke test.\n\n` +
      `Report: ${definition.name} (${definition.key})\n` +
      `Sent: ${stamp}\n\n` +
      `If you received this, scheduled render + Resend delivery are working.`,
    summary: { sent_at: stamp },
  };
}

const HANDLERS = {
  smoke_test: smokeTest,
  monday_no_gm_credit: mondayNoGmCredit,
  weekly_training_credits: weeklyTrainingCredits,
  training_over_budget: trainingOverBudget,
  weekly_business_disruptions: weeklyBusinessDisruptions,
};

export function getHandler(key) {
  return HANDLERS[key] || null;
}

export function hasHandler(key) {
  return !!HANDLERS[key];
}
