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
  final_check_hrs?: unknown;
  spot_bonus_amt?: unknown;
}): number {
  const r = num(p.reg_pay_rate);
  return (
    num(p.reg_hours) * r +
    num(p.ot_hours) * r * 1.5 +
    num(p.cc_tips) +
    num(p.declared_tips) +
    num(p.pto_hours) * r +
    num(p.illness_hours) * r +
    num(p.final_check_hrs) * r +
    num(p.spot_bonus_amt)
  );
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
