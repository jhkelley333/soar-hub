// Cash Management — deposit review drawer. Accounting / DO+ open a day's
// closeout + deposit detail and the stamped slip photo for review.

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { fetchDetail, fetchSlipUrl } from "./api";
import { usd } from "./money";
import { Pill, StatusPill } from "./ui";

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-zinc-800 ${mono ? "tabular-nums" : ""}`}>{value}</div>
    </div>
  );
}

export function DepositDetailDrawer({
  closeoutId,
  open,
  onClose,
}: {
  closeoutId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const query = useQuery({
    queryKey: ["cash-detail", closeoutId],
    queryFn: () => fetchDetail(closeoutId!),
    enabled: open && !!closeoutId,
  });

  async function openSlip(depositId: string) {
    try {
      const { url } = await fetchSlipUrl(depositId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't open slip.", "error");
    }
  }

  const d = query.data;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={d ? `Closeout ${d.closeout.code} · #${d.closeout.store_number}` : "Deposit detail"}
      footer={
        <div className="flex flex-1 items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {d?.deposit?.has_slip && (
            <Button onClick={() => openSlip(d.deposit!.id)}>
              <FileText className="h-4 w-4" /> View deposit slip
            </Button>
          )}
        </div>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError || !d ? (
        <div className="text-sm text-red-700">{(query.error as Error)?.message ?? "Couldn't load detail."}</div>
      ) : (
        <div className="space-y-5 text-sm">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-midnight">Closeout</h4>
            <div className="grid grid-cols-2 gap-3">
              <Row label="Business day" value={d.closeout.business_date} mono={false} />
              <Row label="Status" value={<StatusPill status={d.closeout.status} />} mono={false} />
              <Row label="Cash due" value={usd(d.closeout.cash_due_cents)} />
              <Row label="Counted" value={usd(d.closeout.counted_cents)} />
              <Row label="Deposit" value={usd(d.closeout.deposit_cents)} />
              <Row
                label="Variance"
                value={<span className={d.closeout.flagged ? "font-bold text-red-700" : ""}>{usd(d.closeout.variance_cents, { signed: true })}</span>}
              />
              <Row label="Submitted by" value={d.closeout.submitted_by_name ?? "—"} mono={false} />
            </div>
            {d.closeout.reason && (
              <div className="mt-3 rounded-md bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Reason</div>
                <div className="mt-0.5 text-zinc-700">{d.closeout.reason}</div>
              </div>
            )}
          </section>

          {d.deposit ? (
            <section className="border-t border-zinc-100 pt-4">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-midnight">
                  Deposit {d.deposit.code}
                </h4>
                <StatusPill status={d.deposit.status} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Row label="Expected at bank" value={usd(d.deposit.expected_cents)} />
                <Row label="Bank credited" value={d.deposit.bank_credited_cents != null ? usd(d.deposit.bank_credited_cents) : "—"} />
                {d.deposit.variance_cents != null && (
                  <Row
                    label="Bank variance"
                    value={<span className={d.deposit.flagged ? "font-bold text-red-700" : ""}>{usd(d.deposit.variance_cents, { signed: true })}</span>}
                  />
                )}
                <Row
                  label="Carried over (DSR)"
                  value={`${d.deposit.carried_over_count} check(s) · ${usd(d.deposit.dsr_carried_over_cents)}`}
                  mono={false}
                />
                <Row label="Verified" value={d.deposit.verified_at ? d.deposit.verified_at.slice(0, 10) : "—"} mono={false} />
              </div>

              {(d.deposit.carried_over_count > 0 || Math.abs(d.deposit.dsr_carried_over_cents) > 0) && (
                <div className="mt-3 rounded-md bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Carried-over</span>
                    <Pill tone={d.deposit.carried_ack ? "green" : "amber"} dot>
                      {d.deposit.carried_ack ? "Recorded & addressed" : "Not yet addressed"}
                    </Pill>
                  </div>
                  {d.deposit.carried_note && <div className="mt-1.5 text-amber-900">{d.deposit.carried_note}</div>}
                </div>
              )}

              {d.deposit.reason && (
                <div className="mt-3 rounded-md bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Mismatch reason</div>
                  <div className="mt-0.5 text-zinc-700">{d.deposit.reason}</div>
                </div>
              )}

              {!d.deposit.has_slip && (
                <div className="mt-3 text-xs text-zinc-400">No deposit-slip photo on file.</div>
              )}
            </section>
          ) : (
            <div className="border-t border-zinc-100 pt-4 text-sm text-zinc-400">
              Deposit not yet created for this closeout.
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
