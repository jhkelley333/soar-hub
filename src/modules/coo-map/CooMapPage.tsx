// COO Map — cross-brand executive view at /coo-map. Sonic + Apricus Little
// Caesars stores on one Google Map, for users with multi-company access only.
// Sonic markers keep the territory map's DO colors (round pins); Little Caesars
// gets a distinct SQUARE glyph in LC orange (no DO-color reuse — they have no
// SOAR DO). Route + nav are gated on company_access > 1 (data-driven).

import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchTerritoryMap, type TerritoryStore } from "@/modules/territory-map/api";
import { colorsForDos, DO_OPEN_COLOR } from "@/modules/territory-map/colors";
import { useCompanyAccess } from "./useCompanyAccess";
import { fetchCooMapStores, geocodeApricus, type ApricusStore } from "./api";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";
const US_CENTER = { lat: 39.5, lng: -86 };
const LC_ORANGE = "#FF6000";

type Sel =
  | { brand: "sonic"; s: TerritoryStore }
  | { brand: "lc"; s: ApricusStore }
  | null;

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
  const [sel, setSel] = useState<Sel>(null);
  const [geoBusy, setGeoBusy] = useState(false);

  const sonicQ = useQuery({ queryKey: ["coo-territory"], queryFn: fetchTerritoryMap, staleTime: 5 * 60_000, enabled: multiCompany });
  const lcQ = useQuery({ queryKey: ["coo-lc"], queryFn: fetchCooMapStores, staleTime: 5 * 60_000, enabled: multiCompany });

  const sonic = useMemo(() => (sonicQ.data?.stores ?? []).filter((s) => s.latitude != null && s.longitude != null), [sonicQ.data]);
  const lc = useMemo(() => (lcQ.data?.apricus ?? []), [lcQ.data]);
  const lcPlotted = useMemo(() => lc.filter((s) => s.latitude != null && s.longitude != null), [lc]);
  const doColors = useMemo(() => colorsForDos(sonic.map((s) => s.do_id).filter(Boolean) as string[]), [sonic]);

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

  if (accessLoading) return <Skeleton className="h-96 w-full" />;
  if (!multiCompany) return <Navigate to="/" replace />;
  if (!MAPS_KEY) return <EmptyState title="Map key missing" description="Set VITE_GOOGLE_MAPS_API_KEY to render the map." />;

  const lcMissing = lc.length - lcPlotted.length;

  return (
    <>
      <PageHeader
        title="COO Map"
        description="SOAR Sonic + Apricus Little Caesars on one map."
        actions={
          isAdmin && lcMissing > 0 ? (
            <Button variant="secondary" size="sm" onClick={runGeocode} disabled={geoBusy}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", geoBusy && "animate-spin")} />
              {geoBusy ? "Geocoding…" : `Geocode ${lcMissing} missing`}
            </Button>
          ) : undefined
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

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {/* Map */}
        <div className="min-h-[520px] overflow-hidden rounded-xl border border-zinc-200">
          {sonicQ.isLoading || lcQ.isLoading ? (
            <Skeleton className="h-[520px] w-full" />
          ) : (
            <APIProvider apiKey={MAPS_KEY}>
              <GoogleMap mapId={MAP_ID} defaultCenter={US_CENTER} defaultZoom={5} gestureHandling="greedy" className="h-full min-h-[520px] w-full">
                <FitAll pts={fitPts} />
                {showSonic && sonic.map((s) => (
                  <AdvancedMarker key={`s-${s.id}`} position={{ lat: s.latitude!, lng: s.longitude! }} onClick={() => setSel({ brand: "sonic", s })}>
                    <Pin background={s.do_id ? doColors.get(s.do_id)! : DO_OPEN_COLOR} borderColor="#ffffff" glyphColor="#ffffff" />
                  </AdvancedMarker>
                ))}
                {showLc && lcPlotted.map((s) => (
                  <AdvancedMarker key={`lc-${s.number}`} position={{ lat: s.latitude!, lng: s.longitude! }} onClick={() => setSel({ brand: "lc", s })}>
                    {/* Distinct square glyph for Little Caesars */}
                    <div style={{ width: 16, height: 16, background: LC_ORANGE, border: "2px solid #fff", borderRadius: 3, boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
                  </AdvancedMarker>
                ))}
                {sel && sel.s.latitude != null && sel.s.longitude != null && (
                  <InfoWindow position={{ lat: sel.s.latitude!, lng: sel.s.longitude! }} pixelOffset={[0, -30]} onCloseClick={() => setSel(null)}>
                    <div className="min-w-[180px] text-xs">
                      <div className="font-bold text-midnight">
                        {sel.brand === "sonic" ? <>#{sel.s.number} {sel.s.name}</> : <>LC #{sel.s.number} · {sel.s.name}</>}
                      </div>
                      {sel.brand === "sonic"
                        ? <div className="text-zinc-500">DO: {sel.s.do_name ?? "—"}</div>
                        : <div className="text-zinc-500">{sel.s.market ?? "—"} · DO {sel.s.do_name ?? "—"} · DM {sel.s.dm_name ?? "—"}<br />GM: {sel.s.gm_name ?? "—"}</div>}
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
            {lcByMarket.map(([market, rows]) => (
              <div key={market} className="mb-2">
                <div className="text-xs font-semibold text-midnight">{market} <span className="font-normal text-zinc-400">· {rows.length}</span></div>
                <div className="text-[11px] text-zinc-500">
                  {[...new Set(rows.map((r) => r.do_name).filter(Boolean))].join(", ") || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
