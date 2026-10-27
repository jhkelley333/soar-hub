import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, Trophy, Target, Calendar, ChevronDown, ChevronUp, Loader2, Crown, Medal, Award } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import {
  fetchObsessionConfig,
  fetchLeaderboard,
  saveObsession,
  METRIC_CATALOG,
  type ObsessionConfig,
  type LeaderboardRow,
} from "./api";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(value: number | null | undefined, format: string): string {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "pct":     return `${value.toFixed(1)}%`;
    case "dollars": return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value.toFixed(2)}`;
    case "score":   return value.toFixed(1);
    default:        return value.toFixed(2);
  }
}

function daysRemaining(endDate: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

function daysElapsed(startDate: string): number {
  const now  = new Date(); now.setHours(0, 0, 0, 0);
  const start = new Date(startDate); start.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}

// Progress as 0–100 clamped. For "lower is better" metrics, flip the direction.
function progressPct(cfg: ObsessionConfig, current: number | null): number {
  if (current === null || cfg.baseline_value === null) return 0;
  const baseline = cfg.baseline_value;
  const target   = cfg.target_value;
  if (cfg.metric_direction === "higher") {
    if (target <= baseline) return 100;
    return Math.min(100, Math.max(0, ((current - baseline) / (target - baseline)) * 100));
  } else {
    if (target >= baseline) return 100;
    return Math.min(100, Math.max(0, ((baseline - current) / (baseline - target)) * 100));
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-5 w-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-zinc-400" />;
  if (rank === 3) return <Award className="h-5 w-5 text-amber-600" />;
  return <span className="w-5 h-5 inline-flex items-center justify-center text-xs font-bold text-zinc-400">{rank}</span>;
}

function ProgressBar({ pct, direction }: { pct: number; direction: "higher" | "lower" }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="relative h-4 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-luminosity">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 font-mono">{value}</span>
      {sub && <span className="text-xs text-zinc-400">{sub}</span>}
    </div>
  );
}

// ── Admin config form ─────────────────────────────────────────────────────────

function AdminConfigPanel({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [metricKey, setMetricKey] = useState(METRIC_CATALOG[0].key);
  const [target, setTarget]       = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10);
  });
  const [headline, setHeadline]   = useState("");
  const [err, setErr]             = useState("");

  const save = useMutation({
    mutationFn: saveObsession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["obsession-config"] });
      qc.invalidateQueries({ queryKey: ["obsession-leaderboard"] });
      setOpen(false);
      onSaved();
    },
    onError: (e: Error) => setErr(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const tv = parseFloat(target);
    if (isNaN(tv) || tv <= 0) { setErr("Enter a valid target value."); return; }
    if (!startDate || !endDate || endDate <= startDate) { setErr("End date must be after start date."); return; }
    save.mutate({ metricKey, targetValue: tv, startDate, endDate, headline: headline.trim() || undefined });
  }

  const selectedMeta = METRIC_CATALOG.find((m) => m.key === metricKey)!;

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-amber-800 dark:text-amber-300"
      >
        <span className="flex items-center gap-2"><Target className="h-4 w-4" /> Set Obsession Target</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <form onSubmit={submit} className="px-5 pb-5 flex flex-col gap-4 border-t border-amber-200 dark:border-amber-800 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Metric</span>
              <select
                value={metricKey}
                onChange={(e) => setMetricKey(e.target.value)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              >
                {METRIC_CATALOG.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <span className="text-[11px] text-zinc-400">
                {selectedMeta.direction === "higher" ? "↑ Higher is better" : "↓ Lower is better"}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                Target ({selectedMeta.format === "pct" ? "%" : selectedMeta.format === "dollars" ? "$" : "#"})
              </span>
              <input
                type="number"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={selectedMeta.format === "pct" ? "e.g. 92" : "e.g. 4500"}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Rally Headline (optional)</span>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={80}
              placeholder='e.g. "Let\'s own the drive-thru this period."'
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            />
            <span className="text-[11px] text-zinc-400">
              Baseline will be computed from the 12-week average before the start date.
            </span>
          </label>

          {err && <p className="text-sm text-rose-500">{err}</p>}

          <button
            type="submit"
            disabled={save.isPending}
            className="self-start flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2 text-sm disabled:opacity-60 transition"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
            Launch Obsession
          </button>
        </form>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-orange-100 dark:bg-orange-950 flex items-center justify-center">
        <Flame className="h-8 w-8 text-orange-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">No obsession set yet</h2>
        <p className="text-zinc-500 mt-1 text-sm max-w-xs mx-auto">
          {isAdmin
            ? "Pick the one metric the company will obsessively chase. Set a target below to light it up for everyone."
            : "An admin will set the company-wide obsession metric soon. Check back shortly."}
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ObsessionPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const qc = useQueryClient();

  const configQ = useQuery({
    queryKey: ["obsession-config"],
    queryFn: fetchObsessionConfig,
    staleTime: 60_000,
  });

  const lbQ = useQuery({
    queryKey: ["obsession-leaderboard"],
    queryFn: fetchLeaderboard,
    staleTime: 60_000,
    enabled: !!configQ.data?.config,
  });

  const cfg    = configQ.data?.config ?? null;
  const current = configQ.data?.currentValue ?? null;
  const rows   = lbQ.data?.rows ?? [];

  const pct = cfg ? progressPct(cfg, current) : 0;
  const remaining = cfg ? daysRemaining(cfg.end_date) : 0;
  const elapsed   = cfg ? daysElapsed(cfg.start_date) : 0;
  const totalDays = cfg
    ? Math.max(1, Math.ceil((new Date(cfg.end_date).getTime() - new Date(cfg.start_date).getTime()) / 86_400_000))
    : 1;

  // Find the viewer's store rank (for GMs)
  const myStoreNum = profile?.primary_store_id ?? null;
  const myRank = myStoreNum
    ? rows.findIndex((r) => r.storeNumber === String(myStoreNum)) + 1
    : 0;

  if (configQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950 flex items-center justify-center flex-shrink-0">
          <Flame className="h-5 w-5 text-orange-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">Obsession Metric</h1>
          <p className="text-sm text-zinc-500">The one number the whole company is going after.</p>
        </div>
      </div>

      {/* ── Admin config ── */}
      {isAdmin && <AdminConfigPanel onSaved={() => qc.invalidateQueries({ queryKey: ["obsession-config"] })} />}

      {/* ── No active obsession ── */}
      {!cfg && <EmptyState isAdmin={isAdmin} />}

      {/* ── Active obsession ── */}
      {cfg && (
        <>
          {/* Hero */}
          <div className="rounded-2xl border border-orange-200 dark:border-orange-800 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/40 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-orange-500">Active Obsession</span>
                <h2 className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 leading-tight mt-0.5">
                  {cfg.metric_label}
                </h2>
                {cfg.headline && (
                  <p className="text-zinc-600 dark:text-zinc-300 mt-1 text-sm italic">"{cfg.headline}"</p>
                )}
              </div>
              <div className="flex items-center gap-2 bg-white/70 dark:bg-zinc-900/60 rounded-xl px-4 py-3 border border-orange-100 dark:border-orange-900 self-start sm:self-auto">
                <Calendar className="h-4 w-4 text-orange-400 flex-shrink-0" />
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {remaining > 0 ? "Days left" : "Ended"}
                  </div>
                  <div className="text-xl font-bold text-zinc-800 dark:text-zinc-100 font-mono">
                    {remaining > 0 ? remaining : 0}
                  </div>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold text-zinc-500">
                <span>Baseline {fmt(cfg.baseline_value, cfg.metric_format)}</span>
                <span className="text-orange-600 dark:text-orange-400 font-bold">
                  {fmt(current, cfg.metric_format)} current
                </span>
                <span>Target {fmt(cfg.target_value, cfg.metric_format)}</span>
              </div>
              <ProgressBar pct={pct} direction={cfg.metric_direction} />
              <div className="flex justify-between text-[10px] text-zinc-400">
                <span>Day {elapsed} of {totalDays}</span>
                <span>
                  {pct >= 100
                    ? "🎉 Target reached!"
                    : `${pct.toFixed(0)}% of the way there`}
                </span>
              </div>
            </div>
          </div>

          {/* Stat row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label="Baseline"
              value={fmt(cfg.baseline_value, cfg.metric_format)}
              sub="12-wk avg before start"
            />
            <StatTile
              label="Current"
              value={fmt(current, cfg.metric_format)}
              sub="Period avg so far"
            />
            <StatTile
              label="Target"
              value={fmt(cfg.target_value, cfg.metric_format)}
              sub={`By ${new Date(cfg.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            />
            <StatTile
              label="Gap"
              value={
                current !== null
                  ? fmt(
                      Math.abs(cfg.target_value - current),
                      cfg.metric_format
                    )
                  : "—"
              }
              sub={
                current !== null
                  ? current >= cfg.target_value && cfg.metric_direction === "higher"
                    ? "Target hit ✓"
                    : current <= cfg.target_value && cfg.metric_direction === "lower"
                    ? "Target hit ✓"
                    : "Still to close"
                  : ""
              }
            />
          </div>

          {/* Leaderboard */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Leaderboard</h3>
              {myRank > 0 && (
                <span className="ml-auto text-xs font-semibold text-zinc-400">
                  Your store: #{myRank}
                </span>
              )}
            </div>

            {lbQ.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-300" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">
                No data yet for the current period.
              </p>
            ) : (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_auto_auto] bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  <span>#</span>
                  <span>Store</span>
                  <span className="sm:hidden">{cfg.metric_label}</span>
                  <span className="hidden sm:block text-right">{cfg.metric_label}</span>
                  <span className="hidden sm:block text-right">vs Target</span>
                </div>
                {rows.map((row, i) => {
                  const rank = i + 1;
                  const isMe = myStoreNum && String(row.storeNumber) === String(myStoreNum);
                  const hitTarget =
                    cfg.metric_direction === "higher"
                      ? row.avg >= cfg.target_value
                      : row.avg <= cfg.target_value;
                  const diff =
                    cfg.metric_direction === "higher"
                      ? row.avg - cfg.target_value
                      : cfg.target_value - row.avg;

                  return (
                    <div
                      key={row.storeNumber}
                      className={`grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[2.5rem_1fr_auto_auto] px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 transition ${
                        isMe ? "bg-orange-50 dark:bg-orange-950/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      }`}
                    >
                      <span className="flex items-center">
                        <RankIcon rank={rank} />
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span className={`text-sm font-semibold truncate ${isMe ? "text-orange-700 dark:text-orange-300" : "text-zinc-800 dark:text-zinc-100"}`}>
                          {isMe && <span className="text-[10px] font-bold text-orange-500 mr-1">YOU</span>}
                          #{row.storeNumber} {row.storeName}
                        </span>
                      </span>
                      <span className="text-sm font-bold font-mono text-right text-zinc-800 dark:text-zinc-100">
                        {fmt(row.avg, cfg.metric_format)}
                      </span>
                      <span className={`hidden sm:block text-xs font-semibold text-right self-center ml-3 ${hitTarget ? "text-emerald-500" : "text-zinc-400"}`}>
                        {hitTarget
                          ? "✓ Hit"
                          : `${diff >= 0 ? "+" : ""}${fmt(Math.abs(diff), cfg.metric_format)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
