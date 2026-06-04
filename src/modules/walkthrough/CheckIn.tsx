// Walkthrough — GPS check-in gate.
//
// Precedes the checklist. Requests a device fix, compares it to the store's
// location + geofence radius, and resolves one of three states:
//   on_site  → "Check in & start" enabled
//   nearby   → blocked, but "Request off-site exception" (logs a reason,
//              flags the submission for DO awareness) unlocks start
//   off_site → blocked; re-locate only
// Emits a CheckIn record that stamps the whole session.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  LocateFixed,
  MapPin,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { BottomBar } from "@/shared/ui/BottomBar";
import { cn } from "@/lib/cn";
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  evaluateGeofence,
  formatDistance,
  type GeofenceEval,
} from "./geofence";
import type { CheckIn as CheckInRecord, GeofenceResult } from "./types";

export interface CheckInStore {
  sdi: string;
  name: string;
  lat: number;
  lng: number;
  radiusM?: number;
}

type Phase = "idle" | "locating" | "located" | "denied" | "unavailable";

export interface CheckInProps {
  assignmentId: string;
  store: CheckInStore;
  onCheckIn: (ci: CheckInRecord) => void;
  onBack?: () => void;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ci_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const RESULT_UI: Record<
  GeofenceResult,
  { tone: string; ring: string; icon: typeof MapPin; title: string }
> = {
  on_site: {
    tone: "text-ok",
    ring: "ring-ok/30 bg-ok/[0.06]",
    icon: CheckCircle2,
    title: "You're on site",
  },
  nearby: {
    tone: "text-warn",
    ring: "ring-warn/30 bg-warn/[0.06]",
    icon: TriangleAlert,
    title: "Just outside the store",
  },
  off_site: {
    tone: "text-bad",
    ring: "ring-bad/30 bg-bad/[0.06]",
    icon: XCircle,
    title: "Too far from the store",
  },
};

export function CheckIn({ assignmentId, store, onCheckIn, onBack }: CheckInProps) {
  const radiusM = store.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M;
  const [phase, setPhase] = useState<Phase>("idle");
  const [fix, setFix] = useState<GeolocationPosition | null>(null);
  const [evalResult, setEvalResult] = useState<GeofenceEval | null>(null);
  const [requestingException, setRequestingException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setPhase("unavailable");
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFix(pos);
        setEvalResult(
          evaluateGeofence(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            { lat: store.lat, lng: store.lng },
            radiusM,
          ),
        );
        setPhase("located");
      },
      (err) => setPhase(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, [store.lat, store.lng, radiusM]);

  // Kick off on mount.
  useEffect(() => {
    locate();
  }, [locate]);

  const result = evalResult?.result;
  const canStartOnSite = result === "on_site";
  const canStartException =
    result === "nearby" && exceptionReason.trim().length >= 4;

  function commit(geofenceResult: GeofenceResult, reason?: string) {
    if (!fix) return;
    onCheckIn({
      id: uid(),
      assignmentId,
      at: new Date().toISOString(),
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracy: fix.coords.accuracy,
      geofenceResult,
      ...(reason ? { exceptionReason: reason.trim() } : {}),
    });
  }

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full flex flex-col">
      <AppHeader
        title="Check in"
        subtitle={`SDI ${store.sdi} · ${store.name}`}
        leading={
          onBack && (
            <button
              type="button"
              onClick={onBack}
              className="-ml-1 p-1 text-midnight-700"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            </button>
          )
        }
      />

      <div className="flex-1 px-4 pt-5 pb-40 space-y-4">
        {/* Locating / denied / unavailable */}
        {(phase === "idle" || phase === "locating") && (
          <StatusCard
            ring="ring-midnight-100 bg-white"
            tone="text-accent-600"
            icon={LocateFixed}
            iconSpin={phase === "locating"}
            title="Finding your location…"
            body="Make sure location is on. This stays on the device until you submit."
          />
        )}
        {phase === "denied" && (
          <StatusCard
            ring="ring-bad/30 bg-bad/[0.06]"
            tone="text-bad"
            icon={XCircle}
            title="Location permission blocked"
            body="Enable location for this site in your browser settings, then re-locate."
          />
        )}
        {phase === "unavailable" && (
          <StatusCard
            ring="ring-bad/30 bg-bad/[0.06]"
            tone="text-bad"
            icon={XCircle}
            title="Couldn't get a fix"
            body="No GPS signal right now. Step outside the cooler and try again."
          />
        )}

        {/* Located → geofence result */}
        {phase === "located" && result && evalResult && (
          <>
            <GeofenceCard evalResult={evalResult} radiusM={radiusM} />

            {result === "nearby" && (
              <div className="bg-white rounded-xl ring-1 ring-midnight-100 shadow-card p-4">
                {!requestingException ? (
                  <button
                    type="button"
                    onClick={() => setRequestingException(true)}
                    className="w-full h-11 rounded-lg ring-1 ring-warn/40 text-midnight-800 text-[14px] font-medium bg-warn/[0.06] hover:bg-warn/10 transition"
                  >
                    Request off-site exception
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-midnight-600">
                      Why are you starting off site?
                    </div>
                    <textarea
                      rows={3}
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="e.g. GPS won't lock inside — standing at the lot edge."
                      className="w-full rounded-lg ring-1 ring-midnight-200 bg-white px-3 py-2 text-[13px] text-midnight-800 placeholder:text-midnight-300 outline-none resize-none focus:ring-accent-500"
                    />
                    <p className="text-[11px] text-midnight-500">
                      This flags the submission for your DO's awareness.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <BottomBar>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={locate}
            className="flex-1 h-11 rounded-lg ring-1 ring-midnight-200 text-midnight-800 text-[14px] font-medium bg-white hover:bg-surface-muted transition inline-flex items-center justify-center gap-1.5"
          >
            <LocateFixed className="h-4 w-4" strokeWidth={2} />
            Re-locate
          </button>
          <button
            type="button"
            disabled={!canStartOnSite && !canStartException}
            onClick={() =>
              canStartOnSite
                ? commit("on_site")
                : commit("nearby", exceptionReason)
            }
            className={cn(
              "flex-[1.5] h-11 rounded-lg text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 transition",
              canStartOnSite || canStartException
                ? "bg-midnight-900 text-white hover:bg-midnight-800"
                : "bg-midnight-200 text-white/80 cursor-not-allowed",
            )}
          >
            {canStartException ? "Start with exception" : "Check in & start"}
          </button>
        </div>
      </BottomBar>
    </div>
  );
}

function GeofenceCard({
  evalResult,
  radiusM,
}: {
  evalResult: GeofenceEval;
  radiusM: number;
}) {
  const ui = RESULT_UI[evalResult.result];
  const Icon = ui.icon;
  return (
    <div className={cn("rounded-xl ring-1 shadow-card p-4", ui.ring)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("h-6 w-6 shrink-0", ui.tone)} strokeWidth={2} />
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-midnight-900">{ui.title}</div>
          <div className="mt-0.5 text-[12.5px] text-midnight-600 flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
            {formatDistance(evalResult.distanceM)} from store · fence {radiusM} m
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  ring,
  tone,
  icon: Icon,
  iconSpin,
  title,
  body,
}: {
  ring: string;
  tone: string;
  icon: typeof MapPin;
  iconSpin?: boolean;
  title: string;
  body: string;
}) {
  return (
    <div className={cn("rounded-xl ring-1 shadow-card p-4", ring)}>
      <div className="flex items-start gap-3">
        <Icon
          className={cn("h-6 w-6 shrink-0", tone, iconSpin && "animate-spin")}
          strokeWidth={2}
        />
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-midnight-900">{title}</div>
          <div className="mt-0.5 text-[12.5px] text-midnight-600">{body}</div>
        </div>
      </div>
    </div>
  );
}
