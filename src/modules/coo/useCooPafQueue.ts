// The PAFs waiting on the COO — shared by the PAF section, its badge and the
// KPI board's "Needs your attention" line. See PafResponses.tsx for the rules.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { listPafs, listSdoQueue } from "@/modules/paf/api";

export function useCooPafQueue() {
  const { profile } = useAuth();
  const me = profile?.id ?? "";
  const myEmail = (profile?.email ?? "").toLowerCase();
  const sdoQ = useQuery({ queryKey: ["paf-sdo-queue"], queryFn: listSdoQueue, staleTime: 30_000 });
  const listQ = useQuery({ queryKey: ["paf-list"], queryFn: listPafs, staleTime: 30_000 });

  const rows = useMemo(() => {
    const pending = (sdoQ.data?.pafs ?? []).map((p) => ({ paf: p, mine: p.sdo_approver_id === me }));
    const needs = (listQ.data?.pafs ?? [])
      .filter((p) => p.status === "Needs Approval" && !p.archived && (p.approving_email ?? "").toLowerCase() === myEmail)
      .map((p) => ({ paf: p, mine: true }));
    const seen = new Set<string>();
    return [...pending, ...needs]
      .filter((r) => (seen.has(r.paf.id) ? false : (seen.add(r.paf.id), true)))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.paf.created_at.localeCompare(b.paf.created_at));
  }, [sdoQ.data, listQ.data, me, myEmail]);

  return {
    rows,
    mineCount: rows.filter((r) => r.mine).length,
    isLoading: sdoQ.isLoading || listQ.isLoading,
    error: (sdoQ.error ?? listQ.error) as Error | null,
  };
}

