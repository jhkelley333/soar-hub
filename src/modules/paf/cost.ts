// Cost calculation — locked formula. Mirrors calcPafCost() in
// netlify/functions/paf.js. Used by the form for live preview; the
// server result is authoritative on submit.

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v !== "string") return 0;
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function calcPafCost(p: {
  reg_pay_rate?: unknown;
  reg_hours?: unknown;
  ot_hours?: unknown;
  cc_tips?: unknown;
  declared_tips?: unknown;
  pto_hours?: unknown;
  illness_hours?: unknown;
  spot_bonus_amt?: unknown;
  training_bonus_amt?: unknown;
  referral_bonus_amt?: unknown;
  pay_basis?: unknown;
  // Partial back pay: the form's amount is the remaining owed, so subtract
  // what the team member already received.
  backpay_type?: unknown;
  backpay_paid_reg?: unknown;
  backpay_paid_cc_tips?: unknown;
  backpay_paid_declared_tips?: unknown;
}): number {
  const r = num(p.reg_pay_rate);
  const hourly = String(p.pay_basis ?? "").toLowerCase() === "hourly";
  const bonusAmt =
    num(p.spot_bonus_amt) +
    num(p.training_bonus_amt) +
    num(p.referral_bonus_amt);
  const gross =
    num(p.reg_hours) * r +
    num(p.ot_hours) * r * 1.5 +
    num(p.cc_tips) +
    num(p.declared_tips) +
    (hourly ? num(p.pto_hours) * r : 0) +
    (hourly ? num(p.illness_hours) * r : 0) +
    bonusAmt;
  const alreadyPaid =
    String(p.backpay_type ?? "").toLowerCase() === "partial"
      ? num(p.backpay_paid_reg) + num(p.backpay_paid_cc_tips) + num(p.backpay_paid_declared_tips)
      : 0;
  return Math.max(0, gross - alreadyPaid);
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
