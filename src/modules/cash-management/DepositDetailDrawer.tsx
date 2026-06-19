// Cash Management — deposit/closeout review drawer. Shows the full closeout +
// deposit, the stamped slip, an action history (who did what, when), and — for
// DOs and above (within their scope) — an inline edit form to correct a prior
// day's closeout/deposit (wrong amount, wrong business date). Edits require a
// reason and are logged.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, FileText, Pencil, X } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { editCloseout, fetchDetail, fetchSlipUrl } from "./api";
import { centsToInput, toCents, usd } from "./money";
import { MoneyInput, Pill, StatusPill } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  submit: "Submitted",
  edit: "Edited",
  "verify-deposit": "Deposit validated",
  "alert-ack": "Alert acknowledged",
  "alert-resolve": "Alert resolved",
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

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
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["cash-detail", closeoutId],
    queryFn: () => fetchDetail(closeoutId!),
    enabled: open && !!closeoutId,
  });
  const d = query.data;

  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [cashDue, setCashDue] = useState("");
  const [deposit, setDeposit] = useState("");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");

  function startEdit() {
    if (!d) return;
    setDate(d.closeout.business_date);
    setCashDue(centsToInput(d.closeout.cash_due_cents));
    setDeposit(centsToInput(d.closeout.deposit_cents));
    setCounted(centsToInput(d.closeout.counted_cents));
    setReason(d.closeout.reason ?? "");
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: () =>
      editCloseout({
        closeout_id: d!.closeout.id,
        business_date: date,
        cash_due_cents: toCents(cashDue),
        deposit_cents: toCents(deposit),
        counted_cents: toCents(counted),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.push("Closeout updated.", "success");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["cash-detail", closeoutId] });
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-dsr"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Update failed.", "error"),
  });

  async function openSlip(depositId: string) {
    try {
      const { url } = await fetchSlipUrl(depositId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't open slip.", "error");
    }
  }

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
          <div className="flex items-center gap-2">
            {d?.can_edit && !editing && (
              <Button variant="secondary" onClick={startEdit}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {d?.deposit?.has_slip && (
              <Button onClick={() => openSlip(d.deposit!.id)}>
                <FileText className="h-4 w-4" /> View slip
              </Button>
            )}
          </div>
        </div>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError || !d ? (
        <div className="text-sm text-red-700">{(query.error as Error)?.message ?? "Couldn't load detail."}</div>
      ) : (
        <div className="space-y-5 text-sm">
          {editing ? (
            <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Edit closeout</h4>
                <button onClick={() => setEditing(false)} className="text-amber-700 hover:text-amber-900" aria-label="Cancel">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">Business date</div>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-amber-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <div className="mt-1 text-[11px] text-amber-700">Fix a wrong-day entry here.</div>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">Cash due</div>
                    <MoneyInput value={cashDue} onChange={setCashDue} />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">Deposit</div>
                    <MoneyInput value={deposit} onChange={setDeposit} />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">Counted</div>
                    <MoneyInput value={counted} onChange={setCounted} />
                  </label>
                </div>
                <label className="block">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">Reason for edit *</div>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Why is this being corrected? (logged for the record)"
                    className="block w-full resize-y rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-amber-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </label>
                <div className="flex gap-2">
                  <Button variant="secondary" className="w-full" onClick={() => setEditing(false)} disabled={save.isPending}>
                    Cancel
                  </Button>
                  <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || reason.trim().length < 4}>
                    <Check className="h-4 w-4" />
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
                {reason.trim().length < 4 && (
                  <div className="text-[11px] font-medium text-amber-700">A reason is required to save an edit.</div>
                )}
              </div>
            </section>
          ) : (
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
          )}

          {d.deposit ? (
            <section className="border-t border-zinc-100 pt-4">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-midnight">Deposit {d.deposit.code}</h4>
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
              {!d.deposit.has_slip && <div className="mt-3 text-xs text-zinc-400">No deposit-slip photo on file.</div>}
            </section>
          ) : (
            <div className="border-t border-zinc-100 pt-4 text-sm text-zinc-400">Deposit not yet created for this closeout.</div>
          )}

          {/* Action history */}
          <section className="border-t border-zinc-100 pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-midnight">History</h4>
            {d.history.length === 0 ? (
              <div className="text-xs text-zinc-400">No recorded actions yet.</div>
            ) : (
              <ol className="space-y-2.5">
                {d.history.map((h) => (
                  <li key={h.id} className="flex gap-2.5">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-midnight">{ACTION_LABEL[h.action] ?? h.action}</div>
                      <div className="text-[11px] text-zinc-400">
                        {h.actor_name ? `${h.actor_name} · ` : ""}
                        {fmtWhen(h.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
