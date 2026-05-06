import type { PafRow } from "./types";
import { formatUSD } from "./cost";

export function PafDetail({ paf }: { paf: PafRow }) {
  return (
    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      <Field label="Store" value={`#${paf.drive_in}`} />
      <Field label="Market / DO" value={paf.market_do ?? "—"} />
      <Field label="Employee" value={paf.employee_name} />
      <Field label="Last 4 SSN" value={paf.last4_ssn} mono />
      <Field label="Category" value={paf.category} />
      <Field label="Status" value={paf.status} />
      <Field label="Submitted" value={paf.created_at.slice(0, 10)} />
      <Field label="Pay Period End" value={paf.pay_period_end} />
      {Number(paf.reg_pay_rate) > 0 && (
        <>
          <Field label="Reg Pay Rate" value={formatUSD(Number(paf.reg_pay_rate))} />
          <Field label="Reg Hours" value={String(paf.reg_hours)} />
        </>
      )}
      {Number(paf.ot_hours) > 0 && (
        <Field label="OT Hours" value={String(paf.ot_hours)} />
      )}
      {Number(paf.cc_tips) > 0 && (
        <Field label="CC Tips" value={formatUSD(Number(paf.cc_tips))} />
      )}
      {Number(paf.declared_tips) > 0 && (
        <Field label="Declared Tips" value={formatUSD(Number(paf.declared_tips))} />
      )}
      {Number(paf.pto_hours) > 0 && (
        <Field label="PTO Hours" value={String(paf.pto_hours)} />
      )}
      {Number(paf.illness_hours) > 0 && (
        <Field label="Illness Hours" value={String(paf.illness_hours)} />
      )}
      {Number(paf.spot_bonus_amt) > 0 && (
        <>
          <Field label="Spot Bonus" value={formatUSD(Number(paf.spot_bonus_amt))} />
          <Field label="Bonus Type" value={paf.bonus_type ?? "—"} />
        </>
      )}
      <Field
        label="Estimated Cost"
        value={formatUSD(Number(paf.estimated_cost) || 0)}
      />

      {paf.rejection_reason && (
        <div className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700">
            Rejection reason
          </div>
          <div className="mt-1 text-sm text-red-700">{paf.rejection_reason}</div>
        </div>
      )}
      {paf.explanation && (
        <div className="sm:col-span-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Explanation
          </div>
          <div className="mt-1 text-sm text-zinc-700 whitespace-pre-wrap">{paf.explanation}</div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className={`mt-0.5 text-zinc-700 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
