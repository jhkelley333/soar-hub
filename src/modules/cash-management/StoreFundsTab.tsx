// Store Funds (the "Bank") — DO-and-above validation of each store's on-hand
// cash Bank, due in week 1 of every 4-week period. Roll-up + per-store
// denomination count + reconcile-to-Bank with $5 escalation to the SDO, a P&L
// CSV, the month-to-month DO metric, and an admin Bank-amount importer.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BarChart3, Banknote, Check, Download, Loader2, Minus, Plus, Upload } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { toCSV, downloadCSV, parseCSV } from "@/lib/csv";
import { fetchFundOverview, fetchFundMetrics, submitFundValidation, setStoreBanks } from "./api";
import { usd, toCents, centsToInput } from "./money";
import type { FundStoreRow } from "./types";

type Mode = { v: "list" } | { v: "validate"; store: FundStoreRow; offCycle?: boolean } | { v: "metrics" } | { v: "banks" };

export function StoreFundsTab() {
  const [mode, setMode] = useState<Mode>({ v: "list" });
  const q = useQuery({ queryKey: ["fund-overview"], queryFn: fetchFundOverview });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <EmptyState title="Couldn't load Store Funds" description={(q.error as Error)?.message ?? "Make sure migration 0173 has run."} />;
  const data = q.data;

  if (mode.v === "metrics") return <MetricsPanel onBack={() => setMode({ v: "list" })} />;
  if (mode.v === "banks") return <BanksPanel stores={data.stores} onBack={() => setMode({ v: "list" })} />;
  if (mode.v === "validate") return <ValidatePanel store={mode.store} toleranceCents={data.toleranceCents} offCycle={!!mode.offCycle} onBack={() => setMode({ v: "list" })} />;

  const r = data.rollup;
  return (
    <div className="space-y-5">
      {/* period banner */}
      {data.period && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-midnight px-5 py-3 text-white">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-white/60">This period</div>
            <div className="text-lg font-semibold">Period {data.period.period} · Week {data.period.weekInPeriod}</div>
          </div>
          <div className="text-sm text-white/75">DOs validate every store's Bank in <span className="font-semibold text-white">week 1</span>.</div>
        </div>
      )}

      {/* rollup tiles */}
      {r && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Tile label="Stores" value={`${r.bank_set_count} / ${r.store_count}`} sub="with a Bank set" />
          <Tile label="Validated this period" value={String(r.validated_this_period)} sub={`${r.due} still due`} tone={r.due > 0 ? "warn" : "ok"} />
          <Tile label="Due" value={String(r.due)} sub="not yet counted" tone={r.due > 0 ? "warn" : "ok"} />
          <Tile label="Over tolerance" value={String(r.over_tolerance)} sub="last count" tone={r.over_tolerance > 0 ? "bad" : "ok"} />
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-midnight">Stores</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => exportPnl(data.stores)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent">
            <Download className="h-4 w-4" /> P&amp;L CSV
          </button>
          <button type="button" onClick={() => setMode({ v: "metrics" })} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent">
            <BarChart3 className="h-4 w-4" /> DO metrics
          </button>
          {data.is_admin && (
            <button type="button" onClick={() => setMode({ v: "banks" })} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent">
              <Banknote className="h-4 w-4" /> Bank amounts
            </button>
          )}
        </div>
      </div>

      {/* store list */}
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-zinc-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 sm:grid">
          <span>Store</span><span className="text-right">Bank</span><span className="text-right">Last count</span><span className="text-right">Variance</span><span className="text-right">Status</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {data.stores.map((s) => (
            <FundRow
              key={s.store_id}
              row={s}
              canValidate={data.can_validate}
              onValidate={() => setMode({ v: "validate", store: s })}
              onOffCycleAudit={() => setMode({ v: "validate", store: s, offCycle: true })}
            />
          ))}
          {data.stores.length === 0 && <div className="p-8 text-center text-sm text-zinc-500">No stores in your scope.</div>}
        </div>
      </div>
    </div>
  );
}

