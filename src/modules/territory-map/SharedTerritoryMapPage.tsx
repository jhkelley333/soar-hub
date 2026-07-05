// Public Territory Map view — /map/:token, no login. The token in the URL
// is the credential (same pattern as the vendor QR portal); the server
// resolves the link's CREATOR and returns exactly the stores they can see,
// live at request time. An RVP's link shows their region; revoking the
// link (from the authed Territory Map page) kills this view immediately.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedTerritoryMap } from "./api";
import { TerritoryExplorer } from "./TerritoryMapPage";

export function SharedTerritoryMapPage() {
  const { token = "" } = useParams();

  const q = useQuery({
    queryKey: ["shared-territory-map", token],
    queryFn: () => fetchSharedTerritoryMap(token),
    enabled: !!token,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto flex h-screen max-w-[1500px] flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              SOAR Hub
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-midnight">Territory Map</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {q.data
                ? `Shared by ${q.data.shared_by} · ${q.data.total} stores · live view of their territory`
                : "Read-only shared view."}
            </p>
          </div>
        </div>

        {q.isLoading && (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading map…
          </div>
        )}
        {q.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center">
            <div className="text-sm font-semibold text-red-700">
              {(q.error as Error)?.message ?? "This share link is no longer active."}
            </div>
            <p className="mt-1 text-xs text-red-600">
              Ask whoever sent it to share a fresh link from their Territory Map.
            </p>
          </div>
        )}

        {q.data && <TerritoryExplorer data={q.data} />}
      </div>
    </div>
  );
}
