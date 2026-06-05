// Cash Management — admin Settings: the two variance tolerances that drive
// every page (Night Closeout + Deposit Validation).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Moon } from "lucide-react";
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

  useEffect(() => {
    if (query.data) {
      setCloseout(centsToInput(query.data.closeoutToleranceCents));
      setDeposit(centsToInput(query.data.depositToleranceCents));
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      updateSettings({ closeout_tolerance_cents: toCents(closeout), deposit_tolerance_cents: toCents(deposit) }),
    onSuccess: () => {
      toast.push("Tolerances updated — applies everywhere.", "success");
      qc.invalidateQueries({ queryKey: ["cash-settings"] });
      qc.invalidateQueries({ queryKey: ["cash-config"] });
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
      qc.invalidateQueries({ queryKey: ["cash-deposit"] });
      qc.invalidateQueries({ queryKey: ["cash-dsr"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Save failed.", "error"),
  });

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.data && !query.data.can_edit)
    return <EmptyState title="Admin only" description="Only an admin can change the cash variance tolerances." />;

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Settings</div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Variance tolerances</h2>
        <p className="mt-1.5 text-sm text-zinc-500">
          These thresholds drive every page. A variance at or under the limit is fine; over it flags, requires a reason, and
          escalates to the store's DO &amp; SDO.
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

      <div className="mt-5">
        <Button onClick={() => save.mutate()} disabled={save.isPending || closeout === "" || deposit === ""}>
          {save.isPending ? "Saving…" : "Save tolerances"}
        </Button>
      </div>
    </div>
  );
}
