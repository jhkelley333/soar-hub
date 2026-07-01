// Territory Map — live map of every visible store, pin color keyed to the
// store's DO as resolved from the org data (user_scopes). Replaces the
// hand-maintained Google My Maps: reassign a district's DO and the pins
// recolor on their own; no manual pin placement.
//
// Phase 2 scope: map + colored pins + click popup. The legend/filter panel
// (Phase 3) and clustering (Phase 4) layer on top of the same data.
//
// Reads cached coordinates only (stores.latitude/longitude, migration 0121)
// — geocoding happens on write (org-mgmt) or via the geocode-missing batch,
// never on render.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { fetchTerritoryMap, type TerritoryStore } from "./api";
import { colorsForDos, DO_OPEN_COLOR } from "./colors";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
// Advanced Markers require a Map ID. A real one (with styling) can be set
// via env; Google's documented "DEMO_MAP_ID" sentinel works for rendering.
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

// DFW metro — default view before bounds fit (and fallback when empty).
const DFW_CENTER = { lat: 32.9, lng: -97.03 };
const DEFAULT_ZOOM = 9;

export function TerritoryMapPage() {
  const q = useQuery({
    queryKey: ["territory-map"],
    queryFn: fetchTerritoryMap,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const stores = useMemo(
    () => (q.data?.stores ?? []).filter((s) => s.latitude != null && s.longitude != null),
    [q.data],
  );
  const doColors = useMemo(
    () => colorsForDos(stores.map((s) => s.do_id).filter(Boolean) as string[]),
    [stores],
  );
  const [selected, setSelected] = useState<TerritoryStore | null>(null);

  if (!MAPS_KEY) {
    return (
      <div className="space-y-4">
        <PageHeader title="Territory Map" description="Stores colored by DO, live from the org data." />
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Google Maps isn't configured for the browser yet — set{" "}
          <code className="font-mono text-xs">VITE_GOOGLE_MAPS_API_KEY</code> in the site's
          environment (a key with the Maps JavaScript API enabled and HTTP-referrer
          restrictions) and redeploy.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <PageHeader
        title="Territory Map"
        description={
          q.data
            ? `${stores.length} of ${q.data.total} stores mapped` +
              (q.data.missing_coords > 0 ? ` · ${q.data.missing_coords} missing coordinates` : "")
            : "Stores colored by DO, live from the org data."
        }
      />

      {q.isLoading && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Loading stores…
        </div>
      )}
      {q.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(q.error as Error)?.message ?? "Couldn't load the store list."}
        </div>
      )}

      {q.data && (
        <div className="min-h-[480px] flex-1 overflow-hidden rounded-xl border border-zinc-200">
          <APIProvider apiKey={MAPS_KEY}>
            <Map
              mapId={MAP_ID}
              defaultCenter={DFW_CENTER}
              defaultZoom={DEFAULT_ZOOM}
              gestureHandling="greedy"
              disableDefaultUI={false}
              className="h-full w-full"
            >
              <FitToStores stores={stores} />
              {stores.map((s) => (
                <AdvancedMarker
                  key={s.id}
                  position={{ lat: s.latitude!, lng: s.longitude! }}
                  title={`#${s.number} ${s.name}`}
                  onClick={() => setSelected(s)}
                >
                  <Pin
                    background={s.do_id ? doColors.get(s.do_id) : DO_OPEN_COLOR}
                    borderColor="#ffffff"
                    glyphColor="#ffffff"
                    scale={0.9}
                  />
                </AdvancedMarker>
              ))}
              {selected && selected.latitude != null && selected.longitude != null && (
                <InfoWindow
                  position={{ lat: selected.latitude, lng: selected.longitude }}
                  pixelOffset={[0, -36]}
                  onCloseClick={() => setSelected(null)}
                >
                  <StorePopup store={selected} color={selected.do_id ? doColors.get(selected.do_id)! : DO_OPEN_COLOR} />
                </InfoWindow>
              )}
            </Map>
          </APIProvider>
        </div>
      )}
    </div>
  );
}

// Fit the viewport to the loaded pins once per data load. Skipped for a
// single store (bounds-fit would zoom to max); DFW default covers that.
function FitToStores({ stores }: { stores: TerritoryStore[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || stores.length < 2) return;
    const bounds = new google.maps.LatLngBounds();
    for (const s of stores) bounds.extend({ lat: s.latitude!, lng: s.longitude! });
    map.fitBounds(bounds, 48);
  }, [map, stores]);
  return null;
}

function StorePopup({ store, color }: { store: TerritoryStore; color: string }) {
  return (
    <div className="min-w-[220px] max-w-[280px] text-[13px] leading-snug text-zinc-800">
      <div className="font-semibold text-zinc-900">
        #{store.number} — {store.name}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="font-medium">{store.do_name ?? "DO OPEN"}</span>
      </div>
      <div className="mt-1 text-zinc-600">
        {[store.district_name, store.area_name].filter(Boolean).join(" · ") || "—"}
      </div>
      {store.address && (
        <div className="mt-1 flex items-start gap-1 text-zinc-500">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          {store.address}
        </div>
      )}
    </div>
  );
}
