import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { useToast } from "@/shared/ui/Toaster";
import { Skeleton } from "@/shared/ui/Skeleton";
import { fetchLaborSettings, setLaborSettings, setMinDailyHours } from "@/modules/labor-v2/api";

export function LaborSettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["labor-settings"], queryFn: fetchLaborSettings });
  const [pending, setPending] = useState(false);
  const [floorInput, setFloorInput] = useState<string>("");
  const [floorDirty, setFloorDirty] = useState(false);

  const mut = useMutation({
    mutationFn: (v: boolean) => setLaborSettings(v),
    onMutate: () => setPending(true),
    onSuccess: (data) => {
      qc.setQueryData(["labor-settings"], (old: typeof q.data) => ({ ...old, ok: true, hrs_weekly_rate: data.hrs_weekly_rate }));
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

  const floorMut = useMutation({
    mutationFn: (v: number | null) => setMinDailyHours(v),
    onSuccess: (data) => {
      qc.setQueryData(["labor-settings"], (old: typeof q.data) => ({ ...old, ok: true, min_daily_hours: data.min_daily_hours }));
      qc.invalidateQueries({ queryKey: ["labor-v2-team"] });
      setFloorDirty(false);
      toast.push(
        data.min_daily_hours
          ? `Min Daily Hours floor set to ${data.min_daily_hours} hrs.`
          : "Min Daily Hours floor disabled.",
        "success",
      );
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const weekly = q.data?.hrs_weekly_rate ?? true;
  const savedFloor = q.data?.min_daily_hours ?? null;
  const displayFloor = floorDirty ? floorInput : (savedFloor != null ? String(savedFloor) : "");

  function handleFloorSave() {
    const v = floorInput.trim();
    const n = v === "" ? null : Number(v);
    if (n !== null && (isNaN(n) || n < 0)) { toast.push("Enter a positive number of hours, or leave blank to disable.", "error"); return; }
    floorMut.mutate(n);
  }

  return (
    <>
      <PageHeader
        title="Labor settings"
        description="Controls for the Labor report's calculations."
      />

      <Card className="max-w-2xl">
        <CardHeader
          title="Min Daily Hours floor"
          description="Prevents slow-day labor % from counting against stores that scheduled the minimum to operate."
        />
        <CardBody>
          {q.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                When a store&apos;s sales are low enough that the chart-based allowed hours would fall
                below this value, the effective target is raised to the floor instead. The store&apos;s
                actual labor hours are unchanged — only the threshold they&apos;re measured against
                moves up.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={displayFloor}
                  placeholder="e.g. 26"
                  onChange={(e) => { setFloorInput(e.target.value); setFloorDirty(true); }}
                  className="w-28 rounded-md border border-ink-subtle bg-surface px-3 py-1.5 text-sm text-heading focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-sm text-ink-muted">hours / day</span>
                <button
                  onClick={handleFloorSave}
                  disabled={floorMut.isPending || !floorDirty}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {floorMut.isPending ? "Saving…" : "Save"}
                </button>
                {savedFloor != null && !floorDirty && (
                  <button
                    onClick={() => { setFloorInput(""); setFloorDirty(true); }}
                    className="text-sm text-red-500 hover:underline"
                  >
                    Disable
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-lg bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
                {savedFloor != null
                  ? <>Currently active: stores with fewer than <b className="text-heading">{savedFloor} allowed hours</b> (based on sales × target %) will have their target raised to the floor.</>
                  : <>Currently <b className="text-heading">disabled</b> — all stores use their raw sales-based target with no floor.</>}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4 max-w-2xl">
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
