// CSV export for the PAF queue + history. Quotes string fields and
// strips line breaks so the output opens cleanly in Excel / Google
// Sheets / ADP imports.

import type { PafRow } from "./types";

interface Column {
  header: string;
  get: (row: PafRow) => string | number | null;
}

const COLUMNS: Column[] = [
  { header: "Submitted", get: (r) => r.created_at.slice(0, 10) },
  { header: "Pay Period End", get: (r) => r.pay_period_end },
  { header: "Status", get: (r) => r.status },
  { header: "Store", get: (r) => r.drive_in },
  { header: "Employee", get: (r) => r.employee_name },
  { header: "Last 4 SSN", get: (r) => r.last4_ssn },
  { header: "Category", get: (r) => r.category },
  { header: "Bonus Type", get: (r) => r.bonus_type ?? "" },
  { header: "Pay Basis", get: (r) => r.pay_basis ?? "" },
  { header: "Reg Pay Rate", get: (r) => Number(r.reg_pay_rate) || 0 },
  { header: "Reg Hours", get: (r) => Number(r.reg_hours) || 0 },
  { header: "OT Hours", get: (r) => Number(r.ot_hours) || 0 },
  { header: "CC Tips", get: (r) => Number(r.cc_tips) || 0 },
  { header: "Declared Tips", get: (r) => Number(r.declared_tips) || 0 },
  { header: "PTO Hours", get: (r) => Number(r.pto_hours) || 0 },
  { header: "Illness Hours", get: (r) => Number(r.illness_hours) || 0 },
  { header: "Spot Bonus", get: (r) => Number(r.spot_bonus_amt) || 0 },
  {
    header: "Training Bonus",
    get: (r) => (r.training_bonus_amt == null ? "" : Number(r.training_bonus_amt)),
  },
  {
    header: "Referral Bonus",
    get: (r) => (r.referral_bonus_amt == null ? "" : Number(r.referral_bonus_amt)),
  },
  { header: "Estimated Cost", get: (r) => Number(r.estimated_cost) || 0 },
  { header: "Submitter", get: (r) => r.submitter_email },
  {
    header: "Approved By",
    get: (r) => r.approved_by_email ?? "",
  },
  {
    header: "Processed At",
    get: (r) =>
      r.payroll_processed_at ? r.payroll_processed_at.slice(0, 10) : "",
  },
  {
    header: "Rejection Reason",
    get: (r) => r.rejection_reason ?? "",
  },
];

function escape(field: string | number | null): string {
  if (field === null || field === undefined) return "";
  const s = String(field).replace(/[\r\n]+/g, " ").trim();
  // Quote if it contains comma, double-quote, or starts with =/+/-/@
  // (CSV-injection safety for spreadsheets that auto-evaluate formulas).
  if (/[",]/.test(s) || /^[=+\-@]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildPafsCsv(rows: PafRow[]): string {
  const lines = [COLUMNS.map((c) => escape(c.header)).join(",")];
  for (const r of rows) {
    lines.push(COLUMNS.map((c) => escape(c.get(r))).join(","));
  }
  return lines.join("\n");
}

export function downloadPafsCsv(rows: PafRow[], filenameStem: string): void {
  const csv = buildPafsCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
