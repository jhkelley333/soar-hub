// /admin/labor-correction — standalone admin tool for correcting a specific
// store/date row in labor_v2_daily when Inventory Express fixes data after the
// fact. VP and above only (enforced server-side).

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { correctDailyRow, type DailyRowCorrectionInput } from "./api";

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

export function ManualCorrectionPage() {
  const qc = useQueryClient();
  const [storeNumber, setStoreNumber] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

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
                  onChange={(e) => setStoreNumber(e.target.value)}
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
                  onChange={(e) => setBusinessDate(e.target.value)}
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
              <p className="mb-2 text-[11px] text-zinc-400">
                Fill in only the fields that need correcting — leave the rest blank.
              </p>
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
    </>
  );
}
