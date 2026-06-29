// Cash Management — Next-Day Deposit Validation. Bank-credit match + stamped
// slip photo + carried-over (read-only from DSR) + 3-point verify checklist.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Camera, Check } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchDeposit, uploadSlip, verifyDeposit } from "./api";
import { toCents, usd } from "./money";
import { InfoDot, MoneyInput, Pill } from "./ui";

function CheckRow({ done, label, sub }: { done: boolean; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
          done ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-400 ring-1 ring-inset ring-zinc-200"
        )}
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1 w-1 rounded-full bg-zinc-400" />}
      </div>
      <div>
        <div className={cn("text-[13px] font-semibold", done ? "text-midnight" : "text-zinc-500")}>{label}</div>
        <div className="text-xs text-zinc-400">{sub}</div>
      </div>
    </div>
  );
}

export function DepositTab({
  storeId,
  onDone,
  actionSlot,
}: {
  storeId: string | null;
  onDone: () => void;
  // When set (mobile shell), the verify button renders into this sticky footer.
  actionSlot?: HTMLElement | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const depQuery = useQuery({ queryKey: ["cash-deposit", storeId], queryFn: () => fetchDeposit(storeId) });
  const deposits = depQuery.data?.deposits ?? [];
  const tol = depQuery.data?.toleranceCents ?? 500;

  // Which pending deposit the closer is validating. When there's only one
  // (the common case) it's auto-selected; with multiple (banks taking 2–3
  // days to credit, especially across weekends) the closer picks.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dep = useMemo(
    () => deposits.find((d) => d.id === selectedId) ?? deposits[0] ?? null,
    [deposits, selectedId]
  );

  const [bankCredit, setBankCredit] = useState("");
  const [slipPath, setSlipPath] = useState<string | null>(null);
  const [slipName, setSlipName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState("");
  const [carriedCount, setCarriedCount] = useState("");
  const [carriedDollars, setCarriedDollars] = useState("");
  const [carriedAck, setCarriedAck] = useState(false);
  const [carriedNote, setCarriedNote] = useState("");

  // Switching which deposit is being validated must reset all of the
  // validator's inputs so the bank-credit / slip / carried-over numbers from
  // a different deposit don't leak across.
  useEffect(() => {
    setBankCredit("");
    setSlipPath(null);
    setSlipName(null);
    setReason("");
    setCarriedCount("");
    setCarriedDollars("");
    setCarriedAck(false);
    setCarriedNote("");
  }, [dep?.id]);

  const bankCents = toCents(bankCredit);
  const hasBank = bankCredit !== "";
  const variance = dep ? bankCents - dep.expected_cents : 0;
  const matched = hasBank && Math.abs(variance) <= tol;
  const overTol = hasBank && Math.abs(variance) > tol;
  const carriedCountN = parseInt(carriedCount || "0", 10) || 0;
  const carriedCents = toCents(carriedDollars);
  const hasCarry = carriedCountN > 0 || carriedCents !== 0;
  const canVerify =
    !!dep && hasBank && !!slipPath && (matched || reason.trim().length >= 8) && (!hasCarry || carriedAck);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !storeId) return;
    setUploading(true);
    try {
      const path = await uploadSlip(storeId, file);
      setSlipPath(path);
      setSlipName(file.name);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  const verify = useMutation({
    mutationFn: () =>
      verifyDeposit({
        deposit_id: dep!.id,
        bank_credited_cents: bankCents,
        slip_path: slipPath!,
        reason: reason.trim(),
        carried_over_count: carriedCountN,
        carried_over_cents: carriedCents,
        carried_ack: hasCarry ? carriedAck : undefined,
        carried_note: hasCarry ? carriedNote.trim() : undefined,
      }),
    onSuccess: (res) => {
      toast.push(res.flagged ? "Verified with exception — DO/SDO alerted." : "Deposit validated.", "success");
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-deposit", storeId] });
      qc.invalidateQueries({ queryKey: ["cash-dsr", storeId] });
      onDone();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Verify failed.", "error"),
  });

  if (depQuery.isLoading) return <Skeleton className="h-80 w-full" />;
  if (deposits.length === 0 || !dep)
    return (
      <EmptyState
        title="No deposit awaiting validation"
        description="Once tonight's closeout is submitted, its deposit shows up here the next day."
      />
    );
  const multiPending = deposits.length > 1;

  // Verify control — inline on desktop, portaled to the mobile sticky footer.
  const verifyAction = (
    <>
      <Button className="w-full" disabled={!canVerify || verify.isPending} onClick={() => verify.mutate()}>
        <Check className="h-4 w-4" />
        {verify.isPending ? "Verifying…" : overTol ? "Verify with exception" : "Verify deposit"}
      </Button>
      {!canVerify && <div className="mt-2 text-center text-[11px] text-zinc-400">Complete all three items to verify.</div>}
    </>
  );

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Deposit Validation</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Validate next-day deposit</h2>
        <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
          Confirm the bank credited the deposit, attach the stamped slip, and record anything carried forward from the DSR.
        </p>
      </div>

      {/* Pending-deposits picker — only shown when more than one deposit is
          awaiting verification (e.g. a Friday deposit still uncredited when
          Monday's lands). Oldest first so the eldest unprocessed one gets
          attention. */}
      {multiPending && (
        <Card className="mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-5 py-3">
            <div>
              <div className="text-sm font-semibold text-midnight">{deposits.length} deposits awaiting validation</div>
              <div className="text-xs text-zinc-500">Banks can take 2–3 days to credit, especially over weekends.</div>
            </div>
            <Pill tone="amber" dot>Oldest first</Pill>
          </div>
          <ul className="divide-y divide-zinc-100">
            {deposits.map((d) => {
              const isActive = d.id === dep.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition",
                      isActive ? "bg-emerald-50" : "hover:bg-zinc-50"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-midnight">{d.code}</span>
                        <span className="text-xs text-zinc-500">· {d.for_date}</span>
                        {isActive && <Pill tone="green" dot>Validating</Pill>}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">Closed by {d.closed_by}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Expected</div>
                      <div className="font-semibold tabular-nums text-midnight">{usd(d.expected_cents)}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-midnight">
              Deposit <span className="font-mono">{dep.code}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-zinc-500">
              Closeout {dep.for_date} · by {dep.closed_by}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Expected at bank</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-midnight">{usd(dep.expected_cents)}</div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* slip photo */}
        <Card className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <Camera className="h-4 w-4 text-zinc-500" />
            <div className="text-sm font-semibold text-midnight">Deposit slip photo</div>
            <span className="font-bold text-red-600">*</span>
          </div>
          <div className="mb-3.5 text-xs text-zinc-500">Attach the bank-stamped slip — JPG, PNG, or PDF up to 10 MB.</div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={cn(
              "grid h-64 w-full place-items-center rounded-xl border-[1.5px] border-dashed text-sm transition",
              slipPath ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-zinc-300 bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
            )}
          >
            <div className="flex flex-col items-center gap-2">
              {slipPath ? <Check className="h-7 w-7" /> : <Camera className="h-7 w-7" />}
              <div>{uploading ? "Uploading…" : slipPath ? "Slip attached" : "Click to attach slip photo"}</div>
            </div>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onPick} />
          <div className={cn("mt-3 flex items-center gap-2 text-xs", slipPath ? "text-emerald-700" : "text-zinc-400")}>
            <Camera className="h-3.5 w-3.5" />
            {slipPath ? `${slipName ?? "Slip"} — captured to the audit log.` : "No slip attached yet."}
          </div>
        </Card>

        {/* bank credit + carried + verify */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-4 text-sm font-semibold text-midnight">Bank confirmation</div>
            <label className="mb-3.5 block">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Amount credited by bank <span className="text-red-600">*</span>
              </div>
              <MoneyInput value={bankCredit} onChange={setBankCredit} accent={overTol ? "red" : undefined} placeholder="0.00" />
            </label>

            {hasBank && (
              <div
                className={cn(
                  "mb-3.5 flex items-center justify-between rounded-md px-3.5 py-2.5 ring-1 ring-inset",
                  matched ? "bg-emerald-50 ring-emerald-200" : "bg-red-50 ring-red-200"
                )}
              >
                <span className={cn("text-[13px] font-semibold", matched ? "text-emerald-700" : "text-red-700")}>
                  {Math.abs(variance) < 1 ? "Exact match" : `${matched ? "Within tolerance" : "Over tolerance"} · ${usd(variance, { signed: true })}`}
                </span>
                <Pill tone={matched ? "green" : "red"} dot>
                  {matched ? "Match" : "Mismatch"}
                </Pill>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Carried over from DSR</span>
                <InfoDot label="What is carried over?">
                  <strong className="font-semibold text-zinc-700">Carried Over (Micros DSR)</strong> — open guest checks/tabs
                  from the prior business day still open when today began: a <em>count</em> and their <em>dollar value</em>.
                  High carryover can flag checks left open (drive-thru voids not completed, training/system issues) and
                  shrinkage exposure. Carried-over dollars aren't new sales, so they're reconciled separately.
                </InfoDot>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] text-zinc-500">Open checks (count)</div>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={carriedCount}
                    placeholder="0"
                    onChange={(e) => setCarriedCount(e.target.value)}
                    className="block w-full rounded-md border-0 bg-white px-3 py-2.5 text-lg font-semibold tabular-nums ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-zinc-500">Open-check dollars</div>
                  <MoneyInput value={carriedDollars} onChange={setCarriedDollars} placeholder="0.00" />
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-zinc-400">
                Enter the open checks carried over from yesterday's DSR — leave at 0 if none.
              </div>

              {hasCarry && (
                <div className="mt-3 rounded-md bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
                  <label className="flex items-start gap-2.5 text-[13px] text-amber-900">
                    <input
                      type="checkbox"
                      checked={carriedAck}
                      onChange={(e) => setCarriedAck(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-300 text-accent focus:ring-accent"
                    />
                    <span>
                      I've <strong>recorded and addressed</strong> these carried-over open checks.{" "}
                      <span className="font-normal text-amber-700">A discrepancy alert also goes to the DO &amp; SDO to review.</span>
                    </span>
                  </label>
                  <textarea
                    value={carriedNote}
                    onChange={(e) => setCarriedNote(e.target.value)}
                    rows={2}
                    placeholder="Optional — checks involved / how it was addressed…"
                    className="mt-2 block w-full resize-y rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-amber-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              )}
            </div>

            {overTol && (
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Mismatch reason <span className="text-red-600">*</span>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Bank credit differs from expected — explain (min 8 chars)…"
                  className="block w-full resize-y rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Before you verify</div>
            <div className="mt-2.5 border-t border-zinc-100">
              <CheckRow done={hasBank} label="Bank credit entered" sub="Amount the bank actually received" />
              <CheckRow
                done={matched || (overTol && reason.trim().length >= 8)}
                label="Amount reconciled"
                sub={overTol ? "Mismatch reason required" : `Within ${usd(tol)} tolerance`}
              />
              <CheckRow done={!!slipPath} label="Deposit slip attached" sub="Stamped slip photo on file" />
              {hasCarry && (
                <CheckRow done={carriedAck} label="Carried-over addressed" sub="Recorded; alert raised to DO/SDO" />
              )}
            </div>
            {!actionSlot && <div className="mt-4">{verifyAction}</div>}
          </Card>
        </div>
      </div>
      {actionSlot ? createPortal(verifyAction, actionSlot) : null}
    </div>
  );
}
