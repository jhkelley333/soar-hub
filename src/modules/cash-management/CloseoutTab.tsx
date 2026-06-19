// Cash Management — Night Closeout. Drawer count → live variance vs. cash-due
// → $5 tolerance gate that forces a reason and escalates to DO & SDO.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bell, Check, CalendarClock, Lock, Unlock } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchConfig, fetchMissedDays, fetchOverview, submitCloseout } from "./api";
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
  const { profile } = useAuth();
  const LEADER_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

  const configQuery = useQuery({ queryKey: ["cash-config"], queryFn: fetchConfig, staleTime: 5 * 60_000 });
  const overviewQuery = useQuery({ queryKey: ["cash-overview", storeId], queryFn: () => fetchOverview(storeId) });
  const missedQuery = useQuery({ queryKey: ["cash-missed-days", storeId], queryFn: () => fetchMissedDays(storeId) });

  const denoms = configQuery.data?.denominations ?? [];
  const tol = configQuery.data?.closeoutToleranceCents ?? 500;
  const leaders = overviewQuery.data?.leaders;
  const existing = overviewQuery.data?.closeout;
  const today = overviewQuery.data?.business_date ?? null;
  const missedDays = missedQuery.data?.missed ?? [];

  // null target = closing for today (the normal path). A missed-day string puts
  // the tab in retro/late mode for that prior business date.
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const isLate = targetDate !== null;
  const businessDate = targetDate ?? today;
  const bizLabel = businessDate
    ? new Date(`${businessDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : "today";

  const [count, setCount] = useState<Record<string, number>>({});
  const [cashDue, setCashDue] = useState("");
  const [deposit, setDeposit] = useState("0.00");
  const [synced, setSynced] = useState(true);
  const [reason, setReason] = useState("");
  const [lateNote, setLateNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [ackDate, setAckDate] = useState(false);

  // (Cash-due prefill for an existing day is handled by unlock() below. We
  // deliberately do NOT reactively re-seed it: a correcting user who clears
  // the field to retype would otherwise have it snap back to the old value.)

  // Switching the target day resets the form so today's numbers never bleed
  // into a back-dated entry (and vice-versa).
  useEffect(() => {
    setCount({});
    setCashDue("");
    setDeposit("0.00");
    setSynced(true);
    setReason("");
    setLateNote("");
    setAckDate(false);
    setConfirming(false);
    setDayConfirm(null);
    setUnlocked(false);
    setCorrectionReason("");
  }, [targetDate]);

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

  // null target = closing for today; a missed-day string = retro/late mode.
  const [dayConfirm, setDayConfirm] = useState<{ today: string; suggested: string } | null>(null);

  // Lock: a submitted closeout for today is read-only until unlocked. Who can
  // unlock depends on lifecycle — a verified day needs a DO/SDO+; an
  // unverified day, its original closer or a leader.
  const [unlocked, setUnlocked] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const isLeader = LEADER_ROLES.includes(profile?.role ?? "");
  const isSubmitter = !!existing?.submitted_by && existing.submitted_by === profile?.id;
  const verified = existing?.status === "verified";
  const locked = !isLate && !!existing;
  const canUnlock = locked && (verified ? isLeader : (isSubmitter || isLeader));
  const isCorrecting = locked && unlocked;
  const showForm = !locked || unlocked;

  function unlock() {
    if (existing) {
      setCashDue(centsToInput(existing.cash_due_cents));
      setDeposit(centsToInput(existing.deposit_cents));
      setSynced(false);
    }
    setUnlocked(true);
  }

  const canSubmit =
    cashDue !== "" &&
    (!overTol || reason.trim().length >= 8) &&
    (isCorrecting ? correctionReason.trim().length >= 8 : ackDate);

  const submit = useMutation({
    mutationFn: (vars: { confirmToday?: boolean; businessDate?: string } = {}) => {
      const dateField: { business_date?: string; late_note?: string } = {};
      if (vars.businessDate) {
        // Closer corrected the day to the missed prior date — records as late.
        dateField.business_date = vars.businessDate;
        dateField.late_note = lateNote.trim() || "Date corrected at closeout to the missed day.";
      } else if (isLate) {
        dateField.business_date = targetDate!;
        if (lateNote.trim()) dateField.late_note = lateNote.trim();
      }
      return submitCloseout({
        store_id: storeId!,
        cash_due_cents: cashDueCents,
        deposit_cents: depositCents,
        counted_cents: countedCents,
        denominations: count,
        reason: reason.trim(),
        acknowledged: ackDate,
        ...(vars.confirmToday ? { confirm_today: true } : {}),
        ...(isCorrecting ? { correction_reason: correctionReason.trim() } : {}),
        ...dateField,
      });
    },
    onSuccess: (res) => {
      // Wrong-day fail-safe tripped — ask which day before recording.
      if (res.confirm_business_date && res.today && res.suggested_date) {
        setConfirming(false);
        setDayConfirm({ today: res.today, suggested: res.suggested_date });
        return;
      }
      setDayConfirm(null);
      toast.push(
        res.corrected
          ? "Correction saved — logged for your DO/SDO."
          : res.flagged
            ? "Submitted & escalated to DO/SDO."
            : res.is_late
              ? "Late closeout recorded — DO/SDO notified."
              : "Closeout submitted.",
        "success"
      );
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-missed-days", storeId] });
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
  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const actionContent = (
    <>
      {dayConfirm ? (
        <div className="space-y-2.5 rounded-md bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
          <div className="text-[13px] font-semibold text-amber-900">Which day is this deposit for?</div>
          <div className="text-xs leading-snug text-amber-800">
            There's no closeout yet for <strong>{fmtDay(dayConfirm.suggested)}</strong>. If last night was missed,
            this deposit is probably for that day — pick it so it lands on the right date.
          </div>
          <div className="grid gap-2">
            <Button variant="primary" className="w-full" disabled={submit.isPending}
              onClick={() => submit.mutate({ businessDate: dayConfirm.suggested })}>
              It's for {fmtDay(dayConfirm.suggested)} (the missed day)
            </Button>
            <Button variant="secondary" className="w-full" disabled={submit.isPending}
              onClick={() => submit.mutate({ confirmToday: true })}>
              No — it's for today, {fmtDay(dayConfirm.today)}
            </Button>
            <button type="button" className="text-center text-[11px] font-medium text-zinc-500 hover:text-zinc-700"
              onClick={() => setDayConfirm(null)} disabled={submit.isPending}>
              Cancel
            </button>
          </div>
        </div>
      ) : !confirming ? (
        <Button
          className="w-full"
          variant={overTol ? "danger" : "primary"}
          disabled={!canSubmit || submit.isPending}
          onClick={() => setConfirming(true)}
        >
          {overTol ? "Submit & escalate" : isLate ? "Submit late closeout" : "Submit closeout"}
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
              onClick={() => submit.mutate({})}
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
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Close out the deposit</h2>
          <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
            Count the cash, confirm the deposit, and reconcile against the POS. Variances over {usd(tol)} are escalated to
            your DO and SDO automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={isLate ? "red" : "amber"} dot>
            {isLate ? `Late · ${bizLabel}` : bizLabel}
          </Pill>
          <Pill tone="neutral">±{usd(tol)} tolerance</Pill>
        </div>
      </div>

      {/* Retro / late close — pick a missed prior day to backfill. Only shown
          when there are missed days in the last 7. */}
      {(missedDays.length > 0 || isLate) && (
        <div
          className={cn(
            "mb-5 rounded-md p-4 ring-1 ring-inset",
            isLate ? "bg-red-50 ring-red-200" : "bg-amber-50 ring-amber-200"
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <CalendarClock className={cn("h-5 w-5 shrink-0", isLate ? "text-red-600" : "text-amber-700")} />
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-semibold", isLate ? "text-red-800" : "text-amber-900")}>
                {isLate ? "Backfilling a missed closeout" : "Forgot to close a prior day?"}
              </div>
              <div className={cn("text-xs", isLate ? "text-red-700" : "text-amber-800")}>
                {isLate
                  ? "This will be recorded as a late closeout and your DO & SDO will be notified."
                  : `${missedDays.length} day${missedDays.length > 1 ? "s" : ""} in the last week ${missedDays.length > 1 ? "have" : "has"} no closeout.`}
              </div>
            </div>
            <select
              value={targetDate ?? ""}
              onChange={(e) => setTargetDate(e.target.value || null)}
              className="rounded-md border-0 bg-white px-3 py-2 text-sm font-medium text-midnight ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Today{today ? ` · ${new Date(`${today}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</option>
              {missedDays.map((d) => (
                <option key={d} value={d}>
                  {new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — missed
                </option>
              ))}
            </select>
          </div>

          {isLate && (
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-red-700">
                Why is this late? <span className="font-normal normal-case text-red-500">(optional)</span>
              </div>
              <input
                type="text"
                value={lateNote}
                onChange={(e) => setLateNote(e.target.value)}
                maxLength={500}
                placeholder="e.g. Closer clocked out before counting the drawer"
                className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-red-200 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}
        </div>
      )}

      {/* Locked — a submitted day is read-only until deliberately unlocked. */}
      {locked && !unlocked && (
        <div className="mb-5 rounded-md bg-zinc-50 p-4 ring-1 ring-inset ring-zinc-200">
          <div className="flex flex-wrap items-center gap-3">
            <Lock className="h-5 w-5 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-midnight">
                {bizLabel} is closed out{verified ? " & verified" : ""} — locked
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                Deposit {usd(existing!.deposit_cents)}
                {existing!.submitted_by_name ? ` · by ${existing!.submitted_by_name}` : ""}.
                {canUnlock
                  ? " Unlock to correct an error — you'll add a reason and it's logged."
                  : verified
                    ? " Verified days can only be corrected by a DO/SDO."
                    : " Only the closer or a DO/SDO can correct this."}
              </div>
            </div>
            {canUnlock && (
              <Button variant="secondary" size="sm" onClick={unlock}>
                <Unlock className="h-4 w-4" /> Unlock to correct
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Unlocked — correcting a submitted day; a reason is required. */}
      {isCorrecting && (
        <div className="mb-5 rounded-md bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
          <div className="text-sm font-semibold text-amber-900">Correcting {bizLabel}</div>
          <p className="mt-0.5 text-xs text-amber-800">
            {verified
              ? "This day was verified — your DO/SDO will be notified and the deposit re-opened for re-verification."
              : "Adjust the figures below, then give a reason for the change."}
          </p>
          <textarea
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Reason for correction (e.g. miscounted the $20 strap; recounted to $1,240)"
            className="mt-2 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-amber-200 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="button" onClick={() => setUnlocked(false)}
            className="mt-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-700">
            Cancel correction
          </button>
        </div>
      )}

      {showForm && (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* drawer count */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
            <div>
              <div className="text-sm font-semibold text-midnight">Deposit count</div>
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
              <div className="mt-1.5 text-[11px] text-zinc-400">Expected deposit — pulled from today's POS.</div>
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
                  ? "Drawer matches the POS exactly."
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

            <label
              className={cn(
                "mt-4 flex items-start gap-2.5 rounded-md p-3 text-[13px] ring-1 ring-inset",
                isLate ? "bg-red-50 text-red-800 ring-red-200" : "bg-zinc-50 text-zinc-700 ring-zinc-200"
              )}
            >
              <input
                type="checkbox"
                checked={ackDate}
                onChange={(e) => setAckDate(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
              />
              <span>
                {isLate ? (
                  <>
                    I confirm this is a <strong>late closeout</strong> for <strong>{bizLabel}</strong>.
                  </>
                ) : (
                  <>
                    I confirm this closeout is for <strong>{bizLabel}</strong>.
                  </>
                )}
              </span>
            </label>

            {!actionSlot && <div className="mt-4">{actionContent}</div>}
          </Card>
        </div>
      </div>
      )}
      {actionSlot && showForm ? createPortal(actionContent, actionSlot) : null}
    </div>
  );
}
