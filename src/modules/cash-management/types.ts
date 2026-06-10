// Cash Management — shared types mirroring netlify/functions/cash-management.js.

export interface CmgStore {
  id: string;
  number: string;
  name: string | null;
}

export interface CloseoutCard {
  id: string; // CO-MMDD
  closeout_id: string;
  business_date: string;
  cash_due_cents: number;
  deposit_cents: number;
  variance_cents: number;
  status: "awaiting-deposit" | "flagged" | "verified";
  flagged: boolean;
  // True when this day was backfilled after its business date (a missed close).
  is_late: boolean;
  // Who submitted it — drives the lock/unlock authority on the client.
  submitted_by?: string | null;
  submitted_by_name?: string | null;
}

export interface Overview {
  stores: CmgStore[];
  active_store_id: string | null;
  store: CmgStore | null;
  business_date: string;
  toleranceCents: number;
  closeoutToleranceCents: number;
  depositToleranceCents: number;
  can_act_alerts: boolean;
  leaders: { do_name: string | null; sdo_name: string | null };
  closeout: CloseoutCard | null;
  pending_deposit: {
    id: string;
    code: string;
    for_date: string;
    expected_cents: number;
    status: string;
  } | null;
  open_alerts: number;
  history: CloseoutCard[];
}

export interface Denom {
  id: string;
  label: string;
  cents: number;
  type: "bill" | "coin";
}

export interface CmgConfig {
  denominations: Denom[];
  toleranceCents: number;
  closeoutToleranceCents: number;
  depositToleranceCents: number;
}

export interface CashSettings {
  closeoutToleranceCents: number;
  depositToleranceCents: number;
  // 0–23 hour, Central Time. Closeouts submitted before this hour count as
  // the prior business day.
  businessDayCutoffHour: number;
  can_edit: boolean;
}

export interface PendingDeposit {
  id: string;
  code: string;
  for_date: string;
  closed_by: string;
  expected_cents: number;
  dsr_carried_over_cents: number;
  status: string;
}

export interface CmgAlert {
  id: string;
  closeout_code: string;
  store_number: string;
  variance_cents: number;
  type: "short" | "over";
  severity: "high" | "medium" | "low";
  reason: string | null;
  manager_name: string | null;
  status: "open" | "acknowledged" | "resolved";
  acked_by_name: string | null;
  notified: string[];
  created_at: string;
}

export interface AlertsResponse {
  can_act: boolean;
  counts: { open: number; acknowledged: number; resolved: number };
  alerts: CmgAlert[];
}

export interface DsrRow {
  id: string;
  closeout_id: string;
  deposit_id: string | null;
  has_slip: boolean;
  business_date: string;
  cash_due_cents: number;
  deposit_cents: number;
  variance_cents: number;
  // Open guest checks carried over from the prior-day DSR (entered at validation).
  carried_over_count: number;
  carried_over_cents: number;
  deposit_verified: boolean;
  status: string;
  is_late?: boolean;
}

// ── Leader roll-up (multi-store, DO/SDO/RVP/VP/COO/admin) ─────────────────
export type LeaderIssue = "not_closed" | "over_tolerance" | "deposit_overdue" | "open_alerts";

export interface LeaderStoreRow {
  store: CmgStore;
  closed_today: boolean;
  today_variance_cents: number | null;
  today_flagged: boolean;
  today_is_late: boolean;
  last_close_date: string | null;
  pending_deposits: number;
  oldest_pending_for_date: string | null;
  deposit_overdue_days: number;
  deposit_overdue: boolean;
  open_alerts: number;
  issues: LeaderIssue[];
}

export interface LeaderSummary {
  stores_total: number;
  closed_today: number;
  not_closed_today: number;
  over_tolerance: number;
  deposits_pending: number;
  deposits_overdue: number;
  open_alerts: number;
  needs_attention: number;
}

export interface LeaderOverview {
  business_date: string | null;
  tolerance_cents: number;
  scope_all: boolean;
  summary: LeaderSummary;
  stores: LeaderStoreRow[];
}

export interface CashAuditEntry {
  id: string;
  scope: string;
  action: string;
  detail: Record<string, unknown> | null;
  actor_name: string | null;
  created_at: string;
}

export interface DepositDetail {
  history: CashAuditEntry[];
  can_edit: boolean;
  closeout: {
    id: string;
    code: string;
    business_date: string;
    store_number: string;
    cash_due_cents: number;
    counted_cents: number;
    deposit_cents: number;
    variance_cents: number;
    denominations: Record<string, number>;
    flagged: boolean;
    reason: string | null;
    status: string;
    submitted_by_name: string | null;
    submitted_at: string;
  };
  deposit: {
    id: string;
    code: string;
    for_date: string;
    expected_cents: number;
    bank_credited_cents: number | null;
    dsr_carried_over_cents: number;
    carried_over_count: number;
    carried_fwd_cents: number;
    variance_cents: number | null;
    flagged: boolean;
    reason: string | null;
    carried_ack: boolean;
    carried_note: string | null;
    has_slip: boolean;
    status: string;
    verified_at: string | null;
  } | null;
}

export interface DsrResponse {
  store: CmgStore;
  toleranceCents: number;
  // Open-check carryover totals across the period.
  open_check_count: number;
  open_check_cents: number;
  total_deposited_cents: number;
  flagged_days: number;
  clean_days: number;
  days: number;
  ledger: DsrRow[];
}
