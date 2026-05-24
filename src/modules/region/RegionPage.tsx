// Stores — directory of every store in the caller's scope. Real data
// only: store number (SDI), city/state, DO + GM, and district code,
// pulled from the org tree (RLS-scoped). Tap a store to drill in.
//
// NOTE: the scored "region rollup" treatment (ops index, tier
// breakdown, score rings, sparklines) was removed here because that
// scoring was placeholder. The scored presentation now lives in the
// Ranker, which has real weekly performance data.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchRegionRollup, type RegionStore } from "./api";

export function RegionPage() {
  const query = useQuery({
    queryKey: ["region-rollup"],
    queryFn: fetchRegionRollup,
    staleTime: 60_000,
  });

  const stores = useMemo(() => {
    const list = query.data?.stores ?? [];
    return [...list].sort((a, b) =>
      a.sdi.localeCompare(b.sdi, undefined, { numeric: true }),
    );
  }, [query.data?.stores]);

  return (
    <div className="mx-auto min-h-full w-full max-w-md bg-surface-muted">
      <AppHeader
        title={query.data?.scopeLabel ?? "Stores"}
        subtitle={query.data?.scopeSummary ?? "Loading…"}
        trailing={
          <button
            type="button"
            className="text-midnight-500 hover:text-midnight-800"
            aria-label="Search stores"
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </button>
        }
      />

      {query.isLoading && (
        <div className="space-y-2 p-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {query.isError && (
        <div className="p-4">
          <EmptyState
            title="Couldn't load your stores"
            description={(query.error as Error)?.message ?? "Try again."}
          />
        </div>
      )}

      {query.data && (
        <div className="space-y-1.5 px-3 py-3 pb-6">
          {stores.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-midnight-500">
              No stores in your scope yet.
            </p>
          ) : (
            stores.map((s) => <StoreRow key={s.id} store={s} />)
          )}
        </div>
      )}
    </div>
  );
}

function StoreRow({ store }: { store: RegionStore }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left shadow-card ring-1 ring-midnight-100 transition hover:ring-midnight-200"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium text-midnight-500">
            SDI {store.sdi}
          </span>
          {store.city && (
            <>
              <span className="text-midnight-300">·</span>
              <span className="truncate text-[13px] text-midnight-800">
                {store.city}
                {store.state ? `, ${store.state}` : ""}
              </span>
            </>
          )}
        </div>
        {(store.do || store.gm) && (
          <div className="mt-0.5 truncate text-[11.5px] text-midnight-500">
            {[store.do && `DO ${store.do}`, store.gm && `GM ${store.gm}`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {store.districtCode && (
          <div className="mt-1 font-mono text-[11px] text-midnight-500">
            {store.districtCode}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-midnight-300" strokeWidth={2} />
    </button>
  );
}
