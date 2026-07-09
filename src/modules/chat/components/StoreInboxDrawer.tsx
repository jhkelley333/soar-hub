// Chat — the leader Inbox: one-way floor reports submitted from the Store
// Command Center desktops. No replies — each report is worked with two
// actions: Resolve, or Escalate to the DO (which also pings the DO on Chat).
// GMs see everything for their store; DO/SDO/RVP see what was escalated to
// them; admin/VP/COO see all stores.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  escalateStoreReport, fetchStoreInbox, resolveStoreReport, type StoreInboxReport,
} from "@/modules/store-portal/api";
import { formatChatTime } from "../time";

export const STORE_INBOX_KEY = ["chat", "store-inbox"];
export const INBOX_VIEWER_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);

export function useStoreInbox(enabled: boolean) {
  return useQuery({
    queryKey: STORE_INBOX_KEY,
    queryFn: fetchStoreInbox,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  safety: { label: "Safety", cls: "bg-red-50 text-red-700 ring-red-200" },
  tardiness: { label: "Tardiness", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  equipment: { label: "Equipment", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  issue: { label: "Issue", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

export function StoreInboxDrawer({ open, onClose, canEscalate }: {
  open: boolean; onClose: () => void; canEscalate: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useStoreInbox(open);
  const reports = q.data?.reports ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: STORE_INBOX_KEY });
  const resolve = useMutation({
    mutationFn: resolveStoreReport,
    onSuccess: () => { toast.push("Resolved.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not resolve.", "error"),
  });
  const escalate = useMutation({
    mutationFn: escalateStoreReport,
    onSuccess: (r) => {
      toast.push(r.notified ? `Escalated — ${r.notified} was pinged on Chat.` : "Escalated. No DO found to ping.", "success");
      invalidate();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not escalate.", "error"),
  });

  return (
    <Drawer open={open} onClose={onClose} title={`Inbox · ${reports.length}`}>
      <p className="mb-3 text-[13px] text-midnight-400">
        Reports from the store screens. One-way — resolve them here, or push one up to the DO.
      </p>
      {q.isLoading ? (
        <p className="py-8 text-center text-[13px] text-midnight-400">Loading…</p>
      ) : q.isError ? (
        <EmptyState title="Couldn't load the inbox" description={(q.error as Error)?.message ?? "Try again."} />
      ) : reports.length === 0 ? (
        <EmptyState title="All clear" description="Nothing waiting from the store floor." />
      ) : (
        <ul className="space-y-2.5">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} canEscalate={canEscalate}
              onResolve={() => resolve.mutate(r.id)}
              onEscalate={() => escalate.mutate(r.id)}
              busy={resolve.isPending || escalate.isPending} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function ReportCard({ report: r, canEscalate, onResolve, onEscalate, busy }: {
  report: StoreInboxReport; canEscalate: boolean; onResolve: () => void; onEscalate: () => void; busy: boolean;
}) {
  const kind = KIND_STYLE[r.kind] ?? KIND_STYLE.issue;
  return (
    <li className="rounded-xl border border-midnight-100 bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", kind.cls)}>
          {r.kind === "safety" && <AlertTriangle className="h-3 w-3" />}
          {kind.label}
        </span>
        <span className="text-[12.5px] font-semibold text-midnight-700">
          Store #{r.store.number ?? "?"}{r.store.name ? ` · ${r.store.name}` : ""}
        </span>
        <span className="ml-auto text-[11.5px] text-midnight-400">{formatChatTime(r.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-[14px] leading-snug text-midnight-800">{r.message}</p>
      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-midnight-400">
        {r.reporter_name && <span>Reported by {r.reporter_name}</span>}
        {r.status === "escalated" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-700 ring-1 ring-inset ring-purple-200">
            <ArrowUpRight className="h-3 w-3" /> Escalated to DO
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        {canEscalate && r.status === "new" && (
          <button onClick={onEscalate} disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-midnight-200 px-3 py-1.5 text-[12.5px] font-semibold text-midnight-700 transition hover:border-accent disabled:opacity-40">
            <ArrowUpRight className="h-3.5 w-3.5" /> Escalate to DO
          </button>
        )}
        <button onClick={onResolve} disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-midnight px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          <Check className="h-3.5 w-3.5" /> Resolve
        </button>
      </div>
    </li>
  );
}
