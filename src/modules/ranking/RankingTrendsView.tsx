// Trends tab — the legacy ranker's archived weekly history stitched to the
// Hub's runs on one axis. Sheet-era weeks render muted, hub-era weeks solid,
// with a visible seam: the two eras measure labor differently by design, so
// only era-stable metrics (rank, raw rates, sales) are trended.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { fetchRankingTrends, importLegacyHistory, type TrendStore, type TrendWeek } from "./api";

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);

// ── sparkline ─────────────────────────────────────────────────────────
function Spark({ values, weeks, invert = false, unit = "" }: {
  values: (number | null)[];
  weeks: TrendWeek[];
  invert?: boolean;
  unit?: string;
}) {
  const nums = values.filter(isNum);
  if (nums.length < 2) return <div className="flex h-10 items-center text-xs text-zinc-300">not enough history</div>;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * 100);
  const y = (v: number) => {
    const t = (v - min) / span;
    return 3 + (invert ? t : 1 - t) * 22;
  };
  // Broken-line segments across null gaps.
  const segs: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (isNum(v)) cur.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
    else { if (cur.length > 1) segs.push(cur.join(" ")); cur = []; }
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  // Hub-era shading starts at the first hub week.
  const firstHub = weeks.findIndex((w) => w.source === "hub");
  const last = [...values].reverse().find(isNum);
  const first = values.find(isNum);
  const delta = isNum(last) && isNum(first) ? last - first : null;
  const better = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-10 w-full min-w-0">
        {firstHub >= 0 && (
          <rect x={x(Math.max(0, firstHub - 0.5))} y="0" width={100 - x(Math.max(0, firstHub - 0.5))} height="28"
            className="fill-accent/10" />
        )}
        {segs.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            className="stroke-midnight" />
        ))}
      </svg>
      <div className="w-24 shrink-0 text-right">
        <div className="font-mono text-sm font-bold text-midnight">{isNum(last) ? `${Math.round(last * 10) / 10}${unit}` : "—"}</div>
        {delta != null && (
          <div className={cn("font-mono text-[11px]", better ? "text-emerald-700" : "text-red-600")}>
            {delta > 0 ? "+" : ""}{Math.round(delta * 10) / 10}{unit}
          </div>
        )}
      </div>
    </div>
  );
}

// Rank delta over the last ~4 weeks (positive = climbed the board).
function rankMove(s: TrendStore): number | null {
  const r = s.rank;
  let last: number | null = null, prev: number | null = null;
  for (let i = r.length - 1; i >= 0; i--) {
    if (isNum(r[i])) { last = r[i]; break; }
  }
  const cut = Math.max(0, r.length - 5);
  for (let i = cut; i < r.length - 1; i++) {
    if (isNum(r[i])) { prev = r[i]; break; }
  }
  if (last == null || prev == null) return null;
  return prev - last; // rank down = improvement
}

