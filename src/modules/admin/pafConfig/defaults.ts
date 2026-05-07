// Static reference data the admin UI needs in addition to whatever the
// active config holds — these are properties of the *form code*, not the
// admin-editable config:
//   * which fields are locked (matches the jsonb seed in 0015)
//   * which fields ride along with cost calculation
//   * the list of email-template variable names per template, for the
//     "available variables" sidebar in the templates editor
//
// Kept here in the frontend because (a) bundlers strip unused exports,
// (b) the UI is the only place that needs them, and (c) a backend round-
// trip just to get this constant data would be wasteful.

// Snake_case keys (post-0017 / B-2b). The set covers every field the
// form code special-cases or requires in cost calc.
export const LOCKED_FIELD_KEYS = new Set([
  "pay_period_end",
  "drive_in",
  "employee_name",
  "last4_ssn",
  "category",
  "pay_basis",
  "reg_pay_rate",
  "reg_hours",
  "ot_hours",
  "cc_tips",
  "declared_tips",
  "pto_hours",
  "illness_hours",
  "spot_bonus_amt",
  "training_bonus_amt",
  "referral_bonus_amt",
  "bonus_type",
  "explanation",
]);

export const COST_FIELD_KEYS = new Set([
  "reg_pay_rate",
  "reg_hours",
  "ot_hours",
  "cc_tips",
  "declared_tips",
  "pto_hours",
  "illness_hours",
  "spot_bonus_amt",
  "training_bonus_amt",
  "referral_bonus_amt",
]);

export const EMAIL_TEMPLATE_KEYS = [
  "PAF_SUBMITTED",
  "PAF_REJECTED",
  "NEEDS_APPROVAL",
  "PAF_PROCESSED",
  "APPROVAL_CONFIRMED",
  "BONUS_SDO_APPROVAL_REQUEST",
  "BONUS_SDO_APPROVED",
  "BONUS_SDO_REJECTED",
] as const;

export const TEMPLATE_VARIABLES: Record<
  (typeof EMAIL_TEMPLATE_KEYS)[number],
  string[]
> = {
  PAF_SUBMITTED: ["EMPLOYEE", "STORE", "DO", "CATEGORY", "AMOUNT", "LINK"],
  PAF_REJECTED: ["EMPLOYEE", "STORE", "REASON", "LINK"],
  NEEDS_APPROVAL: ["EMPLOYEE", "STORE", "NOTES", "LINK"],
  PAF_PROCESSED: ["EMPLOYEE", "STORE", "AMOUNT", "LINK"],
  APPROVAL_CONFIRMED: ["EMPLOYEE", "STORE", "LINK"],
  BONUS_SDO_APPROVAL_REQUEST: ["EMPLOYEE", "STORE", "BONUS_TYPE", "AMOUNT", "DO", "LINK"],
  BONUS_SDO_APPROVED: ["EMPLOYEE", "STORE", "APPROVER", "LINK"],
  BONUS_SDO_REJECTED: ["EMPLOYEE", "STORE", "APPROVER", "REASON", "LINK"],
};

export const LIST_LABELS: Record<string, string> = {
  categories: "Categories",
  positions: "Job Positions",
  bonusTypes: "Bonus Types",
  payBases: "Pay Bases",
  statuses: "Statuses",
  referralTiers: "Referral Tiers",
  termTypes: "Termination Types",
};
