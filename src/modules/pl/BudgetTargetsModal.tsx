// Budget & Targets editor — the store-controllable % of sales the P&L review
// measures each store against. Admin edits the targets; everyone can view.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchPlBudget, savePlBudget, type PlBudgetTarget } from "./api";

export function BudgetTargetsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === "admin";
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["pl-budget"], queryFn: fetchPlBudget, enabled: open, staleTime: 60_000 });

  // Local edits keyed by line_key -> string value (percent).
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => { if (open) setEdits({}); }, [open, q.data]);

  const targets = useMemo(() => q.data?.targets ?? [], [q.data]);
  const valueOf = (t: PlBudgetTarget) =>
    edits[t.line_key] !== undefined ? edits[t.line_key] : t.target_pct == null ? "" : String(t.target_pct);

  const dirty = useMemo(
    () => Object.entries(edits).filter(([k, v]) => {
      const t = targets.find((x) => x.line_key === k);
      const orig = t?.target_pct == null ? "" : String(t.target_pct);
      return v !== orig;
    }),
    [edits, targets],
  );

  const save = useMutation({
    mutationFn: () =>
      savePlBudget(
        dirty.map(([line_key, v]) => ({ line_key, target_pct: v.trim() === "" ? null : Number(v) })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pl-budget"] });
      setEdits({});
      toast.push("Budget targets saved.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Budget & Targets" maxWidth="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Company budget — store-controllable lines, as a % of sales. The P&L review flags each store's
          actuals against these.{!canEdit && " (View only — admin edits.)"}
        </p>
        {q.isLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : q.isError ? (
          <p className="text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load."}</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg ring-1 ring-zinc-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2 text-right">Budget (% of sales)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {targets.map((t) => (
                  <tr key={t.line_key} className={cn(t.is_group && "bg-amber-50/60")}>
                    <td className={cn("px-3 py-1.5", t.is_group ? "font-bold text-midnight" : t.group_key ? "pl-6 text-zinc-700" : "font-semibold text-midnight")}>
                      {t.label}
                      {t.verify_on_zero && <span className="ml-1 text-[10px] font-medium text-amber-600">· verify-on-$0</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {canEdit ? (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={valueOf(t)}
                            onChange={(e) => setEdits((p) => ({ ...p, [t.line_key]: e.target.value }))}
                            className="w-20 rounded-md border-0 bg-white px-2 py-1 text-right text-sm tabular-nums ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                          />
                          <span className="text-zinc-400">%</span>
                        </div>
                      ) : (
                        <span className="tabular-nums text-zinc-700">{t.target_pct == null ? "—" : `${t.target_pct.toFixed(2)}%`}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            <Button variant="primary" size="sm" disabled={!dirty.length || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "Saved"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
