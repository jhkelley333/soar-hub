// COO Map — cross-brand executive view at /coo-map. Sonic + Apricus Little
// Caesars stores on one Google Map, for users with multi-company access only.
// Markers are grouped by "district" (Sonic = DO, Little Caesars = market); each
// group's shape + color is customizable (persisted per browser) so an exec can
// tune the view like Google My Maps. Route + nav are gated on company_access > 1.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { APIProvider, Map as GoogleMap, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { RefreshCw, SlidersHorizontal, Navigation, RotateCcw, Download } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchTerritoryMap, type TerritoryStore } from "@/modules/territory-map/api";
import { colorsForDos, colorsForKeys, DO_OPEN_COLOR } from "@/modules/territory-map/colors";
import { useCompanyAccess } from "./useCompanyAccess";
import { fetchCooMapStores, geocodeApricus, type ApricusStore } from "./api";
import {
  MARKER_SHAPES, asHexInput, loadMarkerStyles, saveMarkerStyles,
  type MarkerShape, type GroupStyle,
} from "./markerStyles";
import { appleMapsDirections, googleMapsDirections } from "./mapLinks";
import { buildStoresKml, downloadKml, type KmlPoint } from "./kmlExport";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";
const US_CENTER = { lat: 39.5, lng: -86 };
const LC_ORANGE = "#FF6000";

type Sel =
  | { brand: "sonic"; s: TerritoryStore }
  | { brand: "lc"; s: ApricusStore }
  | null;

// A "district" bucket spanning both brands — Sonic DOs and LC markets share the
// same styling model.
interface Group {
  key: string;
  label: string;
  brand: "sonic" | "lc";
  count: number;
  defColor: string;
  defShape: MarkerShape;
}

const sonicKey = (s: TerritoryStore) => `sonic:${s.do_id ?? "open"}`;
const lcKey = (s: ApricusStore) => `lc:${s.market ?? "—"}`;

// A single map marker glyph in the chosen shape + color. CSS-only so it stays
// crisp at any zoom and needs no image assets.
function MarkerGlyph({ shape, color, size = 16 }: { shape: MarkerShape; color: string; size?: number }) {
  const base: CSSProperties = {
    width: size, height: size, background: color,
    border: "2px solid #fff", boxSizing: "border-box",
    boxShadow: "0 1px 3px rgba(0,0,0,.4)",
  };
  if (shape === "circle") return <div style={{ ...base, borderRadius: "50%" }} />;
  if (shape === "square") return <div style={{ ...base, borderRadius: 3 }} />;
  if (shape === "diamond") return <div style={{ ...base, borderRadius: 2, transform: "rotate(45deg)" }} />;
  if (shape === "pin") return <div style={{ ...base, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)" }} />;
  if (shape === "triangle")
    return (
      <div style={{
        width: 0, height: 0,
        borderLeft: `${size / 2}px solid transparent`,
        borderRight: `${size / 2}px solid transparent`,
        borderBottom: `${size}px solid ${color}`,
        filter: "drop-shadow(0 1px 1px rgba(0,0,0,.45))",
      }} />
    );
  // star
  return (
    <div style={{
      width: size + 4, height: size + 4, background: color,
      clipPath: "polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)",
      filter: "drop-shadow(0 1px 1px rgba(0,0,0,.45))",
    }} />
  );
}

// Fit the viewport to all plotted stores once per load.
function FitAll({ pts }: { pts: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || pts.length < 2) return;
    const b = new google.maps.LatLngBounds();
    for (const p of pts) b.extend(p);
    map.fitBounds(b, 56);
  }, [map, pts]);
  return null;
}

