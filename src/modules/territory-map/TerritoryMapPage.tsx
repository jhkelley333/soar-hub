// Territory Map — live map of every visible store, pin color keyed to the
// store's DO as resolved from the org data (user_scopes). Replaces the
// hand-maintained Google My Maps: reassign a district's DO and the pins
// recolor on their own; no manual pin placement.
//
// TerritoryExplorer holds the whole interactive surface (filters, DO
// legend, map, clustering) and is shared with SharedTerritoryMapPage —
// the public, token-in-URL view (migration 0208) where the viewer sees
// exactly the stores the link's creator can see. This authed page adds
// the Share controls on top.
//
// Reads cached coordinates only (stores.latitude/longitude, migration 0121)
// — geocoding happens on write (org-mgmt) or via the geocode-missing batch,
// never on render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { MarkerClusterer, type Marker } from "@googlemaps/markerclusterer";
import { Copy, Eye, EyeOff, MapPin, Share2, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  fetchMapShare,
  fetchTerritoryMap,
  revokeMapShare,
  type TerritoryMapResponse,
  type TerritoryStore,
} from "./api";
import { colorsForDos, DO_OPEN_COLOR } from "./colors";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
// Advanced Markers require a Map ID. A real one (with styling) can be set
// via env; Google's documented "DEMO_MAP_ID" sentinel works for rendering.
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

// DFW metro — default view before bounds fit (and fallback when empty).
const DFW_CENTER = { lat: 32.9, lng: -97.03 };
const DEFAULT_ZOOM = 9;

// Legend key for stores whose district has no DO ("DO OPEN"). A sentinel
// string keeps the toggle set uniform (Set<string> of DO keys).
const OPEN_KEY = "__open__";

const ALL = "all";

