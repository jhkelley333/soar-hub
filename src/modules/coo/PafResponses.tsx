// COO PAF responses — every PAF the COO can act on, in one list:
//   • Pending SDO / VP approval (bonuses, salary pay adjustments) — the
//     list-sdo-queue endpoint already returns all of these org-wide for COO.
//     Rows assigned to the COO come first; the rest are ones they can step in on.
//   • "Needs Approval" PAFs whose emailed approval link went to the COO
//     (approving_email) — approved in-app via the leader-approve path.
// Click a row for the full form; approve / reject from the drawer footer
// using the same actions (and server checks) as the rest of the Hub.

import { useState } from "react";
import { Card } from "@/shared/ui/Card";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Segmented } from "@/shared/ui/Segmented";
import { cn } from "@/lib/cn";
import type { PafRow } from "@/modules/paf/types";
import { PafDetail } from "@/modules/paf/PafDetail";
import { SdoActions } from "@/modules/paf/SdoActions";
import { LeaderApproveAction } from "@/modules/paf/LeaderApproveAction";
import { useCooPafQueue } from "./useCooPafQueue";

type Filter = "mine" | "all";

const money = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && isFinite(n) ? `$${Math.round(n).toLocaleString("en-US")}` : "—";
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function PafResponses() {
  const { rows, mineCount, isLoading, error } = useCooPafQueue();
  const [filter, setFilter] = useState<Filter>("mine");
  const [open, setOpen] = useState<PafRow | null>(null);

  const shown = filter === "mine" ? rows.filter((r) => r.mine) : rows;

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error) return <EmptyState title="Couldn't load PAFs" description={error.message} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {mineCount === 0 ? "Nothing is assigned to you right now." : `${mineCount} PAF${mineCount === 1 ? "" : "s"} assigned to you.`}
          {rows.length > mineCount && ` ${rows.length - mineCount} more pending you can step in on.`}
        </p>
        <Segmented<Filter> dense value={filter} onChange={setFilter}
          options={[{ value: "mine", label: "Assigned to me", count: mineCount }, { value: "all", label: "All pending", count: rows.length }]} />
      </div>

      {shown.length === 0 ? (
        <EmptyState title="You're all caught up" description={filter === "mine" ? "No PAFs are waiting on you. Switch to All pending to see the rest of the queue." : "No PAFs are pending approval."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
                  <th>Submitted</th><th>Employee</th><th>Store</th><th>Type</th><th className="!text-right">Est. cost</th><th>Submitted by</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map(({ paf, mine }) => {
                  const age = ageDays(paf.created_at);
                  return (
                    <tr key={paf.id} className="[&>td]:whitespace-nowrap [&>td]:px-3 [&>td]:py-2.5">
                      <td className="text-ink-muted">
                        {day(paf.created_at)}
                        {age >= 3 && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">{age}d</span>}
                      </td>
                      <td><button onClick={() => setOpen(paf)} className="font-semibold text-accent hover:underline">{paf.employee_name}</button></td>
                      <td className="text-ink-2">{paf.drive_in ? `#${paf.drive_in}` : "—"}{paf.store_name ? <span className="ml-1 text-ink-muted">{paf.store_name}</span> : null}</td>
                      <td className="text-ink-2">{paf.bonus_type ? `${paf.category} · ${paf.bonus_type}` : paf.category}</td>
                      <td className="text-right tabular-nums">{money(paf.estimated_cost)}</td>
                      <td className="text-ink-muted">{paf.submitter_name ?? paf.submitter_email}</td>
                      <td>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1",
                          mine ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-surface-muted text-ink-2 ring-border")}>
                          {mine ? "Waiting on you" : paf.status}
                        </span>
                      </td>
                      <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setOpen(paf)}>Review</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `PAF — ${open.employee_name}` : ""}
        footer={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>
            {open && (
              <div className="flex items-center gap-2">
                <SdoActions paf={open} onComplete={() => setOpen(null)} />
                <LeaderApproveAction paf={open} onComplete={() => setOpen(null)} />
              </div>
            )}
          </div>
        }
      >
        {open && <PafDetail paf={open} />}
      </Drawer>
    </div>
  );
}
