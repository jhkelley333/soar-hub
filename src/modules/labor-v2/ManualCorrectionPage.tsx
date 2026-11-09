// /admin/labor-correction — standalone admin tool for correcting a specific
// store/date row in labor_v2_daily when Inventory Express fixes data after the
// fact. VP and above only (enforced server-side).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, Loader2, Wrench } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { cn } from "@/lib/cn";
import {
  correctDailyRow,
  fetchDailyRow,
  fetchDailyRowRevisions,
  type DailyRowCorrectionInput,
} from "./api";

const CORRECTABLE: { key: keyof DailyRowCorrectionInput; label: string }[] = [
  { key: "net_sales",             label: "Net Sales ($)" },
  { key: "labor_cost",            label: "Labor Cost ($)" },
  { key: "labor_hours",           label: "Labor Hours" },
  { key: "labor_pct",             label: "Labor % (decimal, e.g. 0.21)" },
  { key: "target_labor_pct",      label: "Target Labor % (decimal)" },
  { key: "wtd_net_sales",         label: "WTD Net Sales ($)" },
  { key: "wtd_labor_cost",        label: "WTD Labor Cost ($)" },
  { key: "wtd_labor_hours",       label: "WTD Labor Hours" },
  { key: "wtd_target_labor_pct",  label: "WTD Target Labor % (decimal)" },
  { key: "ptd_net_sales",         label: "PTD Net Sales ($)" },
  { key: "ptd_labor_cost",        label: "PTD Labor Cost ($)" },
  { key: "ptd_labor_hours",       label: "PTD Labor Hours" },
];

const inputCls =
  "w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-midnight placeholder:text-zinc-400 focus:border-accent-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-night-ink";

const SOURCE_LABEL: Record<string, string> = {
  cron: "Scheduled",
  refresh: "Manual refresh",
  "self-heal": "Self-heal",
  "manual-correction": "Manual correction",
};

const fmtVal = (v: number | null) =>
  v == null ? "—" : Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 6 });

const fmtTime = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function isValidStore(s: string) { return /^\d{3,6}$/.test(s.trim()); }
function isValidDate(d: string) { return /^\d{4}-\d{2}-\d{2}$/.test(d.trim()); }