export function CooMapPage() {
  const { multiCompany, isLoading: accessLoading } = useCompanyAccess();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const toast = useToast();
  const [showSonic, setShowSonic] = useState(true);
  const [showLc, setShowLc] = useState(true);
  const [showStyle, setShowStyle] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, GroupStyle>>(() => loadMarkerStyles());
  useEffect(() => saveMarkerStyles(overrides), [overrides]);

  const sonicQ = useQuery({ queryKey: ["coo-territory"], queryFn: fetchTerritoryMap, staleTime: 5 * 60_000, enabled: multiCompany });
  const lcQ = useQuery({ queryKey: ["coo-lc"], queryFn: fetchCooMapStores, staleTime: 5 * 60_000, enabled: multiCompany });

  const sonic = useMemo(() => (sonicQ.data?.stores ?? []).filter((s) => s.latitude != null && s.longitude != null), [sonicQ.data]);
  const lc = useMemo(() => (lcQ.data?.apricus ?? []), [lcQ.data]);
  const lcPlotted = useMemo(() => lc.filter((s) => s.latitude != null && s.longitude != null), [lc]);
  const doColors = useMemo(() => colorsForDos(sonic.map((s) => s.do_id).filter(Boolean) as string[]), [sonic]);
  const marketColors = useMemo(() => colorsForKeys([...new Set(lc.map((s) => s.market ?? "—"))]), [lc]);

  // Build the district groups + their default styles, then resolve overrides.
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const s of sonic) {
      const key = sonicKey(s);
      const e = m.get(key) ?? {
        key, label: s.do_name ?? "Open", brand: "sonic" as const, count: 0,
        defColor: s.do_id ? (doColors.get(s.do_id) ?? DO_OPEN_COLOR) : DO_OPEN_COLOR, defShape: "pin" as MarkerShape,
      };
      e.count++; m.set(key, e);
    }
    for (const s of lc) {
      const key = lcKey(s);
      const e = m.get(key) ?? {
        key, label: s.market ?? "—", brand: "lc" as const, count: 0,
        defColor: marketColors.get(s.market ?? "—") ?? LC_ORANGE, defShape: "square" as MarkerShape,
      };
      e.count++; m.set(key, e);
    }
    return [...m.values()].sort((a, b) => (a.brand === b.brand ? a.label.localeCompare(b.label) : a.brand.localeCompare(b.brand)));
  }, [sonic, lc, doColors, marketColors]);

  const resolved = useMemo(() => {
    const m = new Map<string, GroupStyle>();
    for (const g of groups) {
      const o = overrides[g.key];
      m.set(g.key, { color: o?.color ?? g.defColor, shape: o?.shape ?? g.defShape });
    }
    return m;
  }, [groups, overrides]);

  const styleOf = (key: string): GroupStyle => resolved.get(key) ?? { color: DO_OPEN_COLOR, shape: "pin" };

  function updateGroup(g: Group, patch: Partial<GroupStyle>) {
    setOverrides((prev) => {
      const cur = prev[g.key] ?? { color: g.defColor, shape: g.defShape };
      return { ...prev, [g.key]: { ...cur, ...patch } };
    });
  }

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const s of sonic) { const m = /,\s*([A-Z]{2})\b/.exec(s.address || ""); if (m) set.add(m[1]); }
    for (const s of lc) if (s.state) set.add(s.state);
    return set.size;
  }, [sonic, lc]);

  const fitPts = useMemo(() => [
    ...sonic.map((s) => ({ lat: s.latitude!, lng: s.longitude! })),
    ...lcPlotted.map((s) => ({ lat: s.latitude!, lng: s.longitude! })),
  ], [sonic, lcPlotted]);

  const lcByMarket = useMemo(() => {
    const m = new Map<string, ApricusStore[]>();
    for (const s of lc) { const k = s.market || "—"; (m.get(k) || m.set(k, []).get(k))!.push(s); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lc]);

  async function runGeocode() {
    setGeoBusy(true);
    try {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const r = await geocodeApricus();
        total += r.geocoded;
        if (r.done) break;
      }
      toast.push(`Geocoded ${total} store${total === 1 ? "" : "s"}.`, "success");
      lcQ.refetch();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Geocode failed.", "error");
    } finally {
      setGeoBusy(false);
    }
  }

  // Export every plotted (visible) store to a KML the user imports into Google
  // My Maps — the only way to see hundreds of pins at once. Colors match the
  // on-screen district styling; the imported map opens in the Google Maps app.
  function exportKml() {
    const pts: KmlPoint[] = [];
    if (showSonic) {
      for (const s of sonic) {
        const st = styleOf(sonicKey(s));
        pts.push({
          name: `#${s.number} ${s.name}`,
          description: `Sonic · DO: ${s.do_name ?? "—"}\n${s.address ?? ""}`.trim(),
          lat: s.latitude!, lng: s.longitude!, colorHex: st.color, folder: "Sonic",
        });
      }
    }
    if (showLc) {
      for (const s of lcPlotted) {
        const st = styleOf(lcKey(s));
        pts.push({
          name: `LC #${s.number} ${s.name}`,
          description: `Little Caesars · ${s.market ?? "—"} · DO ${s.do_name ?? "—"} · DM ${s.dm_name ?? "—"} · GM ${s.gm_name ?? "—"}\n${s.address ?? ""}`.trim(),
          lat: s.latitude!, lng: s.longitude!, colorHex: st.color, folder: "Little Caesars",
        });
      }
    }
    if (!pts.length) { toast.push("No plotted stores to export.", "error"); return; }
    downloadKml("soar-coo-map", buildStoresKml("SOAR + Little Caesars stores", pts));
    toast.push(`Exported ${pts.length} stores. Import the .kml at mymaps.google.com (Create map → Import) to see every pin.`, "success");
    window.open("https://www.google.com/maps/d/", "_blank", "noopener");
  }

  if (accessLoading) return <Skeleton className="h-96 w-full" />;
  if (!multiCompany) return <Navigate to="/" replace />;
  if (!MAPS_KEY) return <EmptyState title="Map key missing" description="Set VITE_GOOGLE_MAPS_API_KEY to render the map." />;

  const lcMissing = lc.length - lcPlotted.length;
  const selAddr = sel?.s.address ?? null;

  return (
    <>
      <PageHeader
        title="COO Map"
        description="SOAR Sonic + Apricus Little Caesars on one map."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowStyle((v) => !v)}>
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
              Customize
            </Button>
            <Button variant="secondary" size="sm" onClick={exportKml}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Export to My Maps
            </Button>
            {isAdmin && lcMissing > 0 ? (
              <Button variant="secondary" size="sm" onClick={runGeocode} disabled={geoBusy}>
                <RefreshCw className={cn("mr-1 h-3.5 w-3.5", geoBusy && "animate-spin")} />
                {geoBusy ? "Geocoding…" : `Geocode ${lcMissing} missing`}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Summary strip */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white px-4 py-2.5 text-sm ring-1 ring-zinc-200">
        <span><b className="text-midnight">{sonic.length + lc.length}</b> stores</span>
        <span className="text-zinc-400">·</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> {sonic.length} Sonic</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: LC_ORANGE }} /> {lc.length} Little Caesars</span>
        <span className="text-zinc-400">·</span>
        <span>{states} states</span>
        {lcMissing > 0 && <span className="text-amber-600">· {lcMissing} LC not yet geocoded</span>}
        {/* Brand filter */}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showSonic} onChange={(e) => setShowSonic(e.target.checked)} className="h-4 w-4 accent-emerald-600" /> Sonic
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showLc} onChange={(e) => setShowLc(e.target.checked)} className="h-4 w-4" style={{ accentColor: LC_ORANGE }} /> Little Caesars
        </label>
      </div>

      {/* Customize markers panel — per-district shape + color, saved to this browser */}
      {showStyle && (
        <div className="mb-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Marker style · by district</div>
            <button
              type="button"
              onClick={() => setOverrides({})}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <RotateCcw className="h-3 w-3" /> Reset all
            </button>
          </div>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => {
              const st = styleOf(g.key);
              return (
                <div key={g.key} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center"><MarkerGlyph shape={st.shape} color={st.color} size={13} /></span>
                  <span className="min-w-0 flex-1 truncate text-xs" title={g.label}>
                    <span className={cn("mr-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase", g.brand === "sonic" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700")}>
                      {g.brand === "sonic" ? "SON" : "LC"}
                    </span>
                    {g.label} <span className="text-zinc-400">· {g.count}</span>
                  </span>
                  <select
                    value={st.shape}
                    onChange={(e) => updateGroup(g, { shape: e.target.value as MarkerShape })}
                    className="rounded-md border border-zinc-200 bg-white px-1 py-0.5 text-[11px]"
                  >
                    {MARKER_SHAPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <input
                    type="color"
                    value={asHexInput(st.color)}
                    onChange={(e) => updateGroup(g, { color: e.target.value })}
                    className="h-6 w-7 shrink-0 cursor-pointer rounded border border-zinc-200 bg-white p-0.5"
                    aria-label={`Color for ${g.label}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {/* Map */}
        <div className="min-h-[520px] overflow-hidden rounded-xl border border-zinc-200">
          {sonicQ.isLoading || lcQ.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : (
            <APIProvider apiKey={MAPS_KEY}>
              <GoogleMap
                mapId={MAP_ID}
                defaultCenter={US_CENTER}
                defaultZoom={5}
                gestureHandling="greedy"
                mapTypeControl
                streetViewControl
                fullscreenControl
                className="h-full min-h-[520px] w-full"
              >
                <FitAll pts={fitPts} />
                {showSonic && sonic.map((s) => {
                  const st = styleOf(sonicKey(s));
                  return (
                    <AdvancedMarker key={`s-${s.id}`} position={{ lat: s.latitude!, lng: s.longitude! }} onClick={() => setSel({ brand: "sonic", s })}>
                      <MarkerGlyph shape={st.shape} color={st.color} />
                    </AdvancedMarker>
                  );
                })}
                {showLc && lcPlotted.map((s) => {
                  const st = styleOf(lcKey(s));
                  return (
                    <AdvancedMarker key={`lc-${s.number}`} position={{ lat: s.latitude!, lng: s.longitude! }} onClick={() => setSel({ brand: "lc", s })}>
                      <MarkerGlyph shape={st.shape} color={st.color} />
                    </AdvancedMarker>
                  );
                })}
                {sel && sel.s.latitude != null && sel.s.longitude != null && (
                  <InfoWindow position={{ lat: sel.s.latitude!, lng: sel.s.longitude! }} pixelOffset={[0, -30]} onCloseClick={() => setSel(null)}>
                    <div className="min-w-[190px] text-xs">
                      <div className="font-bold text-midnight">
                        {sel.brand === "sonic" ? <>#{sel.s.number} {sel.s.name}</> : <>LC #{sel.s.number} · {sel.s.name}</>}
                      </div>
                      {sel.brand === "sonic"
                        ? <div className="text-zinc-500">DO: {sel.s.do_name ?? "—"}</div>
                        : <div className="text-zinc-500">{sel.s.market ?? "—"} · DO {sel.s.do_name ?? "—"} · DM {sel.s.dm_name ?? "—"}<br />GM: {sel.s.gm_name ?? "—"}</div>}
                      {selAddr && <div className="mt-1 text-zinc-400">{selAddr}</div>}

                      {/* Directions */}
                      {selAddr && (
                        <div className="mt-2 flex gap-1.5 border-t border-zinc-100 pt-2">
                          <a
                            href={appleMapsDirections(selAddr)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-100 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
                          >
                            <Navigation className="h-3 w-3" /> Apple Maps
                          </a>
                          <a
                            href={googleMapsDirections(selAddr)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-100 px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
                          >
                            <Navigation className="h-3 w-3" /> Google
                          </a>
                        </div>
                      )}
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            </APIProvider>
          )}
        </div>

        {/* Side panel */}
        <div className="max-h-[520px] space-y-3 overflow-auto rounded-xl bg-white p-3 ring-1 ring-zinc-200">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Little Caesars · by market</div>
            {lcByMarket.map(([market, rows]) => {
              const st = styleOf(`lc:${market}`);
              return (
                <div key={market} className="mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-midnight">
                    <MarkerGlyph shape={st.shape} color={st.color} size={11} />
                    {market} <span className="font-normal text-zinc-400">· {rows.length}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {[...new Set(rows.map((r) => r.do_name).filter(Boolean))].join(", ") || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
