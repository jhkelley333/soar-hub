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

export const LOCKED_FIELD_KEYS = new Set([
  "payPeriodEnd",
  "driveIn",
  "employeeName",
  "last4SSN",
  "category",
  "explanation",
  "regPayRate",
  "regHours",
  "otHours",
  "ccTips",
  "declaredTips",
  "ptoHours",
  "illnessHours",
  "finalCheckHrs",
  "spotBonusAmt",
]);

export const COST_FIELD_KEYS = new Set([
  "regPayRate",
  "regHours",
  "otHours",
  "ccTips",
  "declaredTips",
  "ptoHours",
  "illnessHours",
  "finalCheckHrs",
  "spotBonusAmt",
]);

export const EMAIL_TEMPLATE_KEYS = [
  "PAF_SUBMITTED",
  "PAF_REJECTED",
  "NEEDS_APPROVAL",
  "PAF_PROCESSED",
  "APPROVAL_CONFIRMED",
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
};

export const LIST_LABELS: Record<string, string> = {
  categories: "Categories",
  positions: "Job Positions",
  bonusTypes: "Bonus Types",
  statuses: "Statuses",
  termTypes: "Termination Types",
};
