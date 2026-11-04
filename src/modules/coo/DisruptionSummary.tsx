// Business-disruption rollup for the COO: totals and a by-type breakdown over
// a chosen window, read from the same list the Business Disruptions module
// uses (shares its query key, so the list below it doesn't refetch).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Segmented } from "@/shared/ui/Segmented";
import { Skeleton } from "@/shared/ui/Skeleton";
import { fetchDisruptions } from "@/modules/business-disruptions/api";

type Window = "30" | "90" | "365";

export function DisruptionSummary() {
  const [win, setWin] = useState<Window>("30");
  const q = useQuery({ queryKey: ["business-disruptions"], queryFn: fetchDisruptions });

  const s = useMemo(() => {
    const cutoff = new Date(Date.now() - Number(win) * 86_400_000).toISOString().slice(0, 10);
    const rows = (q.data?.reports ?? []).filter((r) => (r.disruption_date ?? "") >= cutoff);
    const byType = new Map<string, number>();
    for (const r of rows) for (const t of r.closure_types ?? []) byType.set(t, (byType.get(t) ?? 0) + 1);
    const types = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    return {
      total: rows.length,
      closed: rows.filter((r) => r.store_closed).length,
      hours: rows.reduce((a, r) => a + (r.hours_disrupted ?? 0), 0),
      loss: rows.reduce((a, r) => a + (r.estimated_loss_sales || 0), 0),
      open: rows.filter((r) => r.status === "open").length,
      injuries: rows.filter((r) => r.employee_injured || r.customer_injured).length,
      types,
      max: types[0]?.[1] ?? 0,
    };
  }, [q.data, win]);

  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return null; // the module below shows its own error

  const tiles: [string, string][] = [
    ["Reports", String(s.total)],
    ["Store closures", String(s.closed)],
    ["Hours disrupted", s.hours.toLocaleString("en-US", { maximumFractionDigits: 1 })],
    ["Est. lost sales", `$${Math.round(s.loss).toLocaleString("en-US")}`],
    ["Awaiting review", String(s.open)],
    ["With an injury", String(s.injuries)],
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Segmented<Window> dense value={win} onChange={setWin}
          options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-xs font-medium text-ink-muted">{label}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-heading tabular-nums">{value}</div>
          </Card>
        ))}
      </div>
      {s.types.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-heading">By disruption type</h2>
          <div className="space-y-2">
            {s.types.map(([t, n]) => (
              <div key={t} className="flex items-center gap-3 text-sm">
                <div className="w-44 shrink-0 text-ink-2">{t}</div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(n / s.max) * 100}%` }} />
                </div>
                <div className="w-10 text-right font-semibold tabular-nums text-heading">{n}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
