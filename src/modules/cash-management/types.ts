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
  carried_in_cents: number;
  cash_due_cents: number;
  deposit_cents: number;
  variance_cents: number;
  carried_out_cents: number;
  deposit_verified: boolean;
  status: string;
}

export interface DepositDetail {
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
  current_carry_cents: number;
  total_deposited_cents: number;
  flagged_days: number;
  clean_days: number;
  days: number;
  ledger: DsrRow[];
}
