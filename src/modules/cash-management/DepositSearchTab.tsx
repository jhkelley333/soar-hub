// Cash Management — deposit search (leaders). Find a deposit across the
// caller's scope by date, store number, and/or amount; open the full
// closeout/deposit detail from a result.
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { searchDeposits } from "./api";
import { usd } from "./money";
import { DepositDetailDrawer } from "./DepositDetailDrawer";
import type { DepositSearchFilters } from "./types";

const INPUT =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

function statusTone(status: string): "neutral" | "success" | "danger" | "warning" {
  if (status === "verified") return "success";
  if (status === "flagged") return "danger";
  return "warning"; // pending
}

export function DepositSearchTab() {
  const [date, setDate] = useState("");
  const [storeNum, setStoreNum] = useState("");
  const [amount, setAmount] = useState("");
  const [applied, setApplied] = useState<DepositSearchFilters | null>(null);
  const [openCloseout, setOpenCloseout] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["cash-deposit-search", applied],
    queryFn: () => searchDeposits(applied!),
    enabled: !!applied,
  });

  const canSearch = !!(date.trim() || storeNum.trim() || amount.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSearch) return;
    setApplied({
      date: date.trim() || undefined,
      store_number: storeNum.trim() || undefined,
      amount: amount.trim() || undefined,
    });
  };
  const clear = () => { setDate(""); setStoreNum(""); setAmount(""); setApplied(null); };

  const results = q.data?.deposits ?? [];

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Leader Dashboard</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Find a deposit</h2>
        <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
          Search deposits across your stores by date, store number, and/or amount. Fill in any combination.
        </p>
      </div>

      <Card className="mb-5">
        <CardBody>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Date (business day)</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Store number</span>
              <input inputMode="numeric" value={storeNum} onChange={(e) => setStoreNum(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 1056" className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Amount ($)</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 1234.56" className={INPUT} />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={!canSearch}>
                <Search className="mr-1 h-4 w-4" />Search
              </Button>
              {applied && <Button type="button" variant="ghost" onClick={clear}>Clear</Button>}
            </div>
          </form>
          <p className="mt-2 text-[11px] text-zinc-400">Amount matches a deposit's recorded or bank-credited amount exactly.</p>
        </CardBody>
      </Card>

      {!applied ? (
        <Card><EmptyState title="Search for a deposit" description="Enter a date, store number, or amount above." /></Card>
      ) : q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <Card><EmptyState title="Search failed" description={(q.error as Error)?.message ?? "Try again."} /></Card>
      ) : results.length === 0 ? (
        <Card><EmptyState title="No deposits found" description="Nothing in your scope matches those filters." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-500">{results.length} result{results.length === 1 ? "" : "s"}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Business day</th>
                  <th className="px-4 py-3">Recorded</th>
                  <th className="px-4 py-3">Bank</th>
                  <th className="px-4 py-3">Variance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {results.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setOpenCloseout(d.closeout_id)}>
                    <td className="px-4 py-3 font-medium text-midnight">#{d.store_number}{d.store_name ? <span className="font-normal text-zinc-500"> — {d.store_name}</span> : ""}</td>
                    <td className="px-4 py-3 text-zinc-700">{d.for_date}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-700">{usd(d.expected_cents)}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-700">{d.bank_credited_cents != null ? usd(d.bank_credited_cents) : "—"}</td>
                    <td className={`px-4 py-3 tabular-nums ${d.variance_cents ? "font-medium text-red-600" : "text-zinc-400"}`}>{d.variance_cents != null ? usd(d.variance_cents, { signed: true }) : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(d.status)}>{d.status}</Badge></td>
                    <td className="px-4 py-3 text-right text-xs font-medium text-accent">Open →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <DepositDetailDrawer closeoutId={openCloseout} open={!!openCloseout} onClose={() => setOpenCloseout(null)} />
    </div>
  );
}
