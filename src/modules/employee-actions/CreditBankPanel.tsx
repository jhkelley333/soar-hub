// Training credit bank — the per-store register. Every store starts the year
// with $2,000 (admin can override per store); submitted requests draw it down
// and the remaining balance shows here. Admins record manual adjustments
// (positive = historical use, negative = credit back) and set budgets.
// Click a store to open its ledger.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  adjustCredit, fetchCreditLedger, fetchCreditRegister, fetchGmPtoRate, setCreditBudget, setGmPtoRate,
  type CreditRegisterRow,
} from "./api";

const money = (n: number) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";

type SortKey = "store" | "budget" | "used" | "remaining";

export function CreditBankPanel() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [open, setOpen] = useState<CreditRegisterRow | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "store", dir: 1 });
  const q = useQuery({ queryKey: ["ea-credit-register", year], queryFn: () => fetchCreditRegister(year) });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "store" ? 1 : -1 }));

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = (q.data?.rows ?? []).filter((r) =>
      !needle || r.store_number.includes(needle) || (r.store_name ?? "").toLowerCase().includes(needle));
    const val = (r: CreditRegisterRow) =>
      sort.key === "store" ? parseInt(r.store_number, 10) || 0
        : sort.key === "budget" ? r.budget
        : sort.key === "used" ? r.used
        : r.remaining;
    return [...filtered].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [q.data, filter, sort]);

  const totals = useMemo(() => {
    const all = q.data?.rows ?? [];
    return {
      budget: all.reduce((s, r) => s + r.budget, 0),
      used: all.reduce((s, r) => s + r.used, 0),
      remaining: all.reduce((s, r) => s + r.remaining, 0),
    };
  }, [q.data]);

  return (
    <Card>
      <CardBody>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <Landmark className="h-4 w-4 text-accent" /> Training credit bank
          </div>
          <div className="flex items-center gap-1.5">
            {[thisYear - 1, thisYear].map((y) => (
              <button key={y} onClick={() => setYear(y)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  year === y ? "bg-midnight text-white" : "border border-border bg-surface text-ink-2 hover:border-accent")}>
                {y}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 max-w-2xl text-[13px] text-ink-muted">
          Every store starts the year with {money(q.data?.default_budget ?? 2000)}. Requests draw it down the moment they're submitted
          (rejected and withdrawn give it back). Click a store for its ledger{q.data?.can_adjust ? " — adjustments and budget changes live there" : ""}.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] text-ink-muted">
          <span>Budget <strong className="tabular-nums text-heading">{money(totals.budget)}</strong></span>
          <span>Used <strong className="tabular-nums text-heading">{money(totals.used)}</strong></span>
          <span>Remaining <strong className={cn("tabular-nums", totals.remaining < 0 ? "text-red-600" : "text-emerald-600")}>{money(totals.remaining)}</strong></span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter stores…"
            className={cn(FIELD, "ml-auto w-44")} />
        </div>

        {q.isLoading ? (
          <p className="py-8 text-center text-[13px] text-ink-subtle">Loading…</p>
        ) : q.isError ? (
          <EmptyState title="Couldn't load the register" description={(q.error as Error)?.message ?? "Try again."} />
        ) : rows.length === 0 ? (
          <EmptyState title="No stores" description="No stores in your scope." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                    <SortTh label="Store" k="store" sort={sort} onSort={toggleSort} />
                    <SortTh label="Budget" k="budget" sort={sort} onSort={toggleSort} right />
                    <SortTh label="Used" k="used" sort={sort} onSort={toggleSort} right />
                    <SortTh label="Remaining" k="remaining" sort={sort} onSort={toggleSort} right />
                    <th className="w-40 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const pct = r.budget > 0 ? Math.min(100, Math.round((r.used / r.budget) * 100)) : 100;
                    return (
                      <tr key={r.store_number} onClick={() => setOpen(r)} className="cursor-pointer transition hover:bg-surface-muted">
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-heading">#{r.store_number}</span>
                          {r.store_name && <span className="ml-2 text-ink-muted">{r.store_name}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{money(r.budget)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{money(r.used)}</td>
                        <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums",
                          r.remaining < 0 ? "text-red-600" : r.remaining < r.budget * 0.15 ? "text-amber-600" : "text-emerald-600")}>
                          {money(r.remaining)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunk">
                            <div className={cn("h-full rounded-full", pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-400" : "bg-emerald-500")}
                              style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {open && (
          <LedgerModal row={open} year={year} canAdjust={q.data?.can_adjust ?? false}
            canBudget={q.data?.can_budget ?? false} onClose={() => setOpen(null)} />
        )}

        {q.data?.can_budget && <GmPtoRateEditor />}
      </CardBody>
    </Card>
  );
}

// Admin: the GM PTO daily labor credit rate ($/day; a 5-day week = 5x this).
function GmPtoRateEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ea-gm-pto-rate"], queryFn: fetchGmPtoRate });
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (q.data ? String(q.data.amount) : "");
  const save = useMutation({
    mutationFn: () => setGmPtoRate(parseFloat(value)),
    onSuccess: (r) => {
      toast.push(`GM PTO credit set to ${money(r.amount)}/day (${money(r.amount * 5)}/week).`, "success");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["ea-gm-pto-rate"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error"),
  });

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface-muted p-3">
      <div className="text-[11px] font-semibold text-ink-muted">
        GM PTO daily labor credit — each approved PTO day credits the store's labor chart this amount
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-sm text-ink-muted">$</span>
        <input value={value} onChange={(e) => setDraft(e.target.value)} type="number" step="0.01" min="0"
          className={cn(FIELD, "w-28")} />
        <span className="text-xs text-ink-subtle">/ day · {money((parseFloat(value) || 0) * 5)} per 5-day week</span>
        <button onClick={() => save.mutate()} disabled={save.isPending || !parseFloat(value) || draft == null}
          className="rounded-lg bg-midnight px-3 py-2 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function SortTh({ label, k, sort, onSort, right }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={cn("px-3 py-2", right && "text-right")}>
      <button onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-0.5 uppercase tracking-wide transition hover:text-heading", active && "text-heading")}>
        {label}
        <span className={cn("text-[9px]", !active && "opacity-0")}>{sort.dir === 1 ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

function LedgerModal({ row, year, canAdjust, canBudget, onClose }: {
  row: CreditRegisterRow; year: number; canAdjust: boolean; canBudget: boolean; onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ea-credit-ledger", row.store_number, year], queryFn: () => fetchCreditLedger(row.store_number, year) });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ea-credit-ledger", row.store_number, year] });
    qc.invalidateQueries({ queryKey: ["ea-credit-register", year] });
  };
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const adjust = useMutation({
    mutationFn: () => adjustCredit({ store_number: row.store_number, year, amount: parseFloat(amount), note: note.trim() || undefined }),
    onSuccess: (r) => { toast.push(`Recorded — ${money(r.balance.remaining)} remaining.`, "success"); setAmount(""); setNote(""); refresh(); },
    onError: err,
  });
  const saveBudget = useMutation({
    mutationFn: () => setCreditBudget({ store_number: row.store_number, year, budget: parseFloat(budgetEdit ?? "") }),
    onSuccess: (r) => { toast.push(`Budget set — ${money(r.balance.remaining)} remaining.`, "success"); setBudgetEdit(null); refresh(); },
    onError: err,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-heading">#{row.store_number}{row.store_name ? ` · ${row.store_name}` : ""} — {year} ledger</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-subtle transition hover:bg-surface-sunk"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-4 text-[13px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            Budget <strong className="tabular-nums text-heading">{money(row.budget)}</strong>
            {canBudget && budgetEdit == null && (
              <button onClick={() => setBudgetEdit(String(row.budget))} title="Set this store's budget"
                className="rounded p-0.5 text-ink-subtle hover:text-heading"><Pencil className="h-3 w-3" /></button>
            )}
          </span>
          <span>Used <strong className="tabular-nums text-heading">{money(row.used)}</strong></span>
          <span>Remaining <strong className={cn("tabular-nums", row.remaining < 0 ? "text-red-600" : "text-emerald-600")}>{money(row.remaining)}</strong></span>
        </div>
        {budgetEdit != null && (
          <div className="mb-4 flex items-center gap-1.5">
            <input value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)} type="number" step="0.01" min="0" className={cn(FIELD, "w-32")} />
            <button onClick={() => saveBudget.mutate()} disabled={saveBudget.isPending || !budgetEdit}
              className="rounded-lg bg-midnight px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Set budget</button>
            <button onClick={() => setBudgetEdit(null)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-ink-2">Cancel</button>
          </div>
        )}

        {q.isLoading ? (
          <p className="py-6 text-center text-[13px] text-ink-subtle">Loading…</p>
        ) : (
          <>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Requests ({q.data?.requests.length ?? 0})</div>
            {(q.data?.requests.length ?? 0) === 0 ? (
              <p className="mb-3 text-sm text-ink-subtle">No requests counted for {year}.</p>
            ) : (
              <ul className="mb-3 divide-y divide-border rounded-xl border border-border">
                {q.data!.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-heading">{r.employee_name}</div>
                      <div className="text-xs text-ink-subtle">{r.training_type} · {r.status}{r.start_date ? ` · ${r.start_date}` : ""}</div>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-heading">−{money(r.requested_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Adjustments ({q.data?.adjustments.length ?? 0})</div>
            {(q.data?.adjustments.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-subtle">No manual adjustments.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {q.data!.adjustments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-heading">{a.note || "Manual adjustment"}</div>
                      <div className="text-xs text-ink-subtle">{new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                    <span className={cn("shrink-0 font-semibold tabular-nums", a.amount > 0 ? "text-heading" : "text-emerald-600")}>
                      {a.amount > 0 ? "−" : "+"}{money(Math.abs(a.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {canAdjust && (
          <div className="mt-4 rounded-xl border border-border bg-surface-muted p-3">
            <div className="mb-1.5 text-[11px] font-semibold text-ink-muted">
              Record what this store has already spent — positive deducts (historical use), negative gives credit back
            </div>
            <div className="flex items-start gap-1.5">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="850.00" className={cn(FIELD, "w-28")} />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note — e.g. H1 historical use" className={cn(FIELD, "min-w-0 flex-1")} />
              <button onClick={() => adjust.mutate()} disabled={adjust.isPending || !parseFloat(amount)}
                className="inline-flex items-center gap-1 rounded-lg bg-midnight px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> Record
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
