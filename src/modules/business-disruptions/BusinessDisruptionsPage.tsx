// Business Disruption Reporting — replaces the standalone "Sonic Business
// Disruption Reporting" form. GM and above can submit a closure/disruption
// report for a store in their scope; it emails the store's District
// Manager (resolved automatically from the org chart — no manual picker)
// and lands in a DO+ queue scoped the same way Site Audits is.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Clock, Download, FileText,
  Image as ImageIcon, Loader2, Plus, Search, Upload, Wrench, X,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { toCSV, downloadCSV } from "@/lib/csv";
import {
  createDisruption, exportDisruptions, fetchDisruptionStores, fetchDisruptions,
  fileToPayload, lookupWorkOrders, setDisruptionStatus, updateDisruption, type FilePayload,
} from "./api";
import {
  CLOSURE_TYPES, ISSUE_TYPES, SOLUGENIX_TRIGGER_TYPES, WO_TRIGGER_TYPES,
  type DisruptionReport, type DisruptionStatus, type WoPick,
} from "./types";

type Nav = { screen: "list" | "new" | "edit" | "detail"; id?: string };

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtShortDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// A reopen date means the closure is over — even a same-day reopen — so the
// list badge should read "Reopened", not a flat "Closed" that reads as
// still-ongoing. Only a genuinely open-ended closure (no reopen date on
// file) gets the alarming red "Closed".
function ClosureChip({ report }: { report: DisruptionReport }) {
  if (!report.store_closed) return null;
  if (report.reopen_date) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
        Reopened {fmtShortDate(report.reopen_date)}
      </span>
    );
  }
  return <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Closed</span>;
}
function fmtUSD(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const STATUS_META: Record<DisruptionStatus, { label: string; chip: string }> = {
  open: { label: "Open", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  reviewed: { label: "Reviewed", chip: "bg-accent/10 text-accent ring-accent/30" },
  closed: { label: "Closed", chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "amber" | "red" }) {
  const toneCls = tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-midnight";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-card">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular-nums tracking-tight", toneCls)}>{value}</div>
    </div>
  );
}

const EXPORT_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

export function BusinessDisruptionsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const canExport = EXPORT_ROLES.has(profile?.role ?? "");
  const [nav, setNav] = useState<Nav>({ screen: "list" });
  const q = useQuery({ queryKey: ["business-disruptions"], queryFn: fetchDisruptions });
  const reports = q.data?.reports ?? [];
  const canWrite = q.data?.can_write ?? false;
  const canReview = q.data?.can_review ?? false;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["business-disruptions"] });
  const active = useMemo(() => reports.find((r) => r.id === nav.id) ?? null, [reports, nav.id]);
  const stats = useMemo(() => ({
    total: reports.length,
    open: reports.filter((r) => r.status === "open").length,
    stillClosed: reports.filter((r) => r.store_closed && !r.reopen_date).length,
    lossSales: reports.reduce((sum, r) => sum + (r.estimated_loss_sales || 0), 0),
  }), [reports]);

  if (q.isLoading) {
    return <div className="mx-auto w-full max-w-2xl space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (q.isError) {
    return <EmptyState title="Couldn't load reports" description={(q.error as Error)?.message ?? "Make sure migration 0203 has run."} />;
  }

  if (nav.screen === "new") {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <ReportForm
          mode="create"
          onBack={() => setNav({ screen: "list" })}
          onSubmitted={() => { invalidate(); setNav({ screen: "list" }); }}
        />
      </div>
    );
  }
  if (nav.screen === "edit" && active) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <ReportForm
          mode="edit"
          initial={active}
          onBack={() => setNav({ screen: "detail", id: active.id })}
          onSubmitted={() => { invalidate(); setNav({ screen: "detail", id: active.id }); }}
        />
      </div>
    );
  }
  if (nav.screen === "detail" && active) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <ReportDetail report={active} onBack={() => setNav({ screen: "list" })} onChanged={invalidate}
          onEdit={() => setNav({ screen: "edit", id: active.id })} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Business Disruptions"
        description="Report a closure or business disruption at a store."
        actions={canWrite ? <Button size="sm" onClick={() => setNav({ screen: "new" })}><Plus className="h-4 w-4" /> New report</Button> : undefined}
      />
      {canExport && <ExportPanel />}
      {canReview && reports.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Reports" value={String(stats.total)} />
          <SummaryTile label="Open" value={String(stats.open)} tone={stats.open > 0 ? "amber" : undefined} />
          <SummaryTile label="Still closed" value={String(stats.stillClosed)} tone={stats.stillClosed > 0 ? "red" : undefined} />
          <SummaryTile label="Est. loss sales" value={fmtUSD(stats.lossSales)} />
        </div>
      )}
      {reports.length === 0 ? (
        <EmptyState
          title="No disruptions reported"
          description={canWrite ? "Report a closure or disruption when one happens at a store in your scope." : "Reports for stores in your scope will appear here."}
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <button key={r.id} onClick={() => setNav({ screen: "detail", id: r.id })}
                className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-card transition hover:border-accent/60">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 px-1 font-bold leading-none tabular-nums text-accent text-[13px]">
                  {r.store_number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-midnight">{r.store_name || `Store #${r.store_number}`}</span>
                    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset", meta.chip)}>{meta.label}</span>
                    <ClosureChip report={r} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{fmtDate(r.disruption_date)} · {r.submitted_by_name || "—"}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-zinc-400">{r.closure_types.join(", ") || r.issue_types.join(", ") || "—"}</span>
                    {r.estimated_loss_sales > 0 && (
                      <span className="shrink-0 font-semibold tabular-nums text-red-600">{fmtUSD(r.estimated_loss_sales)} lost</span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CSV date-range export (SDO+) ─────────────────────────────────────────────
function ExportPanel() {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);

  const run = useMutation({
    mutationFn: () => exportDisruptions(start, end),
    onSuccess: (r) => {
      if (!r.rows.length) {
        toast.push("No disruptions in that date range for your scope.", "info");
        return;
      }
      const headers = [
        "Date", "Store #", "Store", "Status", "Store closed", "Reopen date",
        "Closure types", "Issue types", "Est. loss sales", "Work order filed",
        "WO #", "Submitted by", "Description",
      ];
      const rows = r.rows.map((d) => ({
        Date: d.disruption_date,
        "Store #": d.store_number,
        Store: d.store_name,
        Status: d.status,
        "Store closed": d.store_closed ? "Yes" : "No",
        "Reopen date": d.reopen_date ?? "",
        "Closure types": d.closure_types.join("; "),
        "Issue types": d.issue_types.join("; "),
        "Est. loss sales": d.estimated_loss_sales != null ? d.estimated_loss_sales.toFixed(2) : "",
        "Work order filed": d.work_order_filed === true ? "Yes" : d.work_order_filed === false ? "No" : "",
        "WO #": d.work_order_number ?? "",
        "Submitted by": d.submitted_by_name ?? "",
        Description: d.description ?? "",
      }));
      downloadCSV(`business-disruptions-${start}_to_${end}.csv`, toCSV(headers, rows));
      toast.push(`Exported ${r.rows.length} report${r.rows.length === 1 ? "" : "s"}.`, "success");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Export failed.", "error"),
  });

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Export CSV</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-500">
          <span className="mb-1 block font-semibold">Start</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-zinc-500">
          <span className="mb-1 block font-semibold">End</span>
          <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </label>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={2} />}
          {run.isPending ? "Building…" : "Export"}
        </button>
      </div>
    </div>
  );
}

// ── New report form ─────────────────────────────────────────────────────────
function CheckboxGroup({ options, selected, onToggle }: { options: readonly string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-3">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={() => onToggle(o)}
            className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
          />
          {o}
        </label>
      ))}
    </div>
  );
}
function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {[{ v: true, label: "Yes" }, { v: false, label: "No" }].map((o) => (
        <button key={String(o.v)} type="button" onClick={() => onChange(o.v)}
          className={cn("flex-1 rounded-lg border py-2 text-sm font-semibold transition",
            value === o.v ? "border-accent bg-accent/10 text-accent" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <label className="mb-1 block text-sm font-semibold text-midnight">{children}{required && <span className="text-red-500"> *</span>}</label>;
}
const inputCls = "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

// Typeahead search against the store's own Work Orders V2 tickets, scoped
// server-side. Debounced so it doesn't fire a request per keystroke.
function WoLookupField({ storeNumber, selected, onSelect }: {
  storeNumber: string; selected: WoPick | null; onSelect: (t: WoPick | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<WoPick[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (selected || term.trim().length < 2 || !storeNumber) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      lookupWorkOrders(storeNumber, term.trim())
        .then((r) => setResults(r.tickets))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [term, storeNumber, selected]);

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200">
        <Wrench className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-midnight">{selected.wo_number}</span>
          {selected.work_requested && <span className="text-zinc-500"> — {selected.work_requested}</span>}
        </span>
        <button type="button" onClick={() => { onSelect(null); setTerm(""); }} className="shrink-0 text-zinc-400 hover:text-red-500">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by WO #…"
          className={cn(inputCls, "pl-9")}
        />
      </div>
      {term.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-zinc-200">
          {searching ? (
            <div className="px-3 py-2 text-xs text-zinc-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-400">No matching work orders for this store.</div>
          ) : (
            results.map((t) => (
              <button key={t.id} type="button" onClick={() => { onSelect(t); setResults([]); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50">
                <span className="font-semibold text-midnight">{t.wo_number}</span>
                {t.work_requested && <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{t.work_requested}</span>}
                <span className="shrink-0 text-[10px] uppercase text-zinc-400">{t.status}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReportForm({ mode, initial, onBack, onSubmitted }: {
  mode: "create" | "edit"; initial?: DisruptionReport; onBack: () => void; onSubmitted: () => void;
}) {
  const toast = useToast();
  const storesQ = useQuery({ queryKey: ["business-disruption-stores"], queryFn: fetchDisruptionStores, staleTime: 5 * 60_000 });

  const [date, setDate] = useState(initial?.disruption_date ?? "");
  const [storeNumber, setStoreNumber] = useState(initial?.store_number ?? "");
  const [hours, setHours] = useState(initial?.hours_disrupted != null ? String(initial.hours_disrupted) : "");
  const [storeClosed, setStoreClosed] = useState<boolean | null>(initial?.store_closed ?? null);
  const [reopenDate, setReopenDate] = useState(initial?.reopen_date ?? "");
  const [orderAheadDisabled, setOrderAheadDisabled] = useState<boolean | null>(initial?.order_ahead_disabled ?? null);
  const [closureTypes, setClosureTypes] = useState<string[]>(initial?.closure_types ?? []);
  const [closureOther, setClosureOther] = useState(initial?.closure_other_detail ?? "");
  const [solugenixCase, setSolugenixCase] = useState(initial?.solugenix_case_number ?? "");
  const [workOrderFiled, setWorkOrderFiled] = useState<boolean | null>(initial?.work_order_filed ?? null);
  const [selectedWo, setSelectedWo] = useState<WoPick | null>(
    initial?.work_order_ticket_id && initial.work_order_number
      ? { id: initial.work_order_ticket_id, wo_number: initial.work_order_number, work_requested: null, status: "" }
      : null
  );
  const [employeeInjured, setEmployeeInjured] = useState<boolean | null>(initial?.employee_injured ?? null);
  const [storeDamaged, setStoreDamaged] = useState<boolean | null>(initial?.store_damaged ?? null);
  const [customerInjured, setCustomerInjured] = useState<boolean | null>(initial?.customer_injured ?? null);
  const [issueTypes, setIssueTypes] = useState<string[]>(initial?.issue_types ?? []);
  const [lossSales, setLossSales] = useState(initial ? String(initial.estimated_loss_sales) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [files, setFiles] = useState<{ file: File; payload: FilePayload | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const needsSolugenix = closureTypes.some((t) => SOLUGENIX_TRIGGER_TYPES.has(t));
  const needsWo = closureTypes.some((t) => WO_TRIGGER_TYPES.has(t));

  async function onPickFiles(picked: FileList | null) {
    if (!picked) return;
    const additions = Array.from(picked).slice(0, 6 - files.length).map((file) => ({ file, payload: null as FilePayload | null }));
    setFiles((f) => [...f, ...additions]);
    for (const a of additions) {
      try {
        const payload = await fileToPayload(a.file);
        setFiles((f) => f.map((x) => (x.file === a.file ? { ...x, payload } : x)));
      } catch {
        toast.push(`Couldn't read ${a.file.name}.`, "error");
        setFiles((f) => f.filter((x) => x.file !== a.file));
      }
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("Date of closure or disruption is required.");
      if (!storeNumber) throw new Error("Store # is required.");
      if (storeClosed === null) throw new Error("Please answer whether the store closed.");
      if (orderAheadDisabled === null) throw new Error("Please answer whether Order Ahead was disabled.");
      if (closureTypes.includes("Other") && !closureOther.trim()) throw new Error('Please describe the issue when "Other" is selected.');
      if (needsSolugenix && !solugenixCase.trim()) throw new Error("Solugenix Case # is required for Internet/POS/Connectivity issues.");
      if (needsWo && workOrderFiled === null) throw new Error("Please answer whether a Work Order has been put in.");
      if (needsWo && workOrderFiled === true && !selectedWo) throw new Error("Look up and select the Work Order.");
      if (!description.trim()) throw new Error("Description is required.");
      const payload = {
        disruption_date: date,
        store_number: storeNumber,
        hours_disrupted: hours === "" ? null : hours,
        store_closed: storeClosed,
        reopen_date: storeClosed && reopenDate ? reopenDate : null,
        order_ahead_disabled: orderAheadDisabled,
        closure_types: closureTypes,
        closure_other_detail: closureOther.trim(),
        solugenix_case_number: solugenixCase.trim(),
        work_order_filed: needsWo ? workOrderFiled === true : undefined,
        work_order_ticket_id: workOrderFiled === true ? selectedWo?.id : undefined,
        employee_injured: employeeInjured === true,
        store_damaged: storeDamaged === true,
        customer_injured: customerInjured === true,
        issue_types: issueTypes,
        estimated_loss_sales: lossSales === "" ? 0 : lossSales,
        description: description.trim(),
      };
      if (mode === "edit" && initial) return updateDisruption({ ...payload, id: initial.id });
      return createDisruption({ ...payload, attachments: files.map((f) => f.payload).filter((p): p is FilePayload => !!p) });
    },
    onSuccess: () => { toast.push(mode === "edit" ? "Report updated." : "Disruption report submitted.", "success"); onSubmitted(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't submit."),
  });

  return (
    <div className="pb-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> {mode === "edit" ? "Report" : "Disruptions"}</button>
      <h1 className="mb-4 text-xl font-bold tracking-tight text-midnight">{mode === "edit" ? "Edit disruption report" : "New disruption report"}</h1>

      <div className="space-y-4">
        <div>
          <FieldLabel required>Date of Closure or Disruption</FieldLabel>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>

        <div>
          <FieldLabel required>Store #</FieldLabel>
          <select value={storeNumber} onChange={(e) => setStoreNumber(e.target.value)} className={inputCls}>
            <option value="" disabled>{storesQ.isLoading ? "Loading…" : "Pick a store…"}</option>
            {(storesQ.data?.stores ?? []).map((s) => (
              <option key={s.id} value={s.number}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">The store's District Manager is notified automatically — no need to pick one.</p>
        </div>

        <div>
          <FieldLabel>How many hours was the disruption</FieldLabel>
          <input type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} placeholder="0" />
        </div>

        <div>
          <FieldLabel required>Did the store close?</FieldLabel>
          <YesNo value={storeClosed} onChange={setStoreClosed} />
        </div>

        {storeClosed && (
          <div>
            <FieldLabel>Date of Re-Open (if applicable)</FieldLabel>
            <input type="date" value={reopenDate} onChange={(e) => setReopenDate(e.target.value)} className={inputCls} />
          </div>
        )}

        <div>
          <FieldLabel required>Was Order Ahead disabled?</FieldLabel>
          <p className="mb-1.5 text-xs text-zinc-500">If the store is closed or unable to serve customers, please ensure Order Ahead is disabled so customers are routed to other stores.</p>
          <YesNo value={orderAheadDisabled} onChange={setOrderAheadDisabled} />
        </div>

        <div>
          <FieldLabel required>Closure or Disruption Type</FieldLabel>
          <p className="mb-1.5 text-xs text-zinc-500">Choose all that apply.</p>
          <CheckboxGroup options={CLOSURE_TYPES} selected={closureTypes} onToggle={(v) => toggle(closureTypes, setClosureTypes, v)} />
        </div>

        {closureTypes.includes("Other") && (
          <div>
            <FieldLabel required>If other, please describe the issue</FieldLabel>
            <textarea value={closureOther} onChange={(e) => setClosureOther(e.target.value)} rows={2} className={cn(inputCls, "resize-y")} />
          </div>
        )}

        {needsSolugenix && (
          <div>
            <FieldLabel required>Solugenix Case #</FieldLabel>
            <p className="mb-1.5 text-xs text-zinc-500">Internet, POS, and connectivity issues route through Solugenix — enter the case # from that ticket.</p>
            <input value={solugenixCase} onChange={(e) => setSolugenixCase(e.target.value)} className={inputCls} placeholder="e.g. SG-000000" />
          </div>
        )}

        {needsWo && (
          <div>
            <FieldLabel required>Has a Work Order been put in?</FieldLabel>
            <YesNo value={workOrderFiled} onChange={(v) => { setWorkOrderFiled(v); if (!v) setSelectedWo(null); }} />
            {workOrderFiled && (
              <div className="mt-2">
                <FieldLabel required>Look up the Work Order</FieldLabel>
                <WoLookupField storeNumber={storeNumber} selected={selectedWo} onSelect={setSelectedWo} />
              </div>
            )}
          </div>
        )}

        <div>
          <FieldLabel required>Was an employee injured?</FieldLabel>
          <YesNo value={employeeInjured} onChange={setEmployeeInjured} />
        </div>
        <div>
          <FieldLabel required>Was the store damaged?</FieldLabel>
          <YesNo value={storeDamaged} onChange={setStoreDamaged} />
        </div>
        <div>
          <FieldLabel required>Was a customer injured?</FieldLabel>
          <YesNo value={customerInjured} onChange={setCustomerInjured} />
        </div>

        <div>
          <FieldLabel>Type of issue</FieldLabel>
          <p className="mb-1.5 text-xs text-zinc-500">Choose all that apply.</p>
          <CheckboxGroup options={ISSUE_TYPES} selected={issueTypes} onToggle={(v) => toggle(issueTypes, setIssueTypes, v)} />
        </div>

        <div>
          <FieldLabel required>Estimated Loss Sales</FieldLabel>
          <p className="mb-1.5 text-xs text-zinc-500">Enter your estimation of loss sales based on closure or disruption. If the amount is $0 then enter 0.</p>
          <input type="number" min="0" step="0.01" value={lossSales} onChange={(e) => setLossSales(e.target.value)} className={inputCls} placeholder="0.00" />
        </div>

        <div>
          <FieldLabel required>Description</FieldLabel>
          <p className="mb-1.5 text-xs text-zinc-500">Enter a short description of the issue that caused the closure and/or disruption.</p>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(inputCls, "resize-y")} />
        </div>

        {mode === "create" ? (
          <div>
            <FieldLabel>Attach Picture or Document</FieldLabel>
            <p className="mb-1.5 text-xs text-zinc-500">Up to 6 files, 10 MB each.</p>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden" onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={files.length >= 6}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 py-6 text-sm text-zinc-500 hover:border-accent hover:text-accent disabled:opacity-50">
              <Upload className="h-5 w-5" />
              Browse files
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
                    {f.file.type.startsWith("image/") ? <ImageIcon className="h-4 w-4 shrink-0 text-zinc-400" /> : <FileText className="h-4 w-4 shrink-0 text-zinc-400" />}
                    <span className="min-w-0 flex-1 truncate text-zinc-700">{f.file.name}</span>
                    {!f.payload && <span className="shrink-0 text-xs text-zinc-400">Reading…</span>}
                    <button type="button" onClick={() => setFiles((list) => list.filter((_, idx) => idx !== i))} className="shrink-0 text-zinc-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : initial && initial.attachments.length > 0 ? (
          <div>
            <FieldLabel>Attachments</FieldLabel>
            <p className="mb-1.5 text-xs text-zinc-500">Attachments can't be changed after submitting.</p>
            <div className="flex flex-wrap gap-2">
              {initial.attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
                  {a.type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <Button className="w-full" disabled={submit.isPending} onClick={() => { setError(null); submit.mutate(); }}>
          {submit.isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Submit report"}
        </Button>
      </div>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────
function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="border-b border-zinc-100 py-2.5 last:border-b-0">
      <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-0.5 text-sm text-zinc-800">{value}</div>
    </div>
  );
}
function ReportDetail({ report, onBack, onChanged, onEdit }: {
  report: DisruptionReport; onBack: () => void; onChanged: () => void; onEdit: () => void;
}) {
  const toast = useToast();
  const statusMut = useMutation({
    mutationFn: (status: DisruptionStatus) => setDisruptionStatus(report.id, status),
    onSuccess: onChanged,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update status.", "error"),
  });
  const meta = STATUS_META[report.status];

  return (
    <div className="pb-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> Disruptions</button>

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-midnight">{report.store_name || `Store #${report.store_number}`}</h1>
          <div className="text-xs text-zinc-500">
            #{report.store_number} · {fmtDate(report.disruption_date)} · {report.submitted_by_name || "—"}
            {report.updated_by_name && <> · edited by {report.updated_by_name}</>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ring-1 ring-inset", meta.chip)}>{meta.label}</span>
          {report.can_edit && (
            <button onClick={onEdit} className="text-xs font-semibold text-accent hover:underline">Edit</button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card">
        <DRow label="District Manager" value={report.district_manager_name} />
        <DRow label="Escalated to (RVP)" value={report.escalated_to_rvp_name} />
        <DRow label="Hours disrupted" value={report.hours_disrupted != null ? `${report.hours_disrupted}h` : null} />
        <DRow label="Store closed" value={report.store_closed ? "Yes" : "No"} />
        <DRow label="Date of re-open" value={report.reopen_date ? fmtDate(report.reopen_date) : null} />
        <DRow label="Order Ahead disabled" value={report.order_ahead_disabled ? "Yes" : "No"} />
        <DRow label="Closure / disruption type" value={report.closure_types.join(", ") || null} />
        <DRow label="Other detail" value={report.closure_other_detail} />
        <DRow label="Solugenix Case #" value={report.solugenix_case_number} />
        <DRow
          label="Work Order filed"
          value={
            report.work_order_filed == null ? null
            : report.work_order_filed && report.work_order_ticket_id ? (
              <a href={`/admin/work-orders-v2?ticket=${report.work_order_ticket_id}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                <Wrench className="h-3.5 w-3.5" /> {report.work_order_number || "View work order"}
              </a>
            ) : report.work_order_filed ? "Yes" : "No"
          }
        />
        <DRow label="Employee injured" value={report.employee_injured ? "Yes" : "No"} />
        <DRow label="Store damaged" value={report.store_damaged ? "Yes" : "No"} />
        <DRow label="Customer injured" value={report.customer_injured ? "Yes" : "No"} />
        <DRow label="Issue type" value={report.issue_types.join(", ") || null} />
        <DRow label="Estimated loss sales" value={fmtUSD(report.estimated_loss_sales)} />
        <DRow label="Description" value={<span className="whitespace-pre-wrap">{report.description}</span>} />
      </div>

      {report.attachments.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Attachments</div>
          <div className="flex flex-wrap gap-2">
            {report.attachments.map((a, i) => (
              <a key={i} href={a.url ?? undefined} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:border-accent hover:text-accent">
                {a.type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {a.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {report.can_review && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Mark as:</span>
          {(["open", "reviewed", "closed"] as const).map((s) => (
            <button key={s} disabled={statusMut.isPending || report.status === s} onClick={() => statusMut.mutate(s)}
              className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-default",
                report.status === s ? STATUS_META[s].chip + " ring-1" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")}>
              {s === "reviewed" && <Check className="h-3 w-3" />}
              {s === "open" && <Clock className="h-3 w-3" />}
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
