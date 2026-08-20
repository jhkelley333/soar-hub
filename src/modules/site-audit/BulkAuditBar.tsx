// Shared bulk-action bar for RVP+ managing many audits at once. Rendered by both
// the desktop Command overview and the mobile list when audits are selected.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Trash2, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { bulkArchiveAudits, bulkDeleteAudits } from "./api";

const plural = (n: number) => `${n} audit${n === 1 ? "" : "s"}`;

export function BulkAuditBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["site-audits"] });

  const archive = useMutation({
    mutationFn: () => bulkArchiveAudits({ audit_ids: ids }),
    onSuccess: (r) => { toast.push(`Archived ${plural(r.affected)}.`, "success"); invalidate(); onDone(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't archive.", "error"),
  });
  const del = useMutation({
    mutationFn: () => bulkDeleteAudits({ audit_ids: ids }),
    onSuccess: (r) => { toast.push(`Deleted ${plural(r.affected)}.`, "success"); invalidate(); onDone(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't delete.", "error"),
  });
  const busy = archive.isPending || del.isPending;

  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-float backdrop-blur">
      <span className="text-sm font-semibold text-midnight">{ids.length === 0 ? "Select audits" : `${ids.length} selected`}</span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy || ids.length === 0} onClick={() => archive.mutate()}>
          <Archive className="h-4 w-4" /> Archive
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || ids.length === 0}
          className="text-red-600 ring-red-200 hover:bg-red-50"
          onClick={() => { if (window.confirm(`Delete ${plural(ids.length)}? This can't be undone.`)) del.mutate(); }}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDone} aria-label="Done selecting"><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
