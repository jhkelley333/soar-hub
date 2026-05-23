// Work Orders → Settings → Approval Limits. Edits the authority ladder
// (migration 0077): each role's not-to-exceed (NTE) amount and whether
// it's active. A quote routes to the lowest ACTIVE role whose NTE covers
// it; above the top active tier it's handled out-of-system (verbal /
// Owner) and recorded. RVP+ only (backend re-checks).

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { useToast } from "@/shared/ui/Toaster";
import { fetchApprovalThresholds, saveApprovalThresholds } from "./api";
import type { ApprovalThreshold } from "./types";

interface Row {
  role: string;
  label: string;
  nte: string; // dollars, as typed
  is_active: boolean;
  sort_order: number;
}

function toRows(rows: ApprovalThreshold[]): Row[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      role: r.role,
      label: r.label,
      nte: (r.nte_cents / 100).toString(),
      is_active: r.is_active,
      sort_order: r.sort_order,
    }));
}

export function ApprovalLimitsTab() {
  const toast = useToast();
  const q = useQuery({
    queryKey: ["wo2", "approval-thresholds"],
    queryFn: () => fetchApprovalThresholds().then((r) => r.thresholds),
    staleTime: 60_000,
  });

  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (q.data) setRows(toRows(q.data));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      saveApprovalThresholds(
        rows.map((r) => ({
          role: r.role,
          nte_cents: Math.round((parseFloat(r.nte) || 0) * 100),
          is_active: r.is_active,
        })),
      ),
    onSuccess: (res) => {
      toast.push("Approval limits saved.", "success");
      setRows(toRows(res.thresholds));
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const activeRows = rows.filter((r) => r.is_active);
  const topActive = activeRows.length
    ? activeRows.reduce((a, b) =>
        (parseFloat(b.nte) || 0) > (parseFloat(a.nte) || 0) ? b : a,
      )
    : null;

  function patch(role: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.role === role ? { ...r, ...p } : r)));
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[13px] text-zinc-600">
        Each role can approve a quote up to its <strong>not-to-exceed (NTE)</strong>{" "}
        amount without bumping it up. A quote routes to the lowest{" "}
        <strong>active</strong> role whose NTE covers it. Anything above the top
        active tier
        {topActive ? (
          <> (currently <strong>{topActive.label} · ${topActive.nte}</strong>)</>
        ) : null}{" "}
        is handled out-of-system (verbal / Owner) and recorded on the ticket.
      </div>

      {q.isLoading && (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      )}
      {q.isError && (
        <div className="py-8 text-center text-sm text-red-700">
          {(q.error as Error)?.message ?? "Couldn't load limits."}
        </div>
      )}

      {q.data && (
        <>
          <div className="overflow-hidden rounded-md border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">NTE (approves up to)</th>
                  <th className="px-3 py-2 font-semibold">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.role} className={r.is_active ? "" : "bg-zinc-50/60"}>
                    <td className="px-3 py-2 font-medium text-midnight">{r.label}</td>
                    <td className="px-3 py-2">
                      <div className="relative w-36">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                          $
                        </span>
                        <Input
                          value={r.nte}
                          onChange={(e) => patch(r.role, { nte: e.target.value })}
                          inputMode="decimal"
                          className="pl-5"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2 text-[13px] text-zinc-700">
                        <input
                          type="checkbox"
                          checked={r.is_active}
                          onChange={(e) => patch(r.role, { is_active: e.target.checked })}
                          className="h-4 w-4 accent-accent"
                        />
                        {r.is_active ? "Active" : "Off"}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" strokeWidth={1.75} />
              )}
              Save limits
            </Button>
            <span className="text-[12px] text-zinc-500">
              Turn VP / COO on here when the org is ready for those tiers.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
