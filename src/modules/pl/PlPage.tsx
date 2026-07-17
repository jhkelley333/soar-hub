// /pl — store P&L statements. DO+ land on an overview table of their
// visible stores' headline metrics (Sales, CI $, CI %) for the selected
// period and drill into a store's full statement; a GM (single store)
// jumps straight to their statement. Admins get an Upload panel that
// parses the accounting side-by-side workbook in the browser (SheetJS,
// dynamically imported) and batch-saves via netlify/functions/pl.
//
// Flags review + notes write-back (Google Sheet column N) is the next
// phase and will slot into the statement view.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowUp, ArrowUpDown, Download, Loader2, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchPlCompare, fetchPlFlags, fetchPlOverview, fetchPlPeriods, fetchPlStatement, savePlFlagNote, uploadPl, type PlFlag } from "./api";
import type { ParsedWorkbook, PlCompareLine, PlLine, PlOverviewRow, PlStage } from "./types";

const money = (v: number | null | undefined, dp = 0) =>
  v == null
    ? "—"
    : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

type SortKey = "store" | "sales" | "ci" | "ci_pct" | "ebitda" | "notes";
type SortDir = "asc" | "desc";

export function PlPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [period, setPeriod] = useState<string>("");
  const [store, setStore] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "ci_pct", dir: "asc" });

  const periodsQ = useQuery({ queryKey: ["pl-periods"], queryFn: fetchPlPeriods });
  const periods = useMemo(() => periodsQ.data?.periods ?? [], [periodsQ.data]);
  useEffect(() => {
    if (!period && periods.length) setPeriod(periods[0].period_end);
  }, [period, periods]);

  const overviewQ = useQuery({
    queryKey: ["pl-overview", period],
    queryFn: () => fetchPlOverview(period),
    enabled: !!period,
    staleTime: 5 * 60_000,
  });
  const rows = useMemo(() => overviewQ.data?.rows ?? [], [overviewQ.data]);

  // Walkthrough-flag note status per store, for the Notes pill. Reflects
  // the CURRENT review sheet (flags are per-month) regardless of which P&L
  // period is selected. Quietly absent if the sheet isn't reachable.
  const flagsQ = useQuery({
    queryKey: ["pl-flags", "summary"],
    queryFn: () => fetchPlFlags(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const flagStats = useMemo(() => {
    const m = new Map<string, { total: number; noted: number }>();
    for (const s of flagsQ.data?.stores ?? []) {
      if (!s.flags.length) continue;
      const noted = s.flags.filter((f) => (f.note ?? "").trim().length > 0).length;
      m.set(s.store_number, { total: s.flags.length, noted });
    }
    return m;
  }, [flagsQ.data]);

  // Single-store viewers (GMs) jump straight into their statement.
  useEffect(() => {
    if (!store && rows.length === 1) setStore(rows[0].store_number);
  }, [store, rows]);

  const sorted = useMemo(() => {
    const val = (r: PlOverviewRow): number | string => {
      switch (sort.key) {
        case "store": return String(r.store_number);
        case "sales": return r.total_sales ?? -Infinity;
        case "ci": return r.ci_amount ?? -Infinity;
        case "ci_pct": return r.ci_pct ?? -Infinity;
        case "ebitda": return r.ebitda ?? -Infinity;
        case "notes": {
          const fs = flagStats.get(r.store_number);
          return fs ? fs.total - fs.noted : -1; // most notes owed first when desc
        }
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string, undefined, { numeric: true }) : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, flagStats]);

  const activePeriod = periods.find((p) => p.period_end === period);

  if (store && period) {
    return (
      <StatementView
        store={store}
        period={period}
        periodLabel={activePeriod ? periodDisplay(activePeriod.period_label, activePeriod.period_end, activePeriod.is_final) : period}
        onBack={rows.length > 1 ? () => setStore(null) : undefined}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="P&L"
        description="Store income statements — sales, controllable income, and the full statement per period."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {periods.length > 0 && (
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
              >
                {periods.map((p) => (
                  <option key={p.period_end} value={p.period_end}>
                    {periodDisplay(p.period_label, p.period_end, p.is_final)}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setUploadOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
              >
                <Upload className="h-4 w-4" strokeWidth={2} />
                Upload P&L
              </button>
            )}
          </div>
        }
      />

      {uploadOpen && isAdmin && <UploadPanel onDone={() => setUploadOpen(false)} />}

      {periodsQ.isLoading || (overviewQ.isLoading && !!period) ? (
        <Skeleton className="h-64 w-full" />
      ) : periods.length === 0 ? (
        <EmptyState
          title="No P&L uploaded yet"
          description={isAdmin ? "Use Upload P&L to load the first period from the accounting workbook." : "P&L data appears once accounting's statements are loaded."}
        />
      ) : overviewQ.isError ? (
        <EmptyState title="Couldn't load P&L" description={(overviewQ.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="No statements for your stores" description="This period has no P&L rows for stores in your scope." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <Th label="Store" k="store" sort={sort} onSort={setSort} />
                  <Th label="Sales" k="sales" sort={sort} onSort={setSort} right />
                  <Th label="CI $" k="ci" sort={sort} onSort={setSort} right />
                  <Th label="CI %" k="ci_pct" sort={sort} onSort={setSort} right />
                  <Th label="EBITDA" k="ebitda" sort={sort} onSort={setSort} right />
                  <Th label="Notes" k="notes" sort={sort} onSort={setSort} right />
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((r) => (
                  <tr key={r.store_number} className="cursor-pointer hover:bg-zinc-50" onClick={() => setStore(r.store_number)}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-midnight">#{r.store_number}</span>
                      <span className="ml-2 text-zinc-500">{r.store_name ?? ""}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-midnight">{money(r.total_sales)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", (r.ci_amount ?? 0) < 0 ? "text-red-600" : "text-midnight")}>{money(r.ci_amount)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", (r.ci_pct ?? 0) < 0 ? "text-red-600" : "text-emerald-700")}>{pct(r.ci_pct)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", (r.ebitda ?? 0) < 0 ? "text-red-600" : "text-zinc-600")}>{money(r.ebitda)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <NotesPill stats={flagStats.get(r.store_number)} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-accent">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function periodDisplay(label: string | null, end: string, isFinal: boolean): string {
  return `${label ?? end}${isFinal ? " · Final" : " · Prelim"}`;
}

// Walkthrough-flag note status: amber while notes are owed, green once
// every flag has one. No pill when the store has no flags this period.
function NotesPill({ stats }: { stats?: { total: number; noted: number } }) {
  if (!stats || stats.total === 0) return <span className="text-xs text-zinc-300">—</span>;
  const needed = stats.total - stats.noted;
  if (needed > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
        {needed} note{needed === 1 ? "" : "s"} needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      {stats.noted} noted
    </span>
  );
}

function Th({ label, k, sort, onSort, right }: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-4 py-2", right && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "store" ? "asc" : "desc" })}
        className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide hover:text-zinc-600", right && "flex-row-reverse", active && "text-accent")}
      >
        {label}
        <Icon className={cn("h-2.5 w-2.5", !active && "opacity-40")} />
      </button>
    </th>
  );
}

// ── One store's full statement ───────────────────────────────────────
function StatementView({ store, period, periodLabel, onBack }: {
  store: string;
  period: string;
  periodLabel: string;
  onBack?: () => void;
}) {
  // undefined = "auto" (Final when it exists, else Prelim). A toggle forces one.
  const [stage, setStage] = useState<PlStage | undefined>(undefined);
  const [compareOpen, setCompareOpen] = useState(false);

  const q = useQuery({
    queryKey: ["pl-statement", store, period, stage ?? "auto"],
    queryFn: () => fetchPlStatement(store, period, stage),
    staleTime: 5 * 60_000,
  });
  const s = q.data?.statement;
  const available = q.data?.available;
  const bothStages = !!(available?.prelim && available?.final);

  if (compareOpen) {
    return (
      <CompareView store={store} period={period} periodLabel={periodLabel} onBack={() => setCompareOpen(false)} />
    );
  }

  return (
    <>
      {onBack && (
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
          <ArrowLeft className="h-4 w-4" /> All stores
        </button>
      )}
      <PageHeader
        title={s ? `#${s.store_number}${s.store_name ? ` · ${s.store_name}` : ""}` : `#${store}`}
        description={`Income statement · ${periodLabel}${s?.uploaded_by_name ? ` · uploaded by ${s.uploaded_by_name}` : ""}`}
        actions={
          bothStages ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200">
                {(["prelim", "final"] as PlStage[]).map((st) => {
                  const activeStage = (s?.stage ?? "final") === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStage(st)}
                      className={cn(
                        "px-3 py-1.5 text-sm font-semibold capitalize transition",
                        activeStage ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
              >
                <ArrowLeftRight className="h-4 w-4" strokeWidth={2} />
                Compare Prelim → Final
              </button>
            </div>
          ) : s ? (
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
              s.stage === "final" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200",
            )}>
              {s.stage === "final" ? "Final" : "Prelim"} only
            </span>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !s ? (
        <EmptyState title="Couldn't load this statement" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (
        <div className="space-y-5">
          {/* Hero metrics — the focus numbers. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Total Sales" value={money(s.total_sales)} tone="neutral" />
            <Tile label="Controllable Income $" value={money(s.ci_amount)} tone={(s.ci_amount ?? 0) < 0 ? "bad" : "ok"} />
            <Tile label="Controllable Income %" value={pct(s.ci_pct)} tone={(s.ci_pct ?? 0) < 0 ? "bad" : "ok"} />
          </div>

          {/* Walkthrough flags + notes — write back to the review sheet. */}
          <FlagsSection store={store} />

          {/* Full statement */}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-zinc-100 px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              <span>Line</span><span className="w-28 text-right">$</span><span className="w-20 text-right">% Sales</span>
            </div>
            <div>
              {s.lines.map((l, i) => (
                <LineRow key={`${l.label}-${i}`} line={l} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Prelim → Final side-by-side comparison ───────────────────────────
function CompareView({ store, period, periodLabel, onBack }: {
  store: string;
  period: string;
  periodLabel: string;
  onBack: () => void;
}) {
  const [changedOnly, setChangedOnly] = useState(false);
  const q = useQuery({
    queryKey: ["pl-compare", store, period],
    queryFn: () => fetchPlCompare(store, period),
    staleTime: 5 * 60_000,
  });
  const c = q.data;

  const rows = useMemo(
    () => (c ? (changedOnly ? c.lines.filter((l) => l.changed) : c.lines) : []),
    [c, changedOnly],
  );

  function exportCsv() {
    if (!c) return;
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Line", "Prelim $", "Final $", "Δ $", "Δ %", "Prelim %", "Final %"];
    const body = c.lines.map((l) => [
      l.label,
      l.prelim_amount ?? "",
      l.final_amount ?? "",
      l.delta ?? "",
      pctChange(l.prelim_amount, l.final_amount) ?? "",
      l.prelim_pct ?? "",
      l.final_pct ?? "",
    ]);
    const csv = [head, ...body].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pl-compare-${store}-${period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Back to statement
      </button>
      <PageHeader
        title={c ? `#${c.store_number}${c.store_name ? ` · ${c.store_name}` : ""} — Prelim → Final` : `#${store} — Prelim → Final`}
        description={`What changed between Preliminary and Final · ${periodLabel}`}
        actions={
          c ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
                Changed lines only ({c.changed_count})
              </label>
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent"
              >
                <Download className="h-4 w-4" strokeWidth={2} /> Export CSV
              </button>
            </div>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !c ? (
        <EmptyState
          title="Couldn't compare"
          description={(q.error as Error)?.message ?? "Both a Preliminary and a Final P&L are required."}
        />
      ) : (
        <div className="space-y-5">
          {/* Headline movers */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MoverTile label="Total Sales" d={c.headline.total_sales} />
            <MoverTile label="Gross Profit" d={c.headline.gross_profit} />
            <MoverTile label="CI $" d={c.headline.ci_amount} />
            <MoverTile label="CI %" d={c.headline.ci_pct} isPct />
            <MoverTile label="EBITDA" d={c.headline.ebitda} />
          </div>

          {/* Line-by-line */}
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400">
                    <th className="px-5 py-2 text-left">Line</th>
                    <th className="px-3 py-2 text-right">Prelim</th>
                    <th className="px-3 py-2 text-right">Final</th>
                    <th className="px-3 py-2 text-right">Δ $</th>
                    <th className="px-5 py-2 text-right">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l, i) => (
                    <CompareRow key={`${l.label}-${i}`} line={l} />
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-zinc-400">No changed lines — Prelim and Final match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// % change of a line from prelim to final (relative to prelim), or null.
function pctChange(prelim: number | null, final: number | null): number | null {
  if (prelim == null || final == null || prelim === 0) return null;
  return ((final - prelim) / Math.abs(prelim)) * 100;
}

function CompareRow({ line }: { line: PlCompareLine }) {
  const changed = line.changed;
  const up = (line.delta ?? 0) > 0;
  const pc = pctChange(line.prelim_amount, line.final_amount);
  return (
    <tr className={cn("border-b border-zinc-50", line.total && "bg-zinc-50 font-bold text-midnight", changed && !line.total && "bg-amber-50/40")}>
      <td className={cn("px-5 py-1.5", !line.total && "pl-8 text-zinc-700")}>{line.label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{money(line.prelim_amount, 2)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-midnight">{money(line.final_amount, 2)}</td>
      <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold", !changed ? "text-zinc-300" : up ? "text-emerald-700" : "text-red-600")}>
        {line.delta == null ? "—" : `${up ? "+" : "−"}${money(Math.abs(line.delta), 2).replace(/^−/, "")}`}
      </td>
      <td className={cn("px-5 py-1.5 text-right tabular-nums", !changed ? "text-zinc-300" : up ? "text-emerald-700" : "text-red-600")}>
        {pc == null ? "—" : `${pc > 0 ? "+" : ""}${pc.toFixed(1)}%`}
      </td>
    </tr>
  );
}

function MoverTile({ label, d, isPct }: { label: string; d: { prelim: number | null; final: number | null; delta: number | null }; isPct?: boolean }) {
  const fmt = (v: number | null) => (v == null ? "—" : isPct ? pct(v) : money(v));
  const moved = d.delta != null && Math.abs(d.delta) >= (isPct ? 0.005 : 0.005);
  const up = (d.delta ?? 0) > 0;
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-midnight">{fmt(d.final)}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
        <span className="text-zinc-400">from {fmt(d.prelim)}</span>
        {moved && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-emerald-700" : "text-red-600")}>
            {up ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
            {up ? "+" : "−"}{isPct ? `${Math.abs(d.delta!).toFixed(2)} pts` : money(Math.abs(d.delta!)).replace(/^−/, "")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Flags for one store — from the walkthrough sheet, notes write back. ──
function FlagsSection({ store }: { store: string }) {
  const q = useQuery({
    queryKey: ["pl-flags", store],
    queryFn: () => fetchPlFlags(store),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Aggregate across every returned entry for this store — resilient to a
  // sheet layout that produces more than one entry per store number.
  const flags = (q.data?.stores ?? []).flatMap((s) => s.flags);

  // Quietly absent when the sheet has no flags for this store (or the
  // sheet integration isn't reachable) — the statement is the main event.
  if (q.isLoading || q.isError || !q.data?.period_end || flags.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-amber-900">
            Walkthrough flags ({flags.length})
          </div>
          <div className="text-xs text-amber-700">
            From the period review — add a note per flag; it saves here and writes back to the review
            sheet.
          </div>
        </div>
        <NotesPill
          stats={{ total: flags.length, noted: flags.filter((f) => (f.note ?? "").trim().length > 0).length }}
        />
      </div>
      <div className="divide-y divide-zinc-100">
        {flags.map((f) => (
          <FlagRow key={`${f.category}-${f.item}-${f.sheet_row}`} flag={f} store={store} periodEnd={q.data!.period_end!} />
        ))}
      </div>
    </div>
  );
}

// First "$1,234.56"-style amount in a flag value string, or null.
function flagMoney(s: string | null | undefined): number | null {
  const m = /\$\s*(-?[\d,]+(?:\.\d+)?)/.exec(String(s ?? ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// Trend vs the prior periods for an EXPENSE flag: rising spend is the bad
// direction. Compares the flag's current $ against May (prior_1) and Apr
// (prior_2) when those parse.
function flagTrend(flag: PlFlag): { dir: "up" | "down"; label: string } | null {
  const cur = flagMoney(flag.value);
  const p1 = flagMoney(flag.prior_1);
  if (cur == null || p1 == null || cur === p1) return null;
  const p2 = flagMoney(flag.prior_2);
  const rising = cur > p1;
  const streak = rising && p2 != null && p1 > p2;
  return {
    dir: rising ? "up" : "down",
    label: streak ? "rising 2 periods" : `${rising ? "up" : "down"} vs May`,
  };
}

function FlagRow({ flag, store, periodEnd }: { flag: PlFlag; store: string; periodEnd: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState(flag.note ?? "");
  // Re-seed when the saved note arrives after mount (cached flag data can
  // render first, then the fresh fetch lands with the note) — but never
  // clobber text the user is mid-typing.
  const seeded = useRef(flag.note ?? "");
  useEffect(() => {
    const incoming = flag.note ?? "";
    if (incoming !== seeded.current) {
      setNote((cur) => (cur.trim() === "" || cur === seeded.current ? incoming : cur));
      seeded.current = incoming;
    }
  }, [flag.note]);

  const trend = flagTrend(flag);

  const save = useMutation({
    mutationFn: () =>
      savePlFlagNote({
        period_end: periodEnd,
        store_number: store,
        category: flag.category,
        item: flag.item ?? "",
        sheet_row: flag.sheet_row,
        note: note.trim(),
      }),
    onSuccess: (r) => {
      toast.push(
        r.sheet_written ? "Note saved & written to the review sheet." : `Note saved. ${r.sheet_reason ?? ""}`,
        r.sheet_written ? "success" : "info",
      );
      qc.invalidateQueries({ queryKey: ["pl-flags"] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save the note.", "error"),
  });

  return (
    <div className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
          {flag.category}
        </span>
        <span className="text-sm font-semibold text-midnight">{flag.item ?? "—"}</span>
        {flag.value && <span className="text-sm tabular-nums text-zinc-700">{flag.value}</span>}
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              trend.dir === "up" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
            )}
            title="Direction vs the prior periods — for expense flags, up is the wrong way"
          >
            {trend.dir === "up" ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
            {trend.label}
          </span>
        )}
        {flag.rule && <span className="text-xs text-amber-700">{flag.rule}</span>}
        {(flag.prior_1 || flag.prior_2) && (
          <span className="text-xs text-zinc-400">
            {[flag.prior_1, flag.prior_2].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      {/* The saved note, visible without touching the editor. */}
      {flag.note && (
        <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-100">
          <span className="whitespace-pre-wrap">{flag.note}</span>
          {flag.noted_by && (
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              — {flag.noted_by}
              {flag.noted_at ? ` · ${new Date(flag.noted_at).toLocaleString()}` : ""}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-start gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={1}
          placeholder={flag.note ? "Update this note…" : "Explain this flag…"}
          className="min-h-[38px] flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !note.trim() || note.trim() === (flag.note ?? "").trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function LineRow({ line }: { line: PlLine }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto_auto] gap-x-6 px-5 py-1.5 text-sm",
        line.total ? "border-t border-zinc-200 bg-zinc-50 font-bold text-midnight" : "text-zinc-700",
      )}
    >
      <span className={cn(!line.total && "pl-3")}>{line.label}</span>
      <span className={cn("w-28 text-right tabular-nums", (line.amount ?? 0) < 0 && "text-red-600")}>
        {money(line.amount, 2)}
      </span>
      <span className="w-20 text-right tabular-nums text-zinc-500">{line.pct != null ? `${line.pct.toFixed(1)}%` : ""}</span>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" | "neutral" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "ok" ? "text-emerald-600" : "text-midnight";
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={cn("mt-1 text-3xl font-bold tabular-nums", color)}>{value}</div>
    </div>
  );
}

// ── Admin upload — parse the workbook in the browser, preview, save. ──
function UploadPanel({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [parsing, setParsing] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [fileName, setFileName] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true);
    setParsed(null);
    setFileName(file.name);
    // "Final" workbooks usually say so in the filename; Prelim is default.
    setIsFinal(/final/i.test(file.name));
    try {
      const { parsePlWorkbook } = await import("./parseWorkbook");
      const result = await parsePlWorkbook(await file.arrayBuffer());
      setParsed(result);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Couldn't parse the workbook.", "error");
    } finally {
      setParsing(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error("Nothing parsed.");
      return uploadPl({
        period_end: parsed.period_end,
        period_label: parsed.suggested_label,
        is_final: isFinal,
        statements: parsed.stores,
      });
    },
    onSuccess: (r) => {
      toast.push(
        `Saved ${r.upserted} statement${r.upserted === 1 ? "" : "s"}.` +
          (r.unmatched.length ? ` ${r.unmatched.length} store number(s) not in the app: ${r.unmatched.slice(0, 8).join(", ")}${r.unmatched.length > 8 ? "…" : ""}` : ""),
        r.unmatched.length ? "info" : "success",
      );
      qc.invalidateQueries({ queryKey: ["pl-periods"] });
      qc.invalidateQueries({ queryKey: ["pl-overview"] });
      onDone();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Upload failed.", "error"),
  });

  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="text-sm font-semibold text-midnight">Upload P&L workbook</div>
      <p className="mt-0.5 text-xs text-zinc-600">
        The accounting side-by-side .xlsx (one $ + % column pair per store). Parsed entirely in your
        browser; re-uploading the same period overwrites it (Prelim → Final).
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onPick} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={parsing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" strokeWidth={2} />}
          {parsing ? "Parsing…" : fileName ? "Pick a different file" : "Choose .xlsx"}
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700">
          <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          This is the Final (not Prelim)
        </label>
      </div>

      {parsed && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm ring-1 ring-zinc-200">
          <div className="font-semibold text-midnight">
            {parsed.suggested_label} · period ending {parsed.period_end} · {parsed.stores.length} stores
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Sample: {parsed.stores.slice(0, 3).map((s) => `#${s.store_number} sales ${money(s.total_sales)} / CI ${pct(s.ci_pct)}`).join(" · ")}
          </div>
          {parsed.skipped_columns.length > 0 && (
            <div className="mt-1 text-xs text-zinc-400">
              Skipped rollup columns: {parsed.skipped_columns.join(", ")}
            </div>
          )}
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {save.isPending ? "Saving…" : `Save ${parsed.stores.length} statements (${isFinal ? "Final" : "Prelim"})`}
          </button>
        </div>
      )}
    </div>
  );
}
