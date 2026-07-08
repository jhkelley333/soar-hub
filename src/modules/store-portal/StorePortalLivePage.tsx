// Admin — live view of one store's Command Center. Renders exactly what the
// store screen shows (same PortalBody), fetched with the admin's session
// instead of the device-bound token, refreshing every 60 seconds — plus the
// stream of floor reports coming in from that screen. Read-mostly: the call
// sheet works; sending reports stays on the store's own screen.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RadioTower } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchPortalAdminSnapshot } from "./api";
import { Chrome, PortalBody, RightCallSheet } from "./StorePortalPage";

const KIND_CHIP: Record<string, string> = {
  tardiness: "bg-amber-100 text-amber-800",
  safety: "bg-red-100 text-red-700",
  equipment: "bg-blue-100 text-blue-700",
  issue: "bg-zinc-100 text-zinc-600",
};

export function StorePortalLivePage() {
  const { storeId = "" } = useParams();
  const [showCall, setShowCall] = useState(false);
  const q = useQuery({
    queryKey: ["store-portal-live", storeId],
    queryFn: () => fetchPortalAdminSnapshot(storeId),
    enabled: !!storeId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const today = useMemo(() => {
    const d = new Date();
    return {
      weekday: d.toLocaleDateString("en-US", { weekday: "long" }),
      date: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };
  }, []);

  if (q.isError) return <EmptyState title="Could not load the store view" description={(q.error as Error)?.message ?? "Try again."} />;
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;
  const data = q.data!;

  return (
    <div className="-m-4 sm:-m-6">
      {/* admin banner above the store chrome */}
      <div className="flex flex-wrap items-center gap-3 bg-zinc-900 px-6 py-2.5 text-white">
        <Link to="/admin/store-portal" className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-300 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Command Center Links
        </Link>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          <RadioTower className="h-4 w-4 text-emerald-400" /> Live view · Store #{data.store.number}
        </span>
        <span className="text-xs text-zinc-400">exactly what the store screen shows · refreshes every minute</span>
        {q.isFetching && <span className="text-xs text-zinc-500">updating…</span>}
      </div>

      <Chrome store={data.store} dateLabel={today}>
        <PortalBody data={data} isLoading={false} onCall={() => setShowCall(true)} onReport={() => {}} />

        {/* floor reports — admin-only extra, below the store page content */}
        <section className="mx-auto max-w-6xl px-6 pb-14">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-zinc-900">Floor reports</h2>
            <p className="mt-0.5 text-sm text-zinc-400">Sent from this store's screen — newest first. Only visible here, not on the store page.</p>
            {data.reports.length === 0 ? (
              <p className="mt-4 text-[15px] text-zinc-400">No reports yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-zinc-100">
                {data.reports.map((r, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span className={cn("mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-bold capitalize", KIND_CHIP[r.kind] ?? KIND_CHIP.issue)}>{r.kind}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-snug text-zinc-800">{r.message}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {r.reporter_name ? `${r.reporter_name} · ` : ""}
                        {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {showCall && <RightCallSheet contacts={data.contacts} onClose={() => setShowCall(false)} />}
      </Chrome>
    </div>
  );
}
