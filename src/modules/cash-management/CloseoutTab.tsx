// Cash Management — Night Closeout. Drawer count → live variance vs. cash-due
// → $5 tolerance gate that forces a reason and escalates to DO & SDO.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bell, Check } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchConfig, fetchOverview, submitCloseout } from "./api";
import { centsToInput, toCents, usd } from "./money";
import { MoneyInput, Pill, Stepper } from "./ui";

export function CloseoutTab({
  storeId,
  onDone,
  actionSlot,
}: {
  storeId: string | null;
  onDone: () => void;
  // When set (mobile shell), the submit button renders into this sticky footer.
  actionSlot?: HTMLElement | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const configQuery = useQuery({ queryKey: ["cash-config"], queryFn: fetchConfig, staleTime: 5 * 60_000 });
  const overviewQuery = useQuery({ queryKey: ["cash-overview", storeId], queryFn: () => fetchOverview(storeId) });

  const denoms = configQuery.data?.denominations ?? [];
  const tol = configQuery.data?.closeoutToleranceCents ?? 500;
  const leaders = overviewQuery.data?.leaders;
  const existing = overviewQuery.data?.closeout;
  const businessDate = overviewQuery.data?.business_date ?? null;
  const bizLabel = businessDate
    ? new Date(`${businessDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : "today";

  const [count, setCount] = useState<Record<string, number>>({});
  const [cashDue, setCashDue] = useState("");
  const [deposit, setDeposit] = useState("0.00");
  const [synced, setSynced] = useState(true);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [ackDate, setAckDate] = useState(false);

  // Seed cash-due from an existing closeout for the day, once.
  useEffect(() => {
    if (existing && cashDue === "") setCashDue(centsToInput(existing.cash_due_cents));
  }, [existing, cashDue]);

  const countedCents = useMemo(
    () => denoms.reduce((s, d) => s + d.cents * (count[d.id] || 0), 0),
    [denoms, count]
  );
  useEffect(() => {
    if (synced) setDeposit(centsToInput(countedCents));
  }, [countedCents, synced]);

  const depositCents = toCents(deposit);
  const cashDueCents = toCents(cashDue);
  const variance = depositCents - cashDueCents;
  const balanced = Math.abs(variance) < 1;
  const overTol = Math.abs(variance) > tol;
  const isShort = variance < 0;
  const canSubmit = cashDue !== "" && (!overTol || reason.trim().length >= 8) && ackDate;

  const submit = useMutation({
    mutationFn: () =>
      submitCloseout({
        store_id: storeId!,
        cash_due_cents: cashDueCents,
        deposit_cents: depositCents,
        counted_cents: countedCents,
        denominations: count,
        reason: reason.trim(),
        acknowledged: ackDate,
      }),
    onSuccess: (res) => {
      toast.push(res.flagged ? "Submitted & escalated to DO/SDO." : "Closeout submitted.", "success");
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-deposit", storeId] });
      qc.invalidateQueries({ queryKey: ["cash-dsr", storeId] });
      onDone();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Submit failed.", "error"),
  });

  if (configQuery.isLoading || overviewQuery.isLoading) return <Skeleton className="h-80 w-full" />;

  const varTone = balanced ? "green" : overTol ? "red" : "amber";
  const varBox = {
    green: "bg-emerald-50 ring-emerald-200 text-emerald-700",
    amber: "bg-amber-50 ring-amber-200 text-amber-800",
    red: "bg-red-50 ring-red-200 text-red-700",
  }[varTone];

  // The submit control — rendered inline on desktop, or portaled into the
  // mobile shell's sticky footer when actionSlot is provided.
  const actionContent = (
    <>
      {!confirming ? (
        <Button
          className="w-full"
          variant={overTol ? "danger" : "primary"}
          disabled={!canSubmit || submit.isPending}
          onClick={() => setConfirming(true)}
        >
          {overTol ? "Submit & escalate" : "Submit closeout"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : (
        <div className="space-y-2.5">
          <div className="text-center text-[13px] text-zinc-600">
            Lock in deposit of <strong className="tabular-nums">{usd(depositCents)}</strong>?
          </div>
          <div className="flex gap-2.5">
            <Button variant="secondary" className="w-full" onClick={() => setConfirming(false)} disabled={submit.isPending}>
              Back
            </Button>
            <Button
              variant={overTol ? "danger" : "primary"}
              className="w-full"
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
            >
              <Check className="h-4 w-4" />
              {submit.isPending ? "Submitting…" : "Confirm"}
            </Button>
          </div>
        </div>
      )}
      {!canSubmit && cashDue !== "" && (
        <div className="mt-2 text-center text-[11px] text-red-600">
          {overTol && reason.trim().length < 8
            ? "A reason is required to escalate."
            : !ackDate
              ? "Confirm the closeout date to submit."
              : ""}
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Night Closeout</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Close out the drawer</h2>
          <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
            Count the cash, confirm the deposit, and reconcile against the DSR. Variances over {usd(tol)} are escalated to
            your DO and SDO automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="amber" dot>
            {bizLabel}
          </Pill>
          <Pill tone="neutral">±{usd(tol)} tolerance</Pill>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* drawer count */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <div>
              <div className="text-sm font-semibold text-midnight">Drawer count</div>
              <div className="mt-0.5 text-xs text-zinc-500">Enter quantity per denomination</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCount({})}>
              Reset
            </Button>
          </div>
          <div>
            {denoms.map((d, i) => {
              const sub = d.cents * (count[d.id] || 0);
              return (
                <div
                  key={d.id}
                  className={cn(
                    "grid grid-cols-[64px_1fr_auto_96px] items-center gap-3 px-5 py-2",
                    i ? "border-t border-zinc-100" : ""
                  )}
                >
                  <div className={cn("font-mono text-sm font-bold", d.type === "coin" ? "text-zinc-400" : "text-midnight")}>
                    {d.label}
                  </div>
                  <div className="text-xs capitalize text-zinc-400">{d.type}</div>
                  <Stepper value={count[d.id] || 0} onChange={(v) => setCount((c) => ({ ...c, [d.id]: v }))} />
                  <div className={cn("text-right text-sm font-semibold tabular-nums", sub ? "text-midnight" : "text-zinc-300")}>
                    {usd(sub)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t-2 border-zinc-200 bg-zinc-50 px-5 py-3.5">
            <span className="text-sm font-bold text-midnight">Counted total</span>
            <span className="text-xl font-bold tabular-nums text-midnight">{usd(countedCents)}</span>
          </div>
        </Card>

        {/* reconcile */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="p-5">
            <div className="mb-4 text-sm font-semibold text-midnight">Reconcile</div>

            <label className="mb-3.5 block">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Cash due</div>
              <MoneyInput value={cashDue} onChange={setCashDue} placeholder="0.00" />
              <div className="mt-1.5 text-[11px] text-zinc-400">Expected deposit — pulled from today's DSR.</div>
            </label>

            <label className="mb-1.5 block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Deposit amount</span>
                {!synced && (
                  <button
                    onClick={() => setSynced(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Match counted
                  </button>
                )}
              </div>
              <MoneyInput
                value={deposit}
                onChange={(v) => {
                  setSynced(false);
                  setDeposit(v);
                }}
              />
            </label>

            <div className={cn("mt-4 rounded-md p-4 ring-1 ring-inset", varBox)}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider">Variance</span>
                <Pill tone={varTone}>
                  {balanced ? "Balanced" : overTol ? "Over tolerance" : isShort ? "Short" : "Over"}
                </Pill>
              </div>
              <div className="mt-1.5 text-3xl font-bold leading-none tabular-nums">
                {balanced ? usd(0) : usd(variance, { signed: true })}
              </div>
              <div className="mt-1.5 text-xs opacity-90">
                {balanced
                  ? "Drawer matches the DSR exactly."
                  : overTol
                    ? `Exceeds the ${usd(tol)} tolerance — escalation required.`
                    : `Within the ${usd(tol)} tolerance.`}
              </div>
            </div>

            {overTol && (
              <div className="mt-4">
                <div className="mb-3 flex gap-2.5 rounded-md bg-red-50 p-3 ring-1 ring-inset ring-red-200">
                  <Bell className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div className="text-xs leading-snug text-red-700">
                    Submitting will alert{" "}
                    <strong>{leaders?.do_name ?? "your DO"} (DO)</strong> and{" "}
                    <strong>{leaders?.sdo_name ?? "your SDO"} (SDO)</strong>.
                  </div>
                </div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Reason for variance <span className="text-red-600">*</span>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Required — explain the over/short (min 8 chars)…"
                  className="block w-full resize-y rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            <label className="mt-4 flex items-start gap-2.5 rounded-md bg-zinc-50 p-3 text-[13px] text-zinc-700 ring-1 ring-inset ring-zinc-200">
              <input
                type="checkbox"
                checked={ackDate}
                onChange={(e) => setAckDate(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
              />
              <span>
                I confirm this closeout is for <strong>{bizLabel}</strong>.
              </span>
            </label>

            {!actionSlot && <div className="mt-4">{actionContent}</div>}
          </Card>
        </div>
      </div>
      {actionSlot ? createPortal(actionContent, actionSlot) : null}
    </div>
  );
}
