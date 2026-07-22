// Comms Board — a read-only Hub mirror of the in-store weekly Communication
// Board. Each week's card is that week's isolated numbers (the WTD scope of the
// P<period>W<week> ranking run), auto-filled from Hub data. Cells we don't have
// a data source for yet show "—". GMs see their store; leaders pick any store
// in scope.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchCommsBoard, type CommsBoardResponse, type CommsWeek } from "./api";

type MVal = number | string | null | undefined;
const isNum = (v: MVal): v is number => typeof v === "number" && isFinite(v);
const pct1 = (v: MVal) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const signed = (v: MVal) => (isNum(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const num1 = (v: MVal) => (isNum(v) ? v.toFixed(1) : typeof v === "string" ? v : "—");
const int0 = (v: MVal) => (isNum(v) ? String(Math.round(v)) : typeof v === "string" ? v : "—");

// good = true (green) / false (red) / null (no verdict — neutral).
type Verdict = boolean | null;
interface Card {
  title: string;
  goal: string;
  key: string;
  fmt: (v: MVal) => string;
  good: (v: number) => boolean;
}

const CARDS: Card[][] = [
  [
    { title: "Sales +/- % vs. LY", goal: "5 % Increase", key: "pctVsLy", fmt: signed, good: (v) => v > 0 },
    { title: "Labor Variance +/- %", goal: "0% to Chart", key: "varianceToChart", fmt: signed, good: (v) => v <= 0 },
    { title: "Ticket Count % vs. LY", goal: "5 % Increase", key: "ticketsVsLyPct", fmt: signed, good: (v) => v > 0 },
    { title: "Voids / Discounts", goal: "Under 1%", key: "voidsPct", fmt: pct1, good: (v) => v < 0.01 },
  ],
  [
    { title: "COGS Efficiency %", goal: "96%-101%", key: "cogsEff", fmt: pct1, good: (v) => v >= 0.96 && v <= 1.01 },
    { title: "Inventory - Days on Hand", goal: "7 or 10 Days", key: "doh", fmt: num1, good: (v) => v <= 7 },
    { title: "Station Training %", goal: "100%", key: "totalTrainingPct", fmt: pct1, good: (v) => v >= 1 },
    { title: "BSC Training", goal: "95%", key: "bscTrainingPct", fmt: pct1, good: (v) => v >= 0.95 },
  ],
  [
    { title: "# of Complaints", goal: "0", key: "complaints", fmt: int0, good: (v) => v === 0 },
    { title: "Complaints / 10K Tickets", goal: "<1.3", key: "callsPer10k", fmt: num1, good: (v) => v < 1.3 },
    { title: "On-Time %", goal: "> 80%", key: "onTimePct", fmt: pct1, good: (v) => v >= 0.8 },
    { title: "Total BSC Score 1-5", goal: "5.0", key: "bscScore", fmt: num1, good: (v) => v >= 5 },
  ],
];

const FOCUS: Card[] = [
  { title: "Night Time Biz (8PM to Close)", goal: "8%", key: "__na_night", fmt: pct1, good: () => true },
  { title: "VOG", goal: "70", key: "vog", fmt: pct1, good: (v) => v >= 0.7 },
  { title: "TR vs TZ Variance", goal: "Zero Variance", key: "__na_trtz", fmt: num1, good: () => true },
  { title: "Cash +/-", goal: "Zero Variance", key: "__na_cash", fmt: num1, good: () => true },
];

const WEEK_NUMS = [1, 2, 3, 4, 5];

function verdictOf(card: Card, v: MVal): Verdict {
  if (!isNum(v)) return null;
  return card.good(v);
}

function CellPill({ card, v }: { card: Card; v: MVal }) {
  const verdict = verdictOf(card, v);
  return (
    <div
      className={cn(
        "rounded px-2 py-1 text-center text-xs font-semibold tabular-nums",
        verdict === true ? "bg-emerald-100 text-emerald-800"
          : verdict === false ? "bg-red-500 text-white"
          : "text-zinc-400"
      )}
    >
      {card.fmt(v)}
    </div>
  );
}

function MetricCard({ card, weekByNum }: { card: Card; weekByNum: Map<number, CommsWeek> }) {
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
      <div className="bg-sky-600 px-2 py-1 text-center text-xs font-bold text-white">{card.title}</div>
      <div className="bg-emerald-600 px-2 py-0.5 text-center text-[11px] font-semibold text-white">Goal: {card.goal}</div>
      <div className="divide-y divide-zinc-100 bg-white p-1">
        {WEEK_NUMS.map((wn) => {
          const wk = weekByNum.get(wn);
          const v = card.key.startsWith("__na_") ? null : (wk?.metrics?.[card.key] as MVal);
          return (
            <div key={wn} className="grid grid-cols-[auto_1fr] items-center gap-2 px-1 py-0.5">
              <span className="text-[11px] font-medium text-zinc-500">Week {wn}</span>
              <CellPill card={card} v={wk ? v : undefined} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SideStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="rounded bg-blue-500 px-2 py-1 text-xs font-bold text-white">{label}</div>
      <div className="px-2 py-2 text-center text-lg font-black text-midnight">{value ?? "—"}</div>
    </div>
  );
}
function SideInfo({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="rounded bg-blue-500 px-2 py-1 text-xs font-bold text-white">{label}</div>
      <div className="min-h-[28px] px-2 py-1.5 text-sm text-zinc-700">{value ?? <span className="text-zinc-400">—</span>}</div>
    </div>
  );
}

export function RankingCommsBoardView() {
  const [storeSel, setStoreSel] = useState<string | null>(null);
  const [periodSel, setPeriodSel] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["comms-board", storeSel, periodSel],
    queryFn: () => fetchCommsBoard({ store: storeSel, period: periodSel }),
    staleTime: 60_000,
  });
  const d: CommsBoardResponse | undefined = q.data;

  const weekByNum = useMemo(() => {
    const m = new Map<number, CommsWeek>();
    for (const w of d?.weeks ?? []) m.set(w.week, w);
    return m;
  }, [d]);

  const ranks = d?.ranks ?? {};
  const ecoFoodSafety = d?.ptd?.ecosure as MVal;

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!d || !d.store) return <EmptyState title="No comms board yet" description="No completed ranking runs to build the board from." />;

  return (
    <div className="space-y-3">
      {/* Controls + header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold uppercase tracking-wide text-zinc-500">Store</label>
          <select
            value={d.store.number}
            onChange={(e) => setStoreSel(e.target.value)}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm font-semibold text-midnight focus:border-accent focus:outline-none"
          >
            {(d.stores ?? []).map((s) => (
              <option key={s.number} value={s.number}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
            ))}
          </select>
          <label className="ml-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Period</label>
          <select
            value={d.period ?? ""}
            onChange={(e) => setPeriodSel(Number(e.target.value))}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm font-semibold text-midnight focus:border-accent focus:outline-none"
          >
            {(d.periods ?? []).map((p) => <option key={p} value={p}>Period {p}</option>)}
          </select>
        </div>
        <div className="text-right">
          <div className="text-lg font-black tracking-tight text-[#1e3a5f]">COMMUNICATION BOARD</div>
          <div className="text-xs font-semibold text-zinc-500">#{d.store.number}{d.store.location ? ` — ${d.store.location}` : ""}</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[150px_1fr_180px]">
        {/* Left rail */}
        <div className="space-y-2">
          <SideStat label="Soar Region Rank (PTD)" value={ranks.region != null ? `${ranks.region}${ranks.region_of ? ` / ${ranks.region_of}` : ""}` : "—"} />
          <SideStat label="Soar Company Rank" value={ranks.company != null ? `${ranks.company}${ranks.company_of ? ` / ${ranks.company_of}` : ""}` : "—"} />
          <SideStat label="Days without Complaints" value="—" />
          <div>
            <div className="rounded bg-blue-500 px-2 py-1 text-xs font-bold text-white">BSC Food Safety % Goal &gt;95%</div>
            <div className={cn("px-2 py-2 text-center text-lg font-black", isNum(ecoFoodSafety) && (ecoFoodSafety as number) < 0.95 ? "text-red-600" : "text-midnight")}>
              {pct1(ecoFoodSafety)}
            </div>
          </div>
          <SideInfo label="Next Weekly MGR Meeting" />
          <SideStat label="GM Completed Food Safety Audit" value="—" />
        </div>

        {/* Metric grid */}
        <div className="space-y-3">
          {CARDS.map((row, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {row.map((card) => <MetricCard key={card.key} card={card} weekByNum={weekByNum} />)}
            </div>
          ))}
          <p className="text-[11px] text-zinc-400">
            Use <span className="font-semibold text-emerald-600">green</span> when the goal is met, {" "}
            <span className="font-semibold text-red-600">red</span> when missed. Auto-filled from Hub ranking data;
            cells not yet wired to a source show “—”.
          </p>

          {/* Areas of Focus */}
          <div className="overflow-hidden rounded-lg">
            <div className="bg-orange-500 px-3 py-1.5 text-center text-sm font-black text-white">Area's of Focus</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FOCUS.map((card) => <MetricCard key={card.key} card={card} weekByNum={weekByNum} />)}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-2">
          <SideInfo label="General Manager" value={d.store.gm ?? undefined} />
          <SideInfo label="Employee of the Month" />
          <SideInfo label="New Team Members" />
          <SideInfo label="Birthdays this Month" />
          <SideInfo label="Current Promotions" />
          <SideInfo label="Top 3 Food Variances (Item and Last Week loss)" />
        </div>
      </div>
    </div>
  );
}
