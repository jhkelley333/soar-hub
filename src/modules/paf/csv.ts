// CSV export for the PAF queue + history. Quotes string fields and
// strips line breaks so the output opens cleanly in Excel / Google
// Sheets / ADP imports.

import type { PafRow } from "./types";
import { missingAttachment, retainUntil } from "./retention";

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
  downloadCsv(buildPafsCsv(rows), filenameStem);
}

// ── Full archive export ────────────────────────────────────────────────────
// A complete per-record dump for Payroll's archive: every field that matters
// for an audit trail, including the attachment indicator, the full approval /
// processing chain, and archived state. This is the "export the database"
// deliverable — wider than the operational queue CSV above.
const ARCHIVE_COLUMNS: Column[] = [
  { header: "PAF ID", get: (r) => r.id },
  { header: "Submitted", get: (r) => r.created_at.slice(0, 10) },
  { header: "Submitted At", get: (r) => r.created_at },
  { header: "Pay Period End", get: (r) => r.pay_period_end },
  { header: "Process Week", get: (r) => r.process_week ?? "" },
  { header: "Late For Week", get: (r) => (r.late_for_week ? "Yes" : "") },
  { header: "Status", get: (r) => r.status },
  { header: "Store #", get: (r) => r.drive_in ?? r.nh_home_store ?? "" },
  { header: "Store Name", get: (r) => r.store_name ?? "" },
  { header: "Market / DO", get: (r) => r.market_do ?? "" },
  { header: "Employee", get: (r) => r.employee_name },
  { header: "Last 4 SSN", get: (r) => r.last4_ssn },
  { header: "Category", get: (r) => r.category },
  { header: "Bonus Type", get: (r) => r.bonus_type ?? "" },
  { header: "Pay Basis", get: (r) => r.pay_basis ?? "" },
  { header: "Job Position", get: (r) => r.job_position ?? "" },
  { header: "Approving Mgr", get: (r) => r.approving_mgr ?? "" },
  { header: "Reg Pay Rate", get: (r) => Number(r.reg_pay_rate) || 0 },
  { header: "Reg Hours", get: (r) => Number(r.reg_hours) || 0 },
  { header: "OT Hours", get: (r) => Number(r.ot_hours) || 0 },
  { header: "CC Tips", get: (r) => Number(r.cc_tips) || 0 },
  { header: "Declared Tips", get: (r) => Number(r.declared_tips) || 0 },
  { header: "PTO Hours", get: (r) => Number(r.pto_hours) || 0 },
  { header: "Illness Hours", get: (r) => Number(r.illness_hours) || 0 },
  { header: "Final Check Hrs", get: (r) => Number(r.final_check_hrs) || 0 },
  { header: "Spot Bonus", get: (r) => Number(r.spot_bonus_amt) || 0 },
  { header: "Training Bonus", get: (r) => (r.training_bonus_amt == null ? "" : Number(r.training_bonus_amt)) },
  { header: "Referral Bonus", get: (r) => (r.referral_bonus_amt == null ? "" : Number(r.referral_bonus_amt)) },
  { header: "Estimated Cost", get: (r) => Number(r.estimated_cost) || 0 },
  { header: "Explanation", get: (r) => r.explanation ?? "" },
  { header: "Notes", get: (r) => r.notes ?? "" },
  { header: "Has Attachment", get: (r) => (r.nh_offer_letter_path ? "Yes" : "") },
  { header: "Missing Required Attachment", get: (r) => (missingAttachment(r) ? "Yes" : "") },
  { header: "Attachment (Offer Letter)", get: (r) => r.nh_offer_letter_path ?? "" },
  { header: "Submitter", get: (r) => r.submitter_email },
  { header: "Submitter Name", get: (r) => r.submitter_name ?? "" },
  { header: "Resubmitted By", get: (r) => r.resubmitted_by_email ?? "" },
  { header: "Approved By", get: (r) => r.approved_by_email ?? "" },
  { header: "Approved At", get: (r) => (r.approved_at ? r.approved_at.slice(0, 10) : "") },
  { header: "Processed By", get: (r) => r.payroll_processed_by ?? "" },
  { header: "Processed At", get: (r) => (r.payroll_processed_at ? r.payroll_processed_at.slice(0, 10) : "") },
  { header: "Rejection Reason", get: (r) => r.rejection_reason ?? "" },
  { header: "Archived", get: (r) => (r.archived ? "Yes" : "") },
  { header: "Archived At", get: (r) => (r.archived_at ? r.archived_at.slice(0, 10) : "") },
  { header: "Retain Until (7 yr)", get: (r) => retainUntil(r.created_at) },
];

export function buildPafArchiveCsv(rows: PafRow[]): string {
  const lines = [ARCHIVE_COLUMNS.map((c) => escape(c.header)).join(",")];
  for (const r of rows) {
    lines.push(ARCHIVE_COLUMNS.map((c) => escape(c.get(r))).join(","));
  }
  return lines.join("\n");
}

export function downloadPafArchiveCsv(rows: PafRow[], filenameStem = "paf-archive"): void {
  downloadCsv(buildPafArchiveCsv(rows), filenameStem);
}

function downloadCsv(csv: string, filenameStem: string): void {
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
