// Cash Management — admin Settings: the two variance tolerances that drive
// every page (Night Closeout + Deposit Validation).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CalendarClock, Moon } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchSettings, updateSettings } from "./api";
import { centsToInput, toCents, usd } from "./money";
import { MoneyInput } from "./ui";

export function SettingsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["cash-settings"], queryFn: fetchSettings });

  const [closeout, setCloseout] = useState("");
  const [deposit, setDeposit] = useState("");
  // Hour 0–23 as a string for the <select>; the wire format is a number.
  const [cutoff, setCutoff] = useState("");

  useEffect(() => {
    if (query.data) {
      setCloseout(centsToInput(query.data.closeoutToleranceCents));
      setDeposit(centsToInput(query.data.depositToleranceCents));
      setCutoff(String(query.data.businessDayCutoffHour));
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      updateSettings({
        closeout_tolerance_cents: toCents(closeout),
        deposit_tolerance_cents: toCents(deposit),
        business_day_cutoff_hour: Number(cutoff),
      }),
    onSuccess: () => {
      toast.push("Settings updated — applies everywhere.", "success");
      qc.invalidateQueries({ queryKey: ["cash-settings"] });
      qc.invalidateQueries({ queryKey: ["cash-config"] });
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-deposit"] });
      qc.invalidateQueries({ queryKey: ["cash-missed-days"] });
      qc.invalidateQueries({ queryKey: ["cash-dsr"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Save failed.", "error"),
  });

  // Format hour 0–23 as "Xam" / "Xpm" for the dropdown labels.
  function hourLabel(h: number): string {
    if (h === 0) return "12 AM (midnight)";
    if (h === 12) return "12 PM (noon)";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.data && !query.data.can_edit)
    return <EmptyState title="Admin only" description="Only an admin can change the cash variance tolerances." />;

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Settings</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Cash management</h2>
        <p className="mt-1.5 text-sm text-zinc-500">
          Variance tolerances drive every page. A variance at or under the limit is fine; over it flags, requires a
          reason, and escalates to the store's DO &amp; SDO. The business-day cutoff controls which date a late-night
          closeout is stamped with.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <Moon className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-midnight">Night Closeout</div>
              <div className="text-xs text-zinc-500">Drawer deposit vs. cash-due</div>
            </div>
          </div>
          <MoneyInput value={closeout} onChange={setCloseout} placeholder="5.00" />
          <div className="mt-1.5 text-[11px] text-zinc-400">Current: {usd(query.data?.closeoutToleranceCents)}</div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <Banknote className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-midnight">Deposit Validation</div>
              <div className="text-xs text-zinc-500">Bank credit vs. expected</div>
            </div>
          </div>
          <MoneyInput value={deposit} onChange={setDeposit} placeholder="5.00" />
          <div className="mt-1.5 text-[11px] text-zinc-400">Current: {usd(query.data?.depositToleranceCents)}</div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-50 text-sky-600">
            <CalendarClock className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-midnight">Business-day cutoff (Central Time)</div>
            <div className="text-xs text-zinc-500">A close before this hour is stamped with the prior date.</div>
          </div>
        </div>
        <select
          value={cutoff}
          onChange={(e) => setCutoff(e.target.value)}
          className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm font-medium text-midnight ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent sm:max-w-xs"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={String(h)}>{hourLabel(h)}</option>
          ))}
        </select>
        <div className="mt-2 text-[11px] leading-snug text-zinc-400">
          Example: with a 5 AM cutoff, a drawer count submitted at 2 AM CT on the 8th is recorded as the 7th's business.
          Most stores close at 3 AM, so 5 AM gives a 2-hour reconciliation buffer.
        </div>
      </Card>

      <div className="mt-5">
        <Button onClick={() => save.mutate()} disabled={save.isPending || closeout === "" || deposit === "" || cutoff === ""}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
