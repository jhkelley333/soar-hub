// Dashboard weather card. Reads the latest recorded observation for the user's
// store city (populated by the weather-sync schedule). Shows current conditions
// + a short forecast strip. Self-hides if there's no data yet (e.g. before the
// first sync, or the Weather API key isn't set).
import { useQuery } from "@tanstack/react-query";
import { CloudSun } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchWeatherForStore, type WeatherForecastDay } from "./weatherApi";

const PANEL =
  "rounded-2xl border border-zinc-200 bg-white shadow-card dark:border-night-line dark:bg-night-raised dark:shadow-none";

const fmtTemp = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}°`);
const dayLabel = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : "";

export function WeatherWidget({ storeId }: { storeId: string }) {
  const q = useQuery({
    queryKey: ["weather", storeId],
    queryFn: () => fetchWeatherForStore(storeId),
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
  });

  // No data yet (pre-first-sync / no key) — don't clutter the dashboard.
  if (q.isError || (q.data && !q.data.current && q.data.forecast.length === 0)) return null;

  const cur = q.data?.current;
  const loc = q.data?.location;
  const days: WeatherForecastDay[] = (q.data?.forecast ?? []).slice(0, 5);

  return (
    <section className={cn(PANEL, "p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-night-text">
          <CloudSun className="h-4 w-4 text-accent" />
          Weather
        </div>
        {loc?.label && <span className="truncate text-xs text-zinc-400">{loc.label}</span>}
      </div>

      {q.isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-night-line" />
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