function exportPnl(stores: FundStoreRow[]) {
  const rows = stores.map((s) => ({
    "Store #": s.store_number,
    Store: s.store_name ?? "",
    "Bank Amount": s.bank_amount_cents != null ? (s.bank_amount_cents / 100).toFixed(2) : "",
    "Actual DO Validation": s.last ? (s.last.counted_cents / 100).toFixed(2) : "",
    Variance: s.last ? (s.last.variance_cents / 100).toFixed(2) : "",
    "Last Counted": s.last ? new Date(s.last.validated_at).toLocaleDateString() : "Never",
    "Counted By": s.last?.by ?? "",
  }));
  const headers = ["Store #", "Store", "Bank Amount", "Actual DO Validation", "Variance", "Last Counted", "Counted By"];
  downloadCSV(`store-funds-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(headers, rows));
}

function FundRow({
  row,
  canValidate,
  onValidate,
  onOffCycleAudit,
}: {
  row: FundStoreRow;
  canValidate: boolean;
  onValidate: () => void;
  onOffCycleAudit: () => void;
}) {
  // Counts shown in the row's amount/variance columns come from the most
  // recent count of any kind. The locked-subtitle text reuses the latest
  // REQUIRED validation so an off-cycle audit can't fake compliance.
  const over = row.last?.over_tolerance;
  const required = row.last_required;
  const subtitle = !row.bank_set
    ? "No Bank set"
    : row.validated_this_period && required
      ? `Validated ${fmtValidatedAt(required.validated_at)}${required.by ? ` by ${required.by}` : ""}`
      : "Due this period";
  const offCycleNote = row.last_off_cycle
    ? `Last off-cycle audit ${fmtValidatedAt(row.last_off_cycle.validated_at)}${row.last_off_cycle.by ? ` by ${row.last_off_cycle.by}` : ""}`
    : null;

  // Confirm re-counts that would replace the required validation. Off-cycle
  // audits don't replace anything, so they go straight through.
  const onClickValidate = () => {
    if (row.validated_this_period) {
      const ok = window.confirm(
        `Re-count this store's Bank? The previous validation will be replaced.\n\n#${row.store_number}${row.store_name ? ` · ${row.store_name}` : ""}`,
      );
      if (!ok) return;
    }
    onValidate();
  };

  return (
    <div className="grid grid-cols-1 items-center gap-2 p-4 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:gap-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-midnight">#{row.store_number}{row.store_name ? ` · ${row.store_name}` : ""}</div>
        <div className="truncate text-xs text-zinc-500">{subtitle}</div>
        {offCycleNote && <div className="truncate text-[11px] text-amber-700">{offCycleNote}</div>}
      </div>
      <div className="text-right text-sm font-semibold tabular-nums text-midnight sm:w-24">{row.bank_amount_cents != null ? usd(row.bank_amount_cents) : "—"}</div>
      <div className="text-right text-sm tabular-nums text-zinc-600 sm:w-24">{row.last ? usd(row.last.counted_cents) : "—"}</div>
      <div className={cn("text-right text-sm font-semibold tabular-nums sm:w-24", over ? "text-red-600" : "text-zinc-600")}>{row.last ? usd(row.last.variance_cents, { signed: true }) : "—"}</div>
      <div className="flex flex-col items-end gap-1.5 sm:w-32">
        {canValidate ? (
          row.validated_this_period ? (
            // Locked look — click confirms re-count.
            <>
              <button
                type="button"
                onClick={onClickValidate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                title="Validated this period — click to re-count"
              >
                <Check className="h-3.5 w-3.5" /> Validated
              </button>
              <button
                type="button"
                onClick={onOffCycleAudit}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-50"
                title="Surprise audit — does not replace the required validation"
              >
                <AlertTriangle className="h-3 w-3" /> Off-cycle audit
              </button>
            </>
          ) : (
            <button type="button" onClick={onClickValidate} disabled={!row.bank_set} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40" title={row.bank_set ? "" : "Set this store's Bank amount first"}>
              Validate
            </button>
          )
        ) : (
          <StatusPill row={row} />
        )}
      </div>
    </div>
  );
}

// "Jun 29 at 12:34 PM" — short, unambiguous, no year for current-period reads.
function fmtValidatedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function StatusPill({ row }: { row: FundStoreRow }) {
  if (!row.bank_set) return <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-500">No Bank</span>;
  if (row.last?.over_tolerance) return <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">Over</span>;
  if (row.validated_this_period) return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Done</span>;
  return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Due</span>;
}

