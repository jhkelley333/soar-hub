// Dashboard weather card. Reads the latest recorded observation for the user's
// store city (populated by the weather-sync schedule). Shows current conditions
// + a short forecast strip. Admins get a "Sync now" button (and still see the
// card before any data exists, so they can seed it). Non-admins see nothing
// until there's data.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSun, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { useToast } from "@/shared/ui/Toaster";
import { fetchWeatherForStore, triggerWeatherSync, type WeatherForecastDay } from "./weatherApi";

const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

const fmtTemp = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}°`);
const dayLabel = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : "";

export function WeatherWidget({ storeId }: { storeId: string }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ["weather", storeId],
    queryFn: () => fetchWeatherForStore(storeId),
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
  });

  const sync = useMutation({
    mutationFn: triggerWeatherSync,
    onSuccess: (r) => {
      if (r.recorded > 0) {
        toast.push(`Weather sync complete — ${r.recorded} location${r.recorded === 1 ? "" : "s"} recorded${r.failed ? `, ${r.failed} failed` : ""}.`, "success");
      } else {
        toast.push(r.error ? `Recorded nothing — ${r.error}` : "Recorded nothing. Check the Weather API is enabled and the key is authorized.", "error");
      }
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Sync failed.", "error"),
  });

  const cur = q.data?.current;
  const loc = q.data?.location;
  const days: WeatherForecastDay[] = (q.data?.forecast ?? []).slice(0, 5);
  const hasData = !!(cur || days.length);

  // No data yet: hide for everyone except admins (who can seed it).
  if (!q.isLoading && !hasData && !isAdmin) return null;
  if (q.isError && !isAdmin) return null;

  const SyncBtn = isAdmin ? (
    <button
      type="button"
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      title="Pull weather now (all cities)"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
      {sync.isPending ? "Syncing…" : "Sync now"}
    </button>
  ) : null;

  return (
    <section className={cn(PANEL, "p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-night-text">
          <CloudSun className="h-4 w-4 text-accent" />
          Weather
          {loc?.label && <span className="truncate text-xs font-normal text-zinc-400">· {loc.label}</span>}
        </div>
        {SyncBtn}
      </div>

      {q.isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-night-line" />
      ) : !hasData ? (
        <div className="rounded-lg bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-night-line">
          No weather recorded yet. {isAdmin ? "Use Sync now to pull it (needs the Weather API key set)." : ""}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {cur?.icon_uri ? (
              <img src={cur.icon_uri} alt="" className="h-12 w-12" />
            ) : (
              <CloudSun className="h-10 w-10 text-zinc-300" />
            )}
            <div>
              <div className="text-3xl font-bold leading-none text-midnight dark:text-night-text">{fmtTemp(cur?.temp_f)}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {cur?.condition ?? "—"}
                {cur?.feels_like_f != null && ` · feels ${fmtTemp(cur.feels_like_f)}`}
                {cur?.precip_prob_pct != null && cur.precip_prob_pct > 0 && ` · ${cur.precip_prob_pct}% precip`}
              </div>
            </div>
          </div>

          {days.length > 0 && (
            <div className="mt-3 grid grid-cols-5 gap-1 border-t border-zinc-100 pt-3 dark:border-night-line">
              {days.map((d, i) => (
                <div key={d.date ?? i} className="flex flex-col items-center gap-0.5 text-center">
                  <span className="text-[11px] font-medium text-zinc-500">{dayLabel(d.date)}</span>
                  {d.icon ? <img src={d.icon} alt="" className="h-6 w-6" /> : <CloudSun className="h-5 w-5 text-zinc-300" />}
                  <span className="text-xs font-semibold text-zinc-700 dark:text-night-text">{fmtTemp(d.hi_f)}</span>
                  <span className="text-[11px] text-zinc-400">{fmtTemp(d.lo_f)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
