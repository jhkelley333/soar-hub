// Weather — DO-and-above view of current conditions, forecast, and historical
// trend for any of their markets/stores. Reads recorded data (weather-sync +
// backfill write it); admins also get the dashboard widget's sync/backfill.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CloudSun, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { fetchCallerStores } from "@/modules/work-orders-v2/api";
import { fetchWeatherForStore, fetchWeatherHistory, fetchWeatherRange } from "@/modules/dashboard/weatherApi";
import { WeatherTrendChart } from "./WeatherTrendChart";

// Local YYYY-MM-DD.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The current Mon–Sun week, shifted back 52 weeks (364 days) so it lands on
// the same weekdays one year ago.
function thisWeekLastYear(): { start: string; end: string; year: number } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  monday.setDate(monday.getDate() - 364);
  sunday.setDate(sunday.getDate() - 364);
  return { start: ymd(monday), end: ymd(sunday), year: monday.getFullYear() };
}
const fullDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// A Mon–Sun week as seven YYYY-MM-DD dates, shifted `offset` weeks from the
// current week (0 = this week, -1 = last week, …).
function weekFor(offset: number): { start: string; end: string; days: string[] } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return ymd(d);
  });
  return { start: days[0], end: days[6], days };
}

const RANGES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];
const SELECT =
  "rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";