function Tile({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "neutral" | "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-midnight";
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums", color)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

// ── Validate one store ────────────────────────────────────────────────────────
function ValidatePanel({ store, toleranceCents, offCycle = false, onBack }: { store: FundStoreRow; toleranceCents: number; offCycle?: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  // Adding-machine tape: count a drawer / carhop bank / cash box, hit +
  // (or Enter), the amount is banked on the tape and the input clears for
  // the next one.
  const [drawers, setDrawers] = useState<number[]>([]);
  const [drawerDraft, setDrawerDraft] = useState("");
  const [reason, setReason] = useState("");
  const bank = store.bank_amount_cents ?? 0;
  const drawerTotal = useMemo(() => drawers.reduce((t, c) => t + c, 0), [drawers]);
  const counted = drawerTotal;
  const variance = counted - bank;
  const over = Math.abs(variance) > toleranceCents;
  const addDrawer = () => {
    const cents = toCents(drawerDraft);
    if (cents <= 0) return;
    setDrawers((d) => [...d, cents]);
    setDrawerDraft("");
  };

  const submit = useMutation({
    mutationFn: () => submitFundValidation({
      store_number: store.store_number, counted_cents: counted,
      denominations: drawers.length ? { drawer_amounts_cents: drawers } : {},
      reason: reason.trim() || undefined,
      is_off_cycle: offCycle || undefined,
    }),
    onSuccess: (r) => {
      const label = offCycle ? "Off-cycle audit recorded" : "Bank validated — on chart";
      toast.push(r.over_tolerance ? `${label} & escalated${r.alerted ? ` to ${r.alerted}` : ""}.` : `${label}.`, "success");
      qc.invalidateQueries({ queryKey: ["fund-overview"] });
      onBack();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> All stores</button>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
          Petty Cash · Store Bank{offCycle && " · Off-cycle audit"}
        </div>
        <h2 className="text-xl font-semibold text-midnight">
          {offCycle ? "Off-cycle audit" : "Validate"} #{store.store_number}{store.store_name ? ` · ${store.store_name}` : ""}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">Count the store cash Bank and confirm it still equals its {usd(bank)} Bank. Shortages or overages above {usd(toleranceCents)} escalate to the SDO.</p>
      </div>

      {offCycle && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>This won&apos;t replace the required monthly validation.</strong> Surprise audits are recorded separately so the period&apos;s "Validated" status stays intact.
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* count */}
        <div className="rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="flex items-center justify-between border-b border-zinc-100 p-4">
            <h3 className="text-sm font-semibold text-midnight">Bank count</h3>
            <button type="button" onClick={() => { setDrawers([]); setDrawerDraft(""); }} className="text-xs font-semibold text-accent hover:underline">Reset</button>
          </div>

          {/* adding-machine drawer counter */}
          <div className="border-b border-zinc-100 bg-zinc-50/60 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Drawer / Carhop Bank / Cash Box</div>
            <p className="mt-0.5 text-xs text-zinc-500">Count each drawer, carhop bank, or cash box, type its total, hit <span className="font-semibold">+</span> (or Enter) — it's saved to the tape and you move to the next one.</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                <input
                  value={drawerDraft}
                  onChange={(e) => setDrawerDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDrawer(); } }}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="h-9 w-full rounded-lg border border-zinc-200 pl-7 pr-3 text-sm tabular-nums focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={addDrawer}
                disabled={toCents(drawerDraft) <= 0}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-white hover:brightness-110 disabled:opacity-40"
                aria-label="Add count"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            {drawers.length > 0 && (
              <div className="mt-2 space-y-1">
                {drawers.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-500">Count {i + 1}</span>
                    <span className="flex-1 border-b border-dotted border-zinc-200" />
                    <span className="font-semibold tabular-nums text-midnight">{usd(c)}</span>
                    <button
                      type="button"
                      onClick={() => setDrawers((d) => d.filter((_, j) => j !== i))}
                      className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                      aria-label={`Remove count ${i + 1}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5 text-sm">
                  <span className="font-semibold text-zinc-600">{drawers.length} count{drawers.length === 1 ? "" : "s"}</span>
                  <span className="font-bold tabular-nums text-midnight">{usd(drawerTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-midnight">Counted total</span>
              <span className="text-lg font-bold tabular-nums text-midnight">{usd(counted)}</span>
            </div>
          </div>
        </div>

        {/* reconcile */}
        <div className="space-y-3 rounded-xl bg-white p-5 ring-1 ring-zinc-200">
          <h3 className="text-sm font-semibold text-midnight">Reconcile to Bank</h3>
          <div className="flex items-center justify-between text-sm text-zinc-500"><span>{usd(counted)} counted</span><span>− {usd(bank)} Bank</span></div>
          <div className={cn("rounded-xl p-4", over ? "bg-red-50" : "bg-emerald-50")}>
            <div className="flex items-center justify-between">
              <span className={cn("text-[11px] font-semibold uppercase tracking-wide", over ? "text-red-700" : "text-emerald-700")}>Variance</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", over ? "bg-white text-red-700" : "bg-white text-emerald-700")}>{over ? "Over tolerance" : "On chart"}</span>
            </div>
            <div className={cn("mt-1 text-3xl font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{usd(variance, { signed: true })}</div>
            <div className={cn("mt-1 text-xs", over ? "text-red-700" : "text-emerald-700")}>{over ? `Exceeds the ${usd(toleranceCents)} tolerance — escalation required.` : "Within tolerance."}</div>
          </div>
          {over && (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><AlertTriangle className="h-4 w-4" /> Validating will alert the store's SDO.</div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Variance reason *</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Store Bank off vs. assigned — explain (min 8 chars)…" className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-accent focus:outline-none" />
              </label>
            </>
          )}
          <button type="button" onClick={() => submit.mutate()} disabled={submit.isPending || counted === 0 || (over && reason.trim().length < 8)} className={cn("flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40", over ? "bg-red-500 hover:brightness-110" : "bg-emerald-600 hover:brightness-110")}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {over ? "Validate & escalate" : "Validate"}
          </button>
          {over && reason.trim().length < 8 && <p className="text-center text-xs text-red-600">A reason is required to escalate.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Month-to-month DO metrics ─────────────────────────────────────────────────
function MetricsPanel({ onBack }: { onBack: () => void }) {
  const q = useQuery({ queryKey: ["fund-metrics"], queryFn: fetchFundMetrics });
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> All stores</button>
      <div>
        <h2 className="text-xl font-semibold text-midnight">DO validation metrics</h2>
        <p className="mt-1 text-sm text-zinc-500">Month-to-month (by 4-week period): on-time completion, count vs due, variance, and speed.</p>
      </div>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !q.data ? (
        <EmptyState title="Couldn't load metrics" description={(q.error as Error)?.message ?? "Try again."} />
      ) : q.data.periods.length === 0 ? (
        <EmptyState title="No validations yet" description="Metrics appear once DOs start validating store Banks." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-zinc-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-2">Period</th><th className="px-4 py-2 text-right">On-time %</th><th className="px-4 py-2 text-right">Done / Due</th><th className="px-4 py-2 text-right">Avg days</th><th className="px-4 py-2 text-right">Total variance</th><th className="px-4 py-2 text-right">Avg variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {q.data.periods.map((p) => (
                <tr key={p.period}>
                  <td className="px-4 py-2.5 font-semibold text-midnight">Period {p.period}</td>
                  <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", p.on_time_pct >= 90 ? "text-emerald-600" : p.on_time_pct >= 60 ? "text-amber-600" : "text-red-600")}>{p.on_time_pct}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{p.validated} / {p.due}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{p.avg_days_to_validate ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{usd(p.total_variance_cents)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{usd(p.avg_abs_variance_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Admin: import/set Bank amounts ────────────────────────────────────────────
function BanksPanel({ stores, onBack }: { stores: FundStoreRow[]; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");

  const parsed = useMemo(() => {
    const rows = parseCSV(text.trim());
    const out: { store_number: string; bank_amount_cents: number }[] = [];
    for (const r of rows) {
      const num = String(r[0] ?? "").replace(/[^0-9]/g, "").trim();
      const amt = String(r[1] ?? "").trim();
      if (!num || !amt) continue;
      out.push({ store_number: num, bank_amount_cents: toCents(amt) });
    }
    return out;
  }, [text]);

  const save = useMutation({
    mutationFn: () => setStoreBanks(parsed),
    onSuccess: (r) => {
      toast.push(`Saved ${r.updated} Bank amount${r.updated === 1 ? "" : "s"}.${r.unknown.length ? ` Skipped unknown: ${r.unknown.join(", ")}` : ""}`, r.unknown.length ? "info" : "success");
      qc.invalidateQueries({ queryKey: ["fund-overview"] });
      if (!r.unknown.length) onBack();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> All stores</button>
      <div>
        <h2 className="text-xl font-semibold text-midnight">Bank amounts</h2>
        <p className="mt-1 text-sm text-zinc-500">Paste rows of <code className="rounded bg-zinc-100 px-1">store#, amount</code> (one per line) or upload a CSV. Unknown store numbers are skipped and reported.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={"4521, 200\n4533, 250\n4540, 150.00"} className="block w-full rounded-lg border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent">
              <Upload className="h-4 w-4" /> Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setText); }} />
            </label>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending || parsed.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save {parsed.length || ""} {parsed.length === 1 ? "amount" : "amounts"}
            </button>
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">Preview ({parsed.length})</div>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {parsed.slice(0, 50).map((p, i) => (
              <div key={i} className="flex justify-between text-sm"><span className="text-zinc-600">#{p.store_number}</span><span className="font-semibold tabular-nums text-midnight">{centsToInput(p.bank_amount_cents)}</span></div>
            ))}
            {parsed.length === 0 && <p className="text-sm text-zinc-400">Nothing parsed yet.</p>}
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">{stores.filter((s) => s.bank_set).length} of {stores.length} stores currently have a Bank set.</p>
        </div>
      </div>
    </div>
  );
}