export function TerritoryMapPage() {
  const toast = useToast();
  const q = useQuery({
    queryKey: ["territory-map"],
    queryFn: fetchTerritoryMap,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Share link — fetched lazily the first time the panel opens.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const openShare = useMutation({
    mutationFn: fetchMapShare,
    onSuccess: (r) => {
      setShareUrl(`${window.location.origin}/map/${r.token}`);
      setShareOpen(true);
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't create the share link.", "error"),
  });
  const revoke = useMutation({
    mutationFn: revokeMapShare,
    onSuccess: () => {
      setShareUrl(null);
      setShareOpen(false);
      toast.push("Share link revoked — the old URL is dead. Share again to mint a new one.", "info");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't revoke.", "error"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <PageHeader
        title="Territory Map"
        description={
          q.data
            ? `${q.data.total} stores` +
              (q.data.missing_coords > 0 ? ` · ${q.data.missing_coords} missing coordinates` : "")
            : "Stores colored by DO, live from the org data."
        }
        actions={
          <button
            type="button"
            onClick={() => (shareUrl ? setShareOpen((o) => !o) : openShare.mutate())}
            disabled={openShare.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-midnight hover:border-accent disabled:opacity-50"
            title="Share a read-only link — the viewer sees exactly the stores you can see, no login needed"
          >
            <Share2 className="h-4 w-4" strokeWidth={2} />
            {openShare.isPending ? "Creating…" : "Share"}
          </button>
        }
      />

      {shareOpen && shareUrl && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-midnight">Share this map</div>
              <p className="mt-0.5 text-xs text-zinc-600">
                Anyone with this link sees <strong>exactly the stores you can see</strong> — scoped to
                your org visibility, live, no login needed. Revoke kills the link immediately.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 font-mono text-xs text-midnight focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl).then(
                      () => toast.push("Link copied.", "success"),
                      () => toast.push("Couldn't copy — select the text and copy manually.", "error"),
                    );
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:brightness-110"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => revoke.mutate()}
                  disabled={revoke.isPending}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50 disabled:opacity-50"
                >
                  {revoke.isPending ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShareOpen(false)}
              className="rounded p-1 text-zinc-400 hover:text-zinc-700"
              aria-label="Close share panel"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

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

      {q.data && <TerritoryExplorer data={q.data} />}
    </div>
  );
}

// ── The interactive map surface — filters, DO legend, map, clustering. ──
// Shared between the authed page above and the public share view.
export function TerritoryExplorer({ data }: { data: TerritoryMapResponse }) {
  // Every store with cached coordinates — the mappable set.
  const mapped = useMemo(
    () => data.stores.filter((s) => s.latitude != null && s.longitude != null),
    [data],
  );
  const doColors = useMemo(
    () => colorsForDos(mapped.map((s) => s.do_id).filter(Boolean) as string[]),
    [mapped],
  );

  // Org cascade filters. Changing a parent resets its children so the
  // narrower selection can never point outside the parent.
  const [region, setRegion] = useState(ALL);
  const [area, setArea] = useState(ALL);
  const [district, setDistrict] = useState(ALL);
  // DO visibility toggles — keys are DO profile ids (or OPEN_KEY).
  const [hiddenDos, setHiddenDos] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TerritoryStore | null>(null);

  // Options for each select come from the FULL org hierarchy in the
  // payload (every region/area/district, even ones with no mapped stores
  // yet), narrowed by the levels above it. Store filtering below still
  // works off each store row's own org ids.
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const regionOptions = useMemo(() => [...(data.regions ?? [])].sort(byName), [data]);
  const areaOptions = useMemo(() => {
    const all = data.areas ?? [];
    return (region === ALL ? [...all] : all.filter((a) => a.region_id === region)).sort(byName);
  }, [data, region]);
  const districtOptions = useMemo(() => {
    const all = data.districts ?? [];
    const areaIds =
      area !== ALL ? new Set([area]) : region !== ALL ? new Set(areaOptions.map((a) => a.id)) : null;
    return (areaIds ? all.filter((d) => d.area_id && areaIds.has(d.area_id)) : [...all]).sort(byName);
  }, [data, area, region, areaOptions]);

  const areaPool = useMemo(
    () => (region === ALL ? mapped : mapped.filter((s) => s.region_id === region)),
    [mapped, region],
  );
  const districtPool = useMemo(
    () => (area === ALL ? areaPool : areaPool.filter((s) => s.area_id === area)),
    [areaPool, area],
  );

  // Org-filtered set (before DO toggles) — the legend counts key off this,
  // so narrowing to a region shows each DO's store count within it.
  const orgFiltered = useMemo(
    () => (district === ALL ? districtPool : districtPool.filter((s) => s.district_id === district)),
    [districtPool, district],
  );

  // Legend rows: DOs present in the org-filtered set, alphabetical, with
  // DO OPEN pinned to the bottom.
  const legend = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; color: string; count: number }>();
    for (const s of orgFiltered) {
      const key = s.do_id ?? OPEN_KEY;
      const entry = byKey.get(key);
      if (entry) entry.count++;
      else {
        byKey.set(key, {
          key,
          name: s.do_id ? s.do_name ?? "Unknown DO" : "DO OPEN",
          color: s.do_id ? doColors.get(s.do_id) ?? DO_OPEN_COLOR : DO_OPEN_COLOR,
          count: 1,
        });
      }
    }
    const rows = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    const open = rows.findIndex((r) => r.key === OPEN_KEY);
    if (open !== -1) rows.push(rows.splice(open, 1)[0]);
    return rows;
  }, [orgFiltered, doColors]);

  // What actually renders: org filters AND DO toggles.
  const visible = useMemo(
    () => orgFiltered.filter((s) => !hiddenDos.has(s.do_id ?? OPEN_KEY)),
    [orgFiltered, hiddenDos],
  );

  // Don't leave a popup floating for a pin that was just filtered away.
  useEffect(() => {
    if (selected && !visible.some((s) => s.id === selected.id)) setSelected(null);
  }, [visible, selected]);

  const toggleDo = (key: string) =>
    setHiddenDos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const resetAll = () => {
    setRegion(ALL);
    setArea(ALL);
    setDistrict(ALL);
    setHiddenDos(new Set());
  };
  const filtersActive = region !== ALL || area !== ALL || district !== ALL || hiddenDos.size > 0;

  if (!MAPS_KEY) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Google Maps isn't configured for the browser yet — set{" "}
        <code className="font-mono text-xs">VITE_GOOGLE_MAPS_API_KEY</code> in the site's
        environment (a key with the Maps JavaScript API enabled and HTTP-referrer
        restrictions) and redeploy.
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* legend + filters */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
        <div className="space-y-2 border-b border-zinc-100 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Filters</span>
            {filtersActive && (
              <button type="button" onClick={resetAll} className="text-xs font-semibold text-accent hover:underline">
                Reset
              </button>
            )}
          </div>
          <FilterSelect
            label="Region"
            value={region}
            options={regionOptions}
            onChange={(v) => { setRegion(v); setArea(ALL); setDistrict(ALL); }}
          />
          <FilterSelect
            label="Area"
            value={area}
            options={areaOptions}
            onChange={(v) => { setArea(v); setDistrict(ALL); }}
          />
          <FilterSelect
            label="District"
            value={district}
            options={districtOptions}
            onChange={setDistrict}
          />
        </div>

        <div className="flex items-center justify-between px-3 pb-1 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            DOs ({legend.length})
          </span>
          <span className="text-[11px] tabular-nums text-zinc-400">
            {visible.length} of {data.total} shown
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {legend.map((row) => {
            const hidden = hiddenDos.has(row.key);
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => toggleDo(row.key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-zinc-50",
                  hidden && "opacity-40",
                )}
                title={hidden ? "Show this DO's stores" : "Hide this DO's stores"}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: row.color }}
                />
                <span className={cn("min-w-0 flex-1 truncate font-medium text-midnight", hidden && "line-through")}>
                  {row.name}
                </span>
                <span className="tabular-nums text-xs text-zinc-500">({row.count})</span>
                {hidden
                  ? <EyeOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={2} />
                  : <Eye className="h-3.5 w-3.5 shrink-0 text-zinc-300" strokeWidth={2} />}
              </button>
            );
          })}
          {legend.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-zinc-400">No stores match these filters.</p>
          )}
        </div>
      </div>

      {/* map */}
      <div className="min-h-[480px] overflow-hidden rounded-xl border border-zinc-200">
        <APIProvider apiKey={MAPS_KEY}>
          <GoogleMap
            mapId={MAP_ID}
            defaultCenter={DFW_CENTER}
            defaultZoom={DEFAULT_ZOOM}
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="h-full w-full"
          >
            <FitToStores stores={mapped} />
            <ClusteredStoreMarkers stores={visible} doColors={doColors} onSelect={setSelected} />
            {selected && selected.latitude != null && selected.longitude != null && (
              <InfoWindow
                position={{ lat: selected.latitude, lng: selected.longitude }}
                pixelOffset={[0, -36]}
                onCloseClick={() => setSelected(null)}
              >
                <StorePopup store={selected} color={selected.do_id ? doColors.get(selected.do_id)! : DO_OPEN_COLOR} />
              </InfoWindow>
            )}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border-0 bg-white px-2.5 py-1.5 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value={ALL}>All {label.toLowerCase()}s</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}