export function ManualCorrectionPage() {
  const qc = useQueryClient();
  const [storeNumber, setStoreNumber] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  const canLookup = isValidStore(storeNumber) && isValidDate(businessDate);

  // Auto-fetch current row when store + date are valid.
  const rowQ = useQuery({
    queryKey: ["labor-daily-row", storeNumber, businessDate],
    queryFn: () => fetchDailyRow(storeNumber.trim(), businessDate.trim()),
    enabled: canLookup,
    staleTime: 30_000,
  });

  // Fetch revision history for the same store/date.
  const revQ = useQuery({
    queryKey: ["labor-daily-row-revisions", storeNumber, businessDate],
    queryFn: () => fetchDailyRowRevisions(storeNumber.trim(), businessDate.trim()),
    enabled: canLookup,
    staleTime: 30_000,
  });

  // Pre-fill fields when the row loads (only once per store/date combo).
  useEffect(() => {
    if (!rowQ.data?.row) { setPrefilled(false); return; }
    const row = rowQ.data.row;
    const next: Record<string, string> = {};
    for (const { key } of CORRECTABLE) {
      const v = (row as Record<string, number | null>)[key as string];
      if (v != null) next[key as string] = String(v);
    }
    setFields(next);
    setPrefilled(true);
  }, [rowQ.data]);

  const mut = useMutation({
    mutationFn: (input: DailyRowCorrectionInput) => correctDailyRow(input),
    onSuccess: (data) => {
      setSuccess(
        `Corrected ${data.fields_corrected.join(", ")} for store ${data.store_number} on ${data.business_date}.`,
      );
      setStoreNumber("");
      setBusinessDate("");
      setReason("");
      setFields({});
      setPrefilled(false);
      qc.invalidateQueries({ queryKey: ["labor-v2-data-revisions"] });
      qc.invalidateQueries({ queryKey: ["labor-v2-pull-log"] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(null);
    const payload: DailyRowCorrectionInput = { store_number: storeNumber, business_date: businessDate, reason };
    for (const { key } of CORRECTABLE) {
      const v = fields[key as string];
      if (v !== undefined && v !== "") (payload as unknown as Record<string, unknown>)[key] = Number(v);
    }
    mut.mutate(payload);
  }

  const revisions = revQ.data?.entries ?? [];

  return (
    <>
      <PageHeader
        title="Manual Daily Correction"
        description="Fix a specific store/date row in labor_v2_daily when Inventory Express corrects data after the fact. VP and above only."
      />

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Store #
                </label>
                <input
                  className={inputCls}
                  placeholder="e.g. 1832"
                  value={storeNumber}
                  onChange={(e) => { setStoreNumber(e.target.value); setPrefilled(false); }}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Business Date
                </label>
                <input
                  type="date"
                  className={inputCls}
                  value={businessDate}
                  onChange={(e) => { setBusinessDate(e.target.value); setPrefilled(false); }}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Reason (required)
                </label>
                <input
                  className={inputCls}
                  placeholder="e.g. IE outage on 11/3; corrected 11/9"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[11px] text-zinc-400">
                  Fill in only the fields that need correcting — leave the rest blank.
                </p>
                {rowQ.isFetching && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading current data…
                  </span>
                )}
                {prefilled && !rowQ.isFetching && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    ✓ Current values loaded
                  </span>
                )}
                {canLookup && !rowQ.isFetching && rowQ.data?.row === null && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    No existing row — will insert
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {CORRECTABLE.map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-0.5 block text-[11px] text-zinc-500">{label}</label>
                    <input
                      type="number"
                      step="any"
                      className={inputCls}
                      placeholder="—"
                      value={fields[key as string] ?? ""}
                      onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {mut.isError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {(mut.error as Error)?.message ?? "Something went wrong."}
              </p>
            )}
            {success && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                ✓ {success}
              </p>
            )}

            <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-400">
                Changes are written to <code className="font-mono">labor_v2_daily</code> and logged in Data Revisions.
              </p>
              <button
                type="submit"
                disabled={mut.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
              >
                <Wrench className="h-3.5 w-3.5" />
                {mut.isPending ? "Saving…" : "Apply correction"}
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Change history for this store/date */}
      {canLookup && (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-midnight dark:text-night-ink">Change history</h2>
            <span className="text-[11px] text-zinc-400">
              store {storeNumber} · {businessDate}
            </span>
            {revQ.isFetching && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
          </div>

          {revisions.length === 0 && !revQ.isFetching ? (
            <p className="text-[13px] text-zinc-400">No recorded changes for this store/date yet.</p>
          ) : (
            <Card>
              <CardBody className="p-0">
                <div className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
                  {revisions.length} change{revisions.length === 1 ? "" : "s"}
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {revisions.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                      <span className="w-36 shrink-0 text-zinc-400">{fmtTime(r.detected_at)}</span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        r.pull_source === "manual-correction"
                          ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                          : r.source === "labor"
                          ? "bg-accent-100 text-accent-700"
                          : "bg-sky-50 text-sky-700",
                      )}>
                        {SOURCE_LABEL[r.pull_source ?? ""] ?? r.pull_source ?? r.source}
                      </span>
                      <span className="font-mono font-medium text-midnight dark:text-night-ink">{r.field}</span>
                      <span className="tabular-nums text-zinc-500">{fmtVal(r.old_value)}</span>
                      <span className="text-zinc-300">→</span>
                      <span className="font-semibold tabular-nums text-midnight dark:text-night-ink">{fmtVal(r.new_value)}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
