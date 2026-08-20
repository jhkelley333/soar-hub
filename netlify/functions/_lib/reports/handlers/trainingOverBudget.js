// Report 2D — event: a training credit was APPROVED for more than the store's
// remaining yearly training bank. Fired inline from the submit/approval action
// in employee-actions.js with the context below. Recipient is role-based (COO).

const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function trainingOverBudget({ context = {} }) {
  const c = context || {};
  const text = [
    `A training credit was approved that exceeds the store's yearly training bank.`,
    ``,
    `Store:        #${c.store_number ?? "—"}`,
    `Employee:     ${c.employee_name ?? "—"}`,
    `Training:     ${c.training_type ?? "—"}`,
    `Approved by:  ${c.approved_by ?? "—"}`,
    ``,
    `Amount:            ${money(c.requested_amount)}`,
    `Bank budget (${c.year ?? "—"}):  ${money(c.budget)}`,
    `Remaining before:  ${money(c.remaining_before)}`,
    `Over by:           ${money(c.overage)}`,
  ].join("\n");
  return {
    rowCount: 1,
    subject: `Over-budget training credit approved — Store ${c.store_number ?? "?"} (+${money(c.overage)})`,
    text,
    summary: { store_number: c.store_number, amount: c.requested_amount, overage: c.overage, year: c.year },
  };
}
