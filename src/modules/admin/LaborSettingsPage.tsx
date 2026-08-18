import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { useToast } from "@/shared/ui/Toaster";
import { Skeleton } from "@/shared/ui/Skeleton";
import { fetchLaborSettings, setLaborSettings } from "@/modules/labor-v2/api";

export function LaborSettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["labor-settings"], queryFn: fetchLaborSettings });
  const [pending, setPending] = useState(false);

  const mut = useMutation({
    mutationFn: (v: boolean) => setLaborSettings(v),
    onMutate: () => setPending(true),
    onSuccess: (data) => {
      qc.setQueryData(["labor-settings"], { ok: true, hrs_weekly_rate: data.hrs_weekly_rate });
      qc.invalidateQueries({ queryKey: ["labor-v2-team"] });
      toast.push(
        data.hrs_weekly_rate
          ? "Hrs/Store now shows a per-week rate."
          : "Hrs/Store now shows the full period total.",
        "success",
      );
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
    onSettled: () => setPending(false),
  });

  const weekly = q.data?.hrs_weekly_rate ?? true;

  return (
    <>
      <PageHeader
        title="Labor settings"
        description="Controls for the Labor report's calculations."
      />

      <Card className="max-w-2xl">
        <CardHeader
          title="Hrs/Store calculation"
          description="How the Period (PTD) Hrs/Store column is expressed on the Labor report."
        />
        <CardBody>
          {q.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={weekly}
                  disabled={pending}
                  onChange={(e) => mut.mutate(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-accent disabled:opacity-50"
                />
                <span>
                  <span className="text-sm font-medium text-heading">
                    Divide Period Hrs/Store by weeks (per-week rate)
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    <b>On</b> — Period Hrs/Store is a per-store <em>per-week</em> rate (÷ weeks
                    elapsed in the period). Stays on the same scale all period and matches the
                    Ranker. <br />
                    <b>Off</b> — Period Hrs/Store is the raw <em>period total</em> per store (no week
                    division): the actual hours over chart accumulated this period. Grows each week;
                    not comparable across weeks or period lengths.
                  </span>
                </span>
              </label>

              <div className="mt-4 rounded-lg bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
                Currently: Period Hrs/Store shows{" "}
                <b className="text-heading">
                  {weekly ? "a per-week rate (÷ weeks)" : "the full period total (÷ 1)"}
                </b>
                . Day and Week columns are unaffected (they're already a single day / week).
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
