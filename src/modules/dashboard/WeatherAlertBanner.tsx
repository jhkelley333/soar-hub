// Dashboard weather-alert banner.
// Reads active NWS alerts for the signed-in user's visible stores via
// weather_alert_stores → weather_alerts (RLS auto-scopes to user_visible_stores).
// Subscribes to Supabase Realtime so the banner appears / clears live.
//
// GMs see a single-line summary of their store's alert.
// DO/SDO/RVP/VP/COO/admin see a count + "View N alerts" button that opens a
// drawer listing every affected store.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, CloudLightning, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import type { UserRole } from "@/types/database";

const MULTI_UNIT_ROLES = new Set<UserRole>(["do", "sdo", "rvp", "vp", "coo", "admin"]);

// ── types ────────────────────────────────────────────────────────────────────

interface StoreMatch {
  store_id: string;
  number: string;
  name: string | null;
  match_type: "polygon" | "zone";
}

interface ActiveAlert {
  alert_id: string;
  event: string;
  severity: string | null;
  urgency: string | null;
  headline: string | null;
  expires: string | null;
  ends: string | null;
  onset: string | null;
  stores: StoreMatch[];
}

// Severity sort order (highest first).
const SEV_RANK: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
function sevRank(s: string | null) { return SEV_RANK[s ?? ""] ?? 0; }

// ── query ────────────────────────────────────────────────────────────────────

async function fetchActiveAlerts(): Promise<ActiveAlert[]> {
  const { data, error } = await supabase
    .from("weather_alert_stores")
    .select(
      "store_id, match_type, stores(id, number, name), weather_alerts(alert_id, event, severity, urgency, headline, expires, ends, onset, status)"
    );

  if (error) throw error;

  // Filter to active alerts only (the poller sets status; RLS scopes stores).
  type Row = NonNullable<typeof data>[number] & {
    stores: { id: string; number: string; name: string | null } | null;
    weather_alerts: {
      alert_id: string; event: string; severity: string | null; urgency: string | null;
      headline: string | null; expires: string | null; ends: string | null;
      onset: string | null; status: string;
    } | null;
  };
  const rows = (data ?? []) as Row[];

  const alertMap = new Map<string, ActiveAlert>();
  for (const row of rows) {
    const a = row.weather_alerts;
    if (!a || a.status !== "active") continue;
    if (!alertMap.has(a.alert_id)) {
      alertMap.set(a.alert_id, {
        alert_id: a.alert_id,
        event: a.event,
        severity: a.severity,
        urgency: a.urgency,
        headline: a.headline,
        expires: a.expires,
        ends: a.ends,
        onset: a.onset,
        stores: [],
      });
    }
    if (row.stores) {
      alertMap.get(a.alert_id)!.stores.push({
        store_id: row.store_id,
        number: row.stores.number,
        name: row.stores.name,
        match_type: row.match_type,
      });
    }
  }

  return [...alertMap.values()].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
}

// ── realtime hook ─────────────────────────────────────────────────────────────