export function RankingTrendsView() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin"; // archiving legacy history is an admin write
  const q = useQuery({ queryKey: ["ranking-trends"], queryFn: () => fetchRankingTrends(26), staleTime: 5 * 60_000 });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function runImport() {
    setImporting(true);
    try {
      let total = 0;
      for (let round = 0; round < 20; round++) {
        const r = await importLegacyHistory();
        total += r.imported.reduce((a, b) => a + b.rows, 0);
        if (!r.remaining.length) break;
      }
      toast.push(`Legacy history archived — ${total.toLocaleString()} rows imported.`, "success");
      qc.invalidateQueries({ queryKey: ["ranking-trends"] });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed.", "error");
    } finally {
      setImporting(false);
    }
  }

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load trends" description={(q.error as Error)?.message ?? "Try again."} />;

  const weeks = q.data?.weeks ?? [];
  const stores = q.data?.stores ?? {};
  const entries = Object.entries(stores);

  if (weeks.length < 2) {
    return (
      <EmptyState
        title="No history yet"
        description="Archive the legacy ranker's weekly history from the Google Sheet — do this before the sheet retires, or the trend history dies with it."
        action={isAdmin ? (
          <Button onClick={runImport} disabled={importing}>
            <Download className="mr-1 h-4 w-4" /> {importing ? "Importing…" : "Import legacy history"}
          </Button>
        ) : undefined}
      />
    );
  }

  const movers = entries
    .map(([num, s]) => ({ num, s, move: rankMove(s) }))
    .filter((m): m is { num: string; s: TrendStore; move: number } => m.move != null);
  const improvers = [...movers].sort((a, b) => b.move - a.move).slice(0, 8);
  const sliders = [...movers].sort((a, b) => a.move - b.move).slice(0, 8);

  const needle = search.trim().toLowerCase();
  const matches = needle
    ? entries.filter(([num, s]) => num.includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || (s.gm ?? "").toLowerCase().includes(needle)).slice(0, 8)
    : [];
  const sel = selected ? stores[selected] : null;

  const sheetWeeks = weeks.filter((w) => w.source === "sheet").length;
  const hubWeeks = weeks.length - sheetWeeks;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {weeks.length} weeks on the axis — <b className="text-zinc-700">{sheetWeeks} sheet-era</b> (muted) ·{" "}
          <b className="text-accent">{hubWeeks} hub-era</b> (shaded). Rank moves compare the last ~4 weeks.
        </p>
        {isAdmin && (
          <Button size="sm" variant="secondary" onClick={runImport} disabled={importing}>
            <Download className="mr-1 h-3.5 w-3.5" /> {importing ? "Syncing…" : "Sync sheet history"}
          </Button>
        )}
      </div>

      {/* Movers */}
      <div className="grid gap-3 md:grid-cols-2">
        <MoverPanel title="Climbing the board" icon={<ArrowUp className="h-3.5 w-3.5 text-emerald-600" />} rows={improvers} good onPick={setSelected} />
        <MoverPanel title="Sliding" icon={<ArrowDown className="h-3.5 w-3.5 text-red-600" />} rows={sliders} onPick={setSelected} />
      </div>

      {/* Store detail */}
      <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-midnight">Store deep-dive</span>
          <div className="relative">
            <input value={search} onChange={(e) => { setSearch(e.target.value); }} placeholder="Store #, name or GM…"
              className="w-64 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none" />
            {matches.length > 0 && (
              <div className="absolute z-10 mt-1 w-64 overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-zinc-200">
                {matches.map(([num, s]) => (
                  <button key={num} onClick={() => { setSelected(num); setSearch(""); }}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-50">
                    <b className="font-mono">{num}</b> <span className="text-zinc-500">{s.name ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {sel && selected && (
            <span className="text-xs text-zinc-500">
              #{selected} · {sel.name ?? ""}{sel.gm ? ` · GM ${sel.gm}` : ""}
            </span>
          )}
        </div>
        {!sel ? (
          <p className="py-6 text-center text-sm text-zinc-400">Pick a store (or click one in the movers lists) to see its lines.</p>
        ) : (
          <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            <TrendRow label="Rank (lower is better)"><Spark values={sel.rank} weeks={weeks} invert /></TrendRow>
            <TrendRow label="Labor %"><Spark values={sel.labor} weeks={weeks} invert unit="%" /></TrendRow>
            <TrendRow label="Sales vs LY"><Spark values={sel.vsly} weeks={weeks} unit="%" /></TrendRow>
            <TrendRow label="COGS efficiency"><Spark values={sel.cogs} weeks={weeks} unit="%" /></TrendRow>
            <TrendRow label="On time"><Spark values={sel.ontime} weeks={weeks} unit="%" /></TrendRow>
            <TrendRow label="Weekly sales $"><Spark values={sel.sales} weeks={weeks} /></TrendRow>
          </div>
        )}
        <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400">
          Sheet-era and hub-era labor are measured differently by design (chart+pad vs IX target) — that's why only
          raw, era-stable metrics are trended. The shaded region marks hub-era weeks.
        </p>
      </div>
    </div>
  );
}

function TrendRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{label}</div>
      {children}
    </div>
  );
}

function MoverPanel({ title, icon, rows, good, onPick }: {
  title: string;
  icon: React.ReactNode;
  rows: { num: string; s: TrendStore; move: number }[];
  good?: boolean;
  onPick: (num: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
        {icon} {title}
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-xs text-zinc-400">Not enough history yet.</p>
      ) : (
        <div className="divide-y divide-zinc-50">
          {rows.map(({ num, s, move }) => (
            <button key={num} onClick={() => onPick(num)}
              className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-zinc-50">
              <span className="w-14 shrink-0 font-mono text-sm font-bold text-midnight">{num}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{s.name ?? ""}</span>
              <span className={cn("shrink-0 font-mono text-xs font-semibold", good ? "text-emerald-700" : "text-red-600")}>
                {move > 0 ? `▲ ${move}` : move < 0 ? `▼ ${Math.abs(move)}` : "–"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