const fmtTemp = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}°`);
const dayLabel = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : "");

export function WeatherPage() {
  const { profile } = useAuth();
  const storesQ = useQuery({ queryKey: ["wo2", "caller-stores"], queryFn: fetchCallerStores, staleTime: 5 * 60_000 });
  const stores = storesQ.data?.stores ?? [];

  const [storeId, setStoreId] = useState<string>("");
  const [days, setDays] = useState(90);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, -1 = last week…

  // Default to the user's primary store, else the first scoped store.
  useEffect(() => {
    if (storeId || !stores.length) return;
    setStoreId(profile?.primary_store_id && stores.some((s) => s.id === profile.primary_store_id) ? profile.primary_store_id : stores[0].id);
  }, [stores, storeId, profile?.primary_store_id]);

  const curQ = useQuery({
    queryKey: ["weather", storeId],
    queryFn: () => fetchWeatherForStore(storeId),
    enabled: !!storeId,
    staleTime: 15 * 60_000,
  });
  const histQ = useQuery({
    queryKey: ["weather-history", storeId, days],
    queryFn: () => fetchWeatherHistory(storeId, days),
    enabled: !!storeId,
    staleTime: 15 * 60_000,
  });
  const week = useMemo(() => weekFor(weekOffset), [weekOffset]);
  const weekQ = useQuery({
    queryKey: ["weather-range", storeId, week.start, week.end],
    queryFn: () => fetchWeatherRange(storeId, week.start, week.end),
    enabled: !!storeId,
    staleTime: 15 * 60_000,
  });
  const lastYear = useMemo(() => thisWeekLastYear(), []);
  const lyQ = useQuery({
    queryKey: ["weather-range", storeId, lastYear.start, lastYear.end],
    queryFn: () => fetchWeatherRange(storeId, lastYear.start, lastYear.end),
    enabled: !!storeId,
    staleTime: 15 * 60_000,
  });
  const lyPoints = lyQ.data?.points ?? [];

  // Merge this week into one Mon–Sun row: recorded actuals for elapsed days,
  // forecast for the days still to come.
  const todayYmd = ymd(new Date());
  const weekDays = useMemo(() => {
    const actuals = new Map((weekQ.data?.points ?? []).map((p) => [p.date, p]));
    const fc = new Map((curQ.data?.forecast ?? []).map((f) => [f.date, f]));
    return week.days.map((date) => {
      const a = actuals.get(date);
      const f = fc.get(date);
      const hasActual = a && (a.hi_f != null || a.lo_f != null);
      if (date <= todayYmd && hasActual) {
        return { date, hi_f: a!.hi_f, lo_f: a!.lo_f, icon: undefined as string | undefined, kind: "actual" as const };
      }
      if (f) return { date, hi_f: f.hi_f, lo_f: f.lo_f, icon: f.icon as string | undefined, kind: "forecast" as const };
      if (a) return { date, hi_f: a.hi_f, lo_f: a.lo_f, icon: undefined as string | undefined, kind: "actual" as const };
      return { date, hi_f: null, lo_f: null, icon: undefined as string | undefined, kind: date <= todayYmd ? ("actual" as const) : ("forecast" as const) };
    });
  }, [weekQ.data, curQ.data, week.days, todayYmd]);

  const cur = curQ.data?.current;
  const forecast = (curQ.data?.forecast ?? []).slice(0, 7);
  const loc = curQ.data?.location ?? histQ.data?.location;
  const points = histQ.data?.points ?? [];
  const stats = useMemo(() => {
    const his = points.map((p) => p.hi_f).filter((v): v is number => v != null);
    const los = points.map((p) => p.lo_f).filter((v): v is number => v != null);
    return {
      warmest: his.length ? Math.max(...his) : null,
      coldest: los.length ? Math.min(...los) : null,
      avgHi: his.length ? Math.round(his.reduce((a, b) => a + b, 0) / his.length) : null,
    };
  }, [points]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Weather"
        description="Current conditions, forecast, and historical trend for your markets."
        actions={
          <div className="flex items-center gap-2">
            {stores.length > 0 && (
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={SELECT}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
                ))}
              </select>
            )}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT}>
              {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
            </select>
          </div>
        }
      />

      {storesQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : stores.length === 0 ? (
        <Card><EmptyState title="No stores in your scope" description="Weather is shown for the stores you oversee." /></Card>
      ) : (
        <div className="space-y-4">
          {/* current + forecast */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                  <CloudSun className="h-4 w-4 text-accent" /> Now
                </div>
                {loc?.label && <span className="text-xs text-zinc-400">{loc.label}</span>}
              </div>
              {curQ.isLoading ? (
                <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
              ) : !cur && forecast.length === 0 ? (
                <div className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">No weather recorded yet for this store's city.</div>
              ) : (
                <div className="flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-3">
                    {cur?.icon_uri ? <img src={cur.icon_uri} alt="" className="h-12 w-12" /> : <CloudSun className="h-10 w-10 text-zinc-300" />}
                    <div>
                      <div className="text-3xl font-bold leading-none text-midnight">{fmtTemp(cur?.temp_f)}</div>
                      <div className="mt-1 text-xs text-zinc-500">{cur?.condition ?? "—"}{cur?.feels_like_f != null && ` · feels ${fmtTemp(cur.feels_like_f)}`}</div>
                    </div>
                  </div>
                  {forecast.length > 0 && (
                    <div className="flex flex-wrap gap-4">
                      {forecast.map((d, i) => (
                        <div key={d.date ?? i} className="flex flex-col items-center gap-0.5 text-center">
                          <span className="text-[11px] font-medium text-zinc-500">{dayLabel(d.date)}</span>
                          {d.icon ? <img src={d.icon} alt="" className="h-6 w-6" /> : <CloudSun className="h-5 w-5 text-zinc-300" />}
                          <span className="text-xs font-semibold text-zinc-700">{fmtTemp(d.hi_f)}</span>
                          <span className="text-[11px] text-zinc-400">{fmtTemp(d.lo_f)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* this week — actual so far + forecast */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWeekOffset((o) => o - 1)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="Previous week"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[8.5rem] text-center text-sm font-semibold text-zinc-700">
                    {weekOffset === 0 ? "This week" : `${fullDay(week.start)} – ${fullDay(week.end)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWeekOffset((o) => Math.min(0, o + 1))}
                    disabled={weekOffset >= 0}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label="Next week"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  {weekOffset !== 0 && (
                    <button
                      type="button"
                      onClick={() => setWeekOffset(0)}
                      className="ml-1 rounded-md px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
                    >
                      This week
                    </button>
                  )}
                </div>
                <span className="text-xs text-zinc-400">
                  <span className="text-zinc-500">●</span> actual · <span className="text-zinc-300">○</span> forecast
                </span>
              </div>
              {weekQ.isLoading || curQ.isLoading ? (
                <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
              ) : (
                <div className="flex flex-wrap gap-3">
                  {weekDays.map((d) => {
                    const isToday = d.date === todayYmd;
                    const isFcst = d.kind === "forecast";
                    return (
                      <div
                        key={d.date}
                        className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-center ${
                          isToday ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "bg-zinc-50"
                        }`}
                      >
                        <span className="text-[11px] font-medium text-zinc-500">{dayLabel(d.date)}</span>
                        {isFcst && d.icon ? (
                          <img src={d.icon} alt="" className="h-5 w-5" />
                        ) : (
                          <span className={`text-[10px] leading-3 ${isFcst ? "text-zinc-300" : "text-zinc-500"}`}>{isFcst ? "○" : "●"}</span>
                        )}
                        <span className="text-sm font-semibold text-red-500">{fmtTemp(d.hi_f)}</span>
                        <span className="text-xs text-blue-500">{fmtTemp(d.lo_f)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* this week, last year */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-700">This week, last year</span>
                <span className="text-xs text-zinc-400">
                  {fullDay(lastYear.start)} – {fullDay(lastYear.end)}
                </span>
              </div>
              {lyQ.isLoading ? (
                <div className="h-20 animate-pulse rounded-lg bg-zinc-100" />
              ) : lyPoints.length === 0 ? (
                <div className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                  No weather recorded for this week last year. Backfill {lastYear.year} from Admin → Weather Sync to fill it in.
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {lyPoints.map((p) => (
                    <div key={p.date} className="flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-lg bg-zinc-50 px-2 py-2 text-center">
                      <span className="text-[11px] font-medium text-zinc-500">{dayLabel(p.date)}</span>
                      <span className="text-sm font-semibold text-red-500">{fmtTemp(p.hi_f)}</span>
                      <span className="text-xs text-blue-500">{fmtTemp(p.lo_f)}</span>
                      {p.precip_in != null && p.precip_in > 0 && (
                        <span className="text-[10px] text-zinc-400">{p.precip_in.toFixed(2)}&quot;</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* trend */}
          <Card>
            <CardBody>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-700">Trend · highs <span className="text-red-500">—</span> / lows <span className="text-blue-500">—</span></span>
                <span className="text-xs text-zinc-400">
                  {stats.warmest != null && `warmest ${fmtTemp(stats.warmest)}`}
                  {stats.coldest != null && ` · coldest ${fmtTemp(stats.coldest)}`}
                  {stats.avgHi != null && ` · avg high ${fmtTemp(stats.avgHi)}`}
                </span>
              </div>
              {histQ.isLoading ? (
                <div className="h-48 animate-pulse rounded-lg bg-zinc-100" />
              ) : (
                <WeatherTrendChart points={points} />
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
