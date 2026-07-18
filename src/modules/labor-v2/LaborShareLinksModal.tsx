// Admin/VP panel to mint the public labor links — one per RVP region plus a
// company-wide link. Each link is read-only (Company → RVP → SDO → DO → Store)
// and stays live until revoked. Mirrors the Territory Map share pattern.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Trash2, Plus, Loader2 } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { fetchLaborShares, mintLaborShare, revokeLaborShare, type LaborShare } from "./api";

interface Scope { key: string; label: string; regionId: string | null; }

export function LaborShareLinksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["labor-shares"], queryFn: fetchLaborShares, enabled: open });

  const scopes = useMemo<Scope[]>(() => {
    const regions = q.data?.regions ?? [];
    return [
      { key: "company", label: "Company (all regions)", regionId: null },
      ...regions.map((r) => ({ key: r.id, label: r.name, regionId: r.id })),
    ];
  }, [q.data]);

  const shareByScope = useMemo(() => {
    const m = new Map<string, LaborShare>();
    for (const s of q.data?.shares ?? []) m.set(s.region_id ?? "company", s);
    return m;
  }, [q.data]);

  const mint = useMutation({
    mutationFn: (input: { region_id?: string | null; label?: string }) => mintLaborShare(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["labor-shares"] }); toast.push("Link created.", "success"); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't create the link.", "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeLaborShare(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["labor-shares"] }); toast.push("Link revoked.", "success"); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't revoke.", "error"),
  });

  async function copy(token: string) {
    const url = `${window.location.origin}/labor/${token}`;
    try { await navigator.clipboard.writeText(url); toast.push("Link copied.", "success"); }
    catch { toast.push(url, "info"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Labor share links"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-xs text-zinc-500">
        Public, read-only links your team can open without logging in. Each shows a live drill-down —
        Company → RVP → SDO → DO → Store — with Yesterday / PTD / YTD labor, Act vs Schedule, and the
        week-over-week trend. A region link is scoped to that RVP; the company link shows everything.
      </p>

      {q.isLoading ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {scopes.map((sc) => {
            const share = shareByScope.get(sc.regionId ?? "company");
            return (
              <div key={sc.key} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-midnight">{sc.label}</div>
                  {share ? (
                    <div className="truncate text-[11px] text-zinc-400">
                      /labor/{share.token.slice(0, 10)}… {share.last_used_at ? `· opened ${new Date(share.last_used_at).toLocaleDateString()}` : "· never opened"}
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-400">No link yet</div>
                  )}
                </div>
                {share ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => copy(share.token)}>
                      <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(share.id)} disabled={revoke.isPending} className="text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => mint.mutate({ region_id: sc.regionId, label: sc.regionId ? sc.label : "Company" })} disabled={mint.isPending}>
                    {mint.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                    Create
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Link2 className="h-3 w-3" /> Links stay live until revoked. Revoking kills the URL immediately.
      </div>
    </Modal>
  );
}
