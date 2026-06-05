// Cash Management — DSR & Carried Over ledger with a running balance.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, Lock } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchDsr } from "./api";
import { usd } from "./money";
import { Figure, Pill } from "./ui";
import { DepositDetailDrawer } from "./DepositDetailDrawer";

export function DsrTab({ storeId }: { storeId: string | null }) {
  const query = useQuery({ queryKey: ["cash-dsr", storeId], queryFn: () => fetchDsr(storeId) });
  const [detailId, setDetailId] = useState<string | null>(null);

  if (query.isLoading) return <Skeleton className="h-80 w-full" />;
  if (query.isError) return <EmptyState title="Couldn't load the DSR ledger" description={(query.error as Error)?.message} />;

  const data = query.data!;
  const tol = data.toleranceCents;
  const carry = data.current_carry_cents;
  const carrying = Math.abs(carry) > 0;

  if (data.ledger.length === 0)
    return <EmptyState title="No DSR history yet" description="Submit a night closeout to start the carried-over ledger." />;

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">DSR &amp; Carried Over</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Daily Sales Report ledger</h2>
        <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
          Running reconciliation across recent business days, with any amount carried forward from one DSR to the next.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-5">
          <Figure label="Carried over now" value={usd(carry)} tone={carrying ? "red" : undefined} sub={carrying ? "Rolling forward" : "Fully reconciled"} />
        </Card>
        <Card className="p-5">
          <Figure label={`Deposited (${data.days}d)`} value={usd(data.total_deposited_cents)} sub="Across the period" />
        </Card>
        <Card className="p-5">
          <Figure label="Flagged days" value={data.flagged_days} mono={false} tone={data.flagged_days ? "red" : undefined} sub={`Over ${usd(tol)} tolerance`} />
        </Card>
        <Card className="p-5">
          <Figure label="Clean days" value={data.clean_days} mono={false} sub="Within tolerance" />
        </Card>
      </div>

      <div
        className={cn(
          "mb-5 flex gap-3 rounded-lg p-4 ring-1 ring-inset",
          carrying ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-200"
        )}
      >
        {carrying ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
        <div className={cn("text-[13px] leading-relaxed", carrying ? "text-amber-800" : "text-emerald-700")}>
          {carrying ? (
            <>
              <strong>{usd(carry)} is carrying forward.</strong> An unresolved variance keeps rolling into the next DSR until a DO or SDO
              resolves it.
            </>
          ) : (
            <>
              <strong>Nothing is carrying forward.</strong> Every deposit reconciled within tolerance — the ledger is square.
            </>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-50 text-right text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-5 py-3 text-left font-bold">Business day</th>
                <th className="px-4 py-3 font-bold">Carried in</th>
                <th className="px-4 py-3 font-bold">Cash due</th>
                <th className="px-4 py-3 font-bold">Deposit</th>
                <th className="px-4 py-3 font-bold">Variance</th>
                <th className="px-4 py-3 font-bold">Carried out</th>
                <th className="px-5 py-3 text-center font-bold">Deposit</th>
                <th className="px-5 py-3 text-center font-bold">Review</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((h) => {
                const over = Math.abs(h.variance_cents) > tol;
                return (
                  <tr key={h.business_date} className="border-t border-zinc-100 text-right">
                    <td className="px-5 py-3 text-left">
                      <div className="font-medium text-midnight">{h.business_date.slice(5)}</div>
                      <div className="font-mono text-[11px] text-zinc-400">{h.id}</div>
                    </td>
                    <td className={cn("px-4 py-3 tabular-nums", h.carried_in_cents ? "text-amber-800" : "text-zinc-300")}>
                      {h.carried_in_cents ? usd(h.carried_in_cents, { signed: true }) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-600">{usd(h.cash_due_cents)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{usd(h.deposit_cents)}</td>
                    <td className={cn("px-4 py-3 font-bold tabular-nums", h.variance_cents === 0 ? "text-zinc-400" : over ? "text-red-700" : "text-zinc-600")}>
                      {h.variance_cents === 0 ? "—" : usd(h.variance_cents, { signed: true })}
                    </td>
                    <td className={cn("px-4 py-3 font-bold tabular-nums", Math.abs(h.carried_out_cents) > 0 ? "text-amber-800" : "text-zinc-300")}>
                      {Math.abs(h.carried_out_cents) > 0 ? usd(h.carried_out_cents, { signed: true }) : usd(0)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {h.deposit_verified ? <Pill tone="green" dot>Verified</Pill> : <Pill tone="amber" dot>Pending</Pill>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setDetailId(h.closeout_id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 hover:text-midnight"
                      >
                        <Eye className="h-3.5 w-3.5" /> Detail
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <DepositDetailDrawer closeoutId={detailId} open={!!detailId} onClose={() => setDetailId(null)} />

      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
        <Lock className="h-3.5 w-3.5" /> Ledger entries are immutable once a closeout is submitted. Adjustments post as new rows.
      </div>
    </div>
  );
}
