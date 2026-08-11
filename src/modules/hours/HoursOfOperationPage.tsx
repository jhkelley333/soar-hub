// Hours of Operation — main grid. Every active store × 7 weekday columns of
// standard hours. Search + Open/Pending filter; click a row to edit that
// location (standard + special hours). Admin-gated in the router.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, CalendarClock } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchHoursGrid, type HoursGridStore } from "./api";
import { DAY_LABELS, fmtRange } from "./hoursFmt";

type Filter = "open" | "pending";

// Mon..Sun dates for the current week (for the column sub-labels, like the ref UI).
function weekDates(): { dow: string; d: number; mon: string }[] {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(now); monday.setDate(now.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    return { dow: DAY_LABELS[i], d: dt.getDate(), mon: dt.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase() };
  });
}

export function HoursOfOperationPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const query = useQuery({ queryKey: ["hours-grid"], queryFn: fetchHoursGrid });
  const cols = useMemo(() => weekDates(), []);

  const all = query.data?.stores ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((s) => (filter === "open" ? s.configured : !s.configured))
      .filter((s) => !needle || s.number.toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || (s.address ?? "").toLowerCase().includes(needle) || (s.city ?? "").toLowerCase().includes(needle));
  }, [all, q, filter]);

  const openCount = all.filter((s) => s.configured).length;
  const pendingCount = all.length - openCount;

  return (
    <>
      <PageHeader title="Hours of Operation" description="Standard weekly hours for every location. Click a location to edit its hours." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-full ring-1 ring-zinc-200">
          {([["open", "Open Locations", openCount], ["pending", "Pending Locations", pendingCount]] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn("px-4 py-1.5 text-sm font-semibold transition", filter === key ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}
            >
              {label} <span className="tabular-nums opacity-70">· {count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by location, address…"
            className="w-72 rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-midnight focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {query.isLoading && <Skeleton className="h-96 w-full" />}
      {query.isError && <EmptyState title="Couldn't load hours" description={(query.error as Error)?.message ?? "Try again."} />}

      {query.data && filtered.length === 0 && (
        <EmptyState
          title={filter === "open" ? "No locations with hours yet" : "No pending locations"}
          description={filter === "open" ? "Locations with saved standard hours will appear here." : "Every location has hours configured."}
        />
      )}

      {query.data && filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50/60 text-left">
                <tr>
                  <th className="sticky left-0 z-10 bg-zinc-50/60 px-4 py-3 font-bold text-zinc-500">Location</th>
                  {cols.map((c) => (
                    <th key={c.dow} className="px-3 py-3 text-center font-semibold text-zinc-500">
                      <div className="text-[11px] uppercase tracking-wide">{c.dow}</div>
                      <div className="text-xs font-bold text-midnight">{c.d}</div>
                      <div className="text-[9.5px] text-zinc-400">{c.mon}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <GridRow key={s.id} s={s} onOpen={() => nav(`/admin/hours-of-operation/${encodeURIComponent(s.number)}`)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function GridRow({ s, onOpen }: { s: HoursGridStore; onOpen: () => void }) {
  return (
    <tr className="cursor-pointer border-t border-zinc-100 transition hover:bg-accent/[0.04]" onClick={onOpen}>
      <td className="sticky left-0 z-10 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-midnight">{s.number}</span>
          {s.upcoming_special > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600" title={`${s.upcoming_special} upcoming special hours`}>
              <CalendarClock className="h-3 w-3" />{s.upcoming_special}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {[s.address, s.city, s.state].filter(Boolean).join(", ")}{s.zip ? ` ${s.zip}` : ""}
        </div>
      </td>
      {s.days.map((d, i) => (
        <td key={i} className={cn("px-3 py-3 text-center tabular-nums", d?.is_closed ? "text-red-500" : d ? "text-zinc-700" : "text-zinc-300")}>
          {fmtRange(d)}
        </td>
      ))}
    </tr>
  );
}