// Fit the viewport to the full mapped set once per data load — deliberately
// NOT refit on filter/toggle changes, so narrowing the list doesn't yank
// the camera around. Skipped for a single store (bounds-fit would zoom to
// max); the DFW default covers that.
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

// Clustered store pins. React renders the AdvancedMarkers (so each keeps
// its DO color + click handler); the clusterer takes over positioning —
// collapsing dense areas into count bubbles — via collected marker refs.
// Filters/toggles compose for free: a filtered-out store's marker unmounts,
// its ref callback fires with null, and the clusterer re-groups without it.
function ClusteredStoreMarkers({
  stores,
  doColors,
  onSelect,
}: {
  stores: TerritoryStore[];
  doColors: globalThis.Map<string, string>;
  onSelect: (s: TerritoryStore) => void;
}) {
  const map = useMap();
  // Marker instances live in a MUTABLE Map, not React state. Inline ref
  // callbacks re-fire on every render (null, then the marker again) — with
  // state that meant two real updates per render, each scheduling another
  // render: the "maximum update depth exceeded" crash (React #185) this
  // page shipped with. A ref mutation triggers nothing; the effect below
  // resyncs the clusterer only when the visible store set actually changes.
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());

  // One clusterer per map instance. The renderer draws the count bubble as
  // an AdvancedMarkerElement (a mapId map shouldn't mix in legacy markers).
  const clusterer = useMemo(() => {
    if (!map) return null;
    return new MarkerClusterer({
      map,
      renderer: {
        render: ({ count, position }) => {
          const el = document.createElement("div");
          el.style.cssText =
            "display:grid;place-items:center;border-radius:9999px;" +
            "background:#1C3D5C;color:#fff;font:600 12px/1 system-ui,sans-serif;" +
            "border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);" +
            `width:${Math.min(56, 30 + Math.floor(Math.log10(count) * 10))}px;` +
            `height:${Math.min(56, 30 + Math.floor(Math.log10(count) * 10))}px;`;
          el.textContent = String(count);
          return new google.maps.marker.AdvancedMarkerElement({
            position,
            content: el,
            zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
          });
        },
      },
    });
  }, [map]);

  // Resync the clusterer AFTER the markers for the current store set have
  // committed (ref callbacks run before effects in the same commit). Keyed
  // on `stores` — unrelated re-renders (e.g. opening a popup) leave the
  // deps unchanged and don't touch the clusterer.
  useEffect(() => {
    if (!clusterer) return;
    clusterer.clearMarkers();
    clusterer.addMarkers(Array.from(markersRef.current.values()));
  }, [clusterer, stores]);

  // Tear the clusterer down with the map (StrictMode remounts, page nav).
  useEffect(() => () => clusterer?.setMap(null), [clusterer]);

  const setMarkerRef = useCallback((marker: Marker | null, id: string) => {
    if (marker) markersRef.current.set(id, marker);
    else markersRef.current.delete(id);
  }, []);

  return (
    <>
      {stores.map((s) => (
        <AdvancedMarker
          key={s.id}
          position={{ lat: s.latitude!, lng: s.longitude! }}
          title={`#${s.number} ${s.name}`}
          onClick={() => onSelect(s)}
          ref={(marker) => setMarkerRef(marker, s.id)}
        >
          <Pin
            background={s.do_id ? doColors.get(s.do_id) : DO_OPEN_COLOR}
            borderColor="#ffffff"
            glyphColor="#ffffff"
            scale={0.9}
          />
        </AdvancedMarker>
      ))}
    </>
  );
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