function useActiveAlerts() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["weather-alerts", "active"],
    queryFn: fetchActiveAlerts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const ch = supabase
      .channel("weather-alerts-banner")
      .on("postgres_changes", { event: "*", schema: "public", table: "weather_alerts" }, () => {
        qc.invalidateQueries({ queryKey: ["weather-alerts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "weather_alert_stores" }, () => {
        qc.invalidateQueries({ queryKey: ["weather-alerts"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return q;
}

// ── banner chrome ─────────────────────────────────────────────────────────────

const SEV_STYLES: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  Extreme: {
    bg: "bg-cherry/10 dark:bg-cherry/20",
    border: "border-cherry/30",
    icon: "text-cherry",
    text: "text-cherry dark:text-cherry",
  },
  Severe: {
    bg: "bg-warning/10 dark:bg-warning/20",
    border: "border-warning/30",
    icon: "text-warning",
    text: "text-warning",
  },
  default: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-300 dark:border-amber-700",
    icon: "text-amber-600 dark:text-amber-400",
    text: "text-amber-900 dark:text-amber-200",
  },
};

function bannerStyle(severity: string | null) {
  return SEV_STYLES[severity ?? ""] ?? SEV_STYLES.default;
}

function formatExpiry(expires: string | null, ends: string | null): string {
  const ts = expires || ends;
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const mins = Math.floor((d.getTime() - now.getTime()) / 60_000);
  if (mins < 0) return "expired";
  if (mins < 60) return `expires in ${mins}m`;
  if (mins < 1440) return `expires ${Math.floor(mins / 60)}h`;
  return `until ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

// ── main component ────────────────────────────────────────────────────────────

export function WeatherAlertBanner() {
  const { profile } = useAuth();
  const role = profile?.role as UserRole | undefined;
  const isMultiUnit = !!role && MULTI_UNIT_ROLES.has(role);

  const { data: alerts = [], isLoading } = useActiveAlerts();

  // Track dismissed alert IDs for this session. Auto-clear dismissals if new
  // alerts arrive that weren't in the previous set.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!alerts.length) return;
    const incoming = new Set(alerts.map((a) => a.alert_id));
    const hasNew = [...incoming].some((id) => !prevIdsRef.current.has(id));
    if (hasNew) {
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const id of incoming) next.delete(id); // un-dismiss new arrivals
        return next;
      });
    }
    prevIdsRef.current = incoming;
  }, [alerts]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = useMemo(
    () => alerts.filter((a) => !dismissed.has(a.alert_id)),
    [alerts, dismissed]
  );

  if (isLoading || !visible.length) return null;

  const top = visible[0];
  const style = bannerStyle(top.severity);
  const totalStores = new Set(visible.flatMap((a) => a.stores.map((s) => s.store_id))).size;

  return (
    <>
      <div
        role="alert"
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-3",
          style.bg,
          style.border
        )}
      >
        <CloudLightning className={cn("mt-0.5 h-5 w-5 shrink-0", style.icon)} strokeWidth={2} />

        <div className="min-w-0 flex-1">
          {visible.length === 1 ? (
            <SingleAlertSummary alert={top} style={style} />
          ) : (
            <MultiAlertSummary
              alerts={visible}
              totalStores={totalStores}
              style={style}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isMultiUnit && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                style.border,
                style.text,
                "hover:bg-black/5 dark:hover:bg-white/10"
              )}
            >
              View stores <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            onClick={() => visible.forEach((a) => setDismissed((s) => new Set([...s, a.alert_id])))}
            aria-label="Dismiss weather alerts"
            className={cn("rounded-lg p-1 transition hover:bg-black/10 dark:hover:bg-white/10", style.text)}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {isMultiUnit && (
        <WeatherAlertDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          alerts={visible}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
        />
      )}
    </>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function SingleAlertSummary({
  alert,
  style,
}: {
  alert: ActiveAlert;
  style: ReturnType<typeof bannerStyle>;
}) {
  const expiry = formatExpiry(alert.expires, alert.ends);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("text-sm font-semibold", style.text)}>{alert.event}</span>
        {alert.severity && (
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", style.bg, style.border, "border", style.text)}>
            {alert.severity}
          </span>
        )}
        {expiry && (
          <span className="text-xs text-ink-muted dark:text-night-muted">{expiry}</span>
        )}
      </div>
      {alert.headline && (
        <p className="mt-0.5 text-xs text-ink-muted dark:text-night-muted line-clamp-2">
          {alert.headline}
        </p>
      )}
    </div>
  );
}

function MultiAlertSummary({
  alerts,
  totalStores,
  style,
}: {
  alerts: ActiveAlert[];
  totalStores: number;
  style: ReturnType<typeof bannerStyle>;
}) {
  return (
    <div>
      <span className={cn("text-sm font-semibold", style.text)}>
        {alerts.length} active weather alert{alerts.length !== 1 ? "s" : ""}
        {totalStores > 0 && (
          <> · {totalStores} store{totalStores !== 1 ? "s" : ""} affected</>
        )}
      </span>
      <p className="mt-0.5 text-xs text-ink-muted dark:text-night-muted">
        {alerts
          .slice(0, 3)
          .map((a) => a.event)
          .join(" · ")}
        {alerts.length > 3 && ` +${alerts.length - 3} more`}
      </p>
    </div>
  );
}

// ── drawer ────────────────────────────────────────────────────────────────────

function WeatherAlertDrawer({
  open,
  onClose,
  alerts,
  expandedId,
  setExpandedId,
}: {
  open: boolean;
  onClose: () => void;
  alerts: ActiveAlert[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Active Weather Alerts" width="w-full sm:max-w-lg">
      {alerts.length === 0 ? (
        <p className="px-5 py-8 text-sm text-ink-muted dark:text-night-muted">No active alerts.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-night-line">
          {alerts.map((alert) => (
            <AlertDrawerRow
              key={alert.alert_id}
              alert={alert}
              expanded={expandedId === alert.alert_id}
              onToggle={() =>
                setExpandedId(expandedId === alert.alert_id ? null : alert.alert_id)
              }
            />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function AlertDrawerRow({
  alert,
  expanded,
  onToggle,
}: {
  alert: ActiveAlert;
  expanded: boolean;
  onToggle: () => void;
}) {
  const style = bannerStyle(alert.severity);
  const expiry = formatExpiry(alert.expires, alert.ends);

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-zinc-50 dark:hover:bg-white/5"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", style.icon)} strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink dark:text-night-ink">{alert.event}</span>
            {alert.severity && (
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border", style.bg, style.border, style.text)}>
                {alert.severity}
              </span>
            )}
            <span className="ml-auto text-xs text-ink-muted dark:text-night-muted">
              {alert.stores.length} store{alert.stores.length !== 1 ? "s" : ""}
            </span>
          </div>
          {alert.headline && (
            <p className="mt-0.5 text-xs text-ink-muted dark:text-night-muted line-clamp-2">
              {alert.headline}
            </p>
          )}
          {expiry && (
            <p className="mt-0.5 text-xs text-ink-muted dark:text-night-muted">{expiry}</p>
          )}
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-ink-subtle dark:text-night-muted transition-transform", expanded && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {expanded && alert.stores.length > 0 && (
        <ul className="border-t border-zinc-100 bg-zinc-50/50 pb-2 dark:border-night-line dark:bg-white/[0.02]">
          {alert.stores
            .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
            .map((s) => (
              <li
                key={s.store_id}
                className="flex items-center gap-2 px-8 py-1.5 text-sm text-ink dark:text-night-ink"
              >
                <span className="font-semibold tabular-nums">#{s.number}</span>
                {s.name && <span className="text-ink-muted dark:text-night-muted">{s.name}</span>}
                <span className="ml-auto text-[10px] font-medium text-ink-subtle dark:text-night-muted uppercase tracking-wide">
                  {s.match_type}
                </span>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}
