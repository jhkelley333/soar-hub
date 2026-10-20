// Admin-only bulk close-out. Lists every PTO request still sitting in a
// post-approval state ("SDO/RVP Approved" awaiting a PAF confirm, or legacy
// "PAF Submitted" awaiting close), with select-all + a single "Close out
// selected" button that finalizes them all to "Closed" in one call.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusPill } from "@/shared/ui/StatusPill";
import { useToast } from "@/shared/ui/Toaster";
import { closeoutBulkPto, listCloseoutPending } from "./api";
import { statusKind } from "./statusMeta";
import type { PtoRow } from "./types";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function AdminCloseoutPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const query = useQuery({ queryKey: ["ea-closeout"], queryFn: listCloseoutPending });
  const rows = useMemo(() => query.data?.ptoRequests ?? [], [query.data]);

  const allSelected = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const closeout = useMutation({
    mutationFn: (ids: string[]) => closeoutBulkPto(ids),
    onSuccess: (r) => {
      toast.push(
        `Closed out ${r.done}${r.failed ? ` · ${r.failed} couldn't be closed` : ""}.`,
        r.failed ? "info" : "success",
      );
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["ea-closeout"] });
      qc.invalidateQueries({ queryKey: ["ea-queue"] });
      qc.invalidateQueries({ queryKey: ["ea-list"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Close-out failed.", "error"),
  });

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load close-out queue"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing to close out"
          description="Every approved PTO request has been finalized."
        />
      </Card>
    );
  }

  const pickedIds = rows.filter((r) => picked.has(r.id)).map((r) => r.id);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        PTO requests approved but not yet finalized. Select the ones to close out, then click
        <span className="font-medium text-midnight"> Close out selected</span> — they move straight to
        <span className="font-medium text-midnight"> Closed</span>.
      </p>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={allSelected} onChange={toggleAll} />
          Select all ({rows.length})
        </label>
        <span className="ml-auto text-sm text-zinc-600">{pickedIds.length} selected</span>
        {picked.size > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        )}
        <Button
          size="sm"
          disabled={pickedIds.length === 0 || closeout.isPending}
          onClick={() => closeout.mutate(pickedIds)}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
          {closeout.isPending ? "Closing…" : `Close out ${pickedIds.length || ""}`.trim()}
        </Button>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <CloseoutRow key={r.id} row={r} checked={picked.has(r.id)} onToggle={() => toggle(r.id)} />
        ))}
      </div>
    </div>
  );
}

function CloseoutRow({ row, checked, onToggle }: { row: PtoRow; checked: boolean; onToggle: () => void }) {
  const isHourly = row.position === "Associate Manager" || row.position === "First Assistant";
  return (
    <Card className={checked ? "ring-2 ring-accent/40" : undefined}>
      <CardBody className="flex flex-wrap items-center gap-3 py-3">
        <input type="checkbox" className="h-4 w-4 accent-accent" checked={checked} onChange={onToggle} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            {row.position && <span className="text-xs text-zinc-400">{row.position}</span>}
            <StatusPill kind={statusKind(row.status)}>{row.status}</StatusPill>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>Store #{row.store_number}{row.store_name ? ` — ${row.store_name}` : ""}</span>
            <span>{row.pto_start_date} → {row.pto_end_date}</span>
            {isHourly ? (
              <span>{row.vacation_hours ?? 0} hrs{row.amount != null ? ` · ${fmtMoney(row.amount)}` : ""}</span>
            ) : (
              <span>{row.days_used ?? 0} day(s)</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-zinc-400">{new Date(row.created_at).toLocaleDateString()}</div>
      </CardBody>
    </Card>
  );
}
