// The ranking results view — the mockup made real, on live Hub data.
// Run bar → alerts → source board → scope/tier controls → column-grouped
// sortable table with 1–5 score chips → action report. Rows expand for the
// full metric detail (deeper than the sheet could go). Admin-only route.

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Play, RefreshCw } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { toCSV, downloadCSV } from "@/lib/csv";
import {
  fetchRankingFull, fetchRankingLatest, fetchRankingRuns, triggerRankingRun,
  type RankMetrics, type RankScope, type RankTier, type RankingResultRow,
} from "./api";
import { downloadRankingWorkbook } from "./rankingWorkbook";

// ── formatting ────────────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const fmtMoney = (v: unknown) => (isNum(v) ? `$${Math.round(v).toLocaleString("en-US")}` : "—");
const fmtPct1 = (v: unknown) => (isNum(v) ? `${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—");
const fmtSignedPct = (v: unknown) =>
  isNum(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : typeof v === "string" ? v : "—";
const fmtInt = (v: unknown) => (isNum(v) ? Math.round(v).toLocaleString("en-US") : "—");
const fmtNum1 = (v: unknown) => (isNum(v) ? v.toFixed(1) : typeof v === "string" ? v : "—");
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";
const fmtStamp = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// The signature: 1–5 score chips. Red jumps before you read a number.
const SCORE_BG: Record<number, string> = {
  1: "bg-red-600", 2: "bg-amber-500", 3: "bg-zinc-400", 4: "bg-emerald-500", 5: "bg-emerald-700",
};
function ScoreChip({ v }: { v: unknown }) {
  if (!isNum(v)) return <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded bg-zinc-100 font-mono text-xs text-zinc-400">–</span>;
  return <span className={cn("inline-flex h-[22px] w-[22px] items-center justify-center rounded font-mono text-xs font-semibold text-white", SCORE_BG[v] ?? "bg-zinc-400")}>{v}</span>;
}

// ── column model ──────────────────────────────────────────────────────
type Kind = "rank" | "id" | "pts" | "money" | "spct" | "varpct" | "hrsover" | "pct1" | "num1" | "score" | "tot" | "int" | "text";
interface Col { g: string; label: string; key: string; kind: Kind }

const GROUPS: Record<string, string> = { id: "Info", sales: "Sales", fc: "Food cost", labor: "Labor", fin: "Financial", ops: "Operations", info: "Info only" };

// Each metric group gets its own shade so the eye can jump straight to a
// section. Header band color + a matching soft tint for the column-header
// row and the active toggle chip.
const GROUP_HEAD: Record<string, string> = {
  id: "bg-zinc-900", sales: "bg-indigo-700", fc: "bg-amber-700",
  labor: "bg-violet-700", fin: "bg-teal-700", ops: "bg-slate-600", info: "bg-neutral-600",
};
const GROUP_TINT: Record<string, string> = {
  sales: "bg-indigo-50", fc: "bg-amber-50", labor: "bg-violet-50",
  fin: "bg-teal-50", ops: "bg-slate-100", info: "bg-neutral-100",
};
const GROUP_CHIP: Record<string, string> = {
  sales: "border-indigo-700 bg-indigo-700", fc: "border-amber-700 bg-amber-700",
  labor: "border-violet-700 bg-violet-700", fin: "border-teal-700 bg-teal-700",
  ops: "border-slate-600 bg-slate-600", info: "border-neutral-600 bg-neutral-600",
};

// Full parity with the .xlsx workbook: every metric it exports has an
// on-screen column, grouped and toggleable. Location rides inside the Store
// cell rather than its own column. Leaders derive from this same list so the
// board can never expose fewer metrics than the download.
const STORE_COLS: Col[] = [
  { g: "id", label: "#", key: "rank", kind: "rank" },
  { g: "id", label: "Store", key: "__store", kind: "id" },
  { g: "id", label: "GM", key: "gm", kind: "text" },
  { g: "id", label: "Points", key: "totalPoints", kind: "pts" },
  { g: "sales", label: "Sales", key: "sales", kind: "money" },
  { g: "sales", label: "LY", key: "lySales", kind: "money" },
  { g: "sales", label: "vs LY", key: "pctVsLy", kind: "spct" },
  { g: "sales", label: "Tickets", key: "tickets", kind: "int" },
  { g: "sales", label: "LY Tickets", key: "lyTickets", kind: "int" },
  { g: "sales", label: "Tickets vs LY %", key: "ticketsVsLyPct", kind: "spct" },
  { g: "sales", label: "Score", key: "salesScore", kind: "score" },
  { g: "fc", label: "COGS eff", key: "cogsEff", kind: "pct1" },
  { g: "fc", label: "$ miss", key: "fcMiss", kind: "money" },
  { g: "fc", label: "Annualized", key: "fcAnnualized", kind: "money" },
  { g: "fc", label: "Score", key: "fcScore", kind: "score" },
  { g: "labor", label: "Labor %", key: "laborPct", kind: "pct1" },
  { g: "labor", label: "PTO %", key: "ptoPct", kind: "pct1" },
  { g: "labor", label: "Chart", key: "chart", kind: "pct1" },
  { g: "labor", label: "Var", key: "varianceToChart", kind: "varpct" },
  { g: "labor", label: "$ miss", key: "laborMiss", kind: "money" },
  { g: "labor", label: "Hrs over", key: "hoursOver", kind: "hrsover" },
  { g: "labor", label: "Hrs/store", key: "avgHoursOverPerStore", kind: "hrsover" },
  { g: "labor", label: "Annualized", key: "laborAnnualized", kind: "money" },
  { g: "labor", label: "Score", key: "laborScore", kind: "score" },
  { g: "fin", label: "$ miss", key: "finMiss", kind: "money" },
  { g: "fin", label: "Annualized", key: "finAnnualized", kind: "money" },
  { g: "fin", label: "Fin score", key: "finScore", kind: "tot" },
  { g: "ops", label: "BSC", key: "bscTrainingPct", kind: "pct1" },
  { g: "ops", label: "Score", key: "bscScore", kind: "score" },
  { g: "ops", label: "On time", key: "onTimePct", kind: "pct1" },
  { g: "ops", label: "Score", key: "onTimeScore", kind: "score" },
  { g: "ops", label: "Calls /10k", key: "callsPer10k", kind: "num1" },
  { g: "ops", label: "Complaints", key: "complaintsScore", kind: "score" },
  { g: "ops", label: "EcoSure", key: "ecosure", kind: "pct1" },
  { g: "ops", label: "Score", key: "ecosureScore", kind: "score" },
  { g: "ops", label: "VOG", key: "vog", kind: "pct1" },
  { g: "ops", label: "Score", key: "vogScore", kind: "score" },
  { g: "ops", label: "Training", key: "totalTrainingPct", kind: "pct1" },
  { g: "ops", label: "Score", key: "totalTrainingScore", kind: "score" },
  { g: "ops", label: "Shops", key: "msCount", kind: "int" },
  { g: "ops", label: "Shop avg", key: "msScore", kind: "pct1" },
  { g: "ops", label: "Ops score", key: "opsScore", kind: "tot" },
  { g: "info", label: "Voids $", key: "voids", kind: "money" },
  { g: "info", label: "Voids %", key: "voidsPct", kind: "pct1" },
  { g: "info", label: "DOH", key: "doh", kind: "num1" },
  { g: "info", label: "Ending $", key: "endingDollars", kind: "money" },
  { g: "info", label: "$ over goal", key: "dollarsOverGoal", kind: "money" },
];

// Leaders (DO / SDO / RVP / Entity / Company) carry every store metric — the
// engine rolls each one up — with Name/Stores swapped in for Store/GM.
const LEADER_COLS: Col[] = [
  { g: "id", label: "#", key: "rank", kind: "rank" },
  { g: "id", label: "Name", key: "name", kind: "id" },
  { g: "id", label: "Stores", key: "storeCount", kind: "int" },
  { g: "id", label: "Points", key: "totalPoints", kind: "pts" },
  ...STORE_COLS.filter((c) => c.g !== "id"),
];

// WTD hides the sources the engine's WTD contract excludes.
const WTD_HIDE = new Set(["ecosure", "ecosureScore", "totalTrainingPct", "totalTrainingScore", "vogResponses", "msCount", "msScore"]);

const TIER_TABS: { id: RankTier; label: string }[] = [
  { id: "store", label: "Stores" }, { id: "do", label: "DOs" }, { id: "sdo", label: "SDOs" },
  { id: "rvp", label: "RVPs" }, { id: "entity", label: "Entities" }, { id: "company", label: "Company" },
];

const SOURCE_LABEL: Record<string, string> = {
  skunkworks: "Skunkworks API", ix: "Inventory Expressway", ecosure: "EcoSure", vog: "VOG",
  shops: "Mystery shops", bsc: "BSC Training", totzone: "TotZone", complaints: "Complaints",
};

function cellValue(r: RankingResultRow, c: Col): unknown {
  if (c.key === "rank") return r.rank;
  if (c.key === "totalPoints") return r.total_points;
  return r.metrics[c.key];
}

// ── CSV export (opens in Excel) ───────────────────────────────────────
// Every column regardless of the on-screen group toggles (WTD still hides
// its excluded sources). Headers are disambiguated — "Sales: Score",
// "Operations: BSC Score" — because the grid reuses "Score" everywhere.
function exportHeaders(cols: Col[]): { col: Col | null; header: string }[] {
  const out: { col: Col | null; header: string }[] = [];
  let prev = "";
  for (const c of cols) {
    if (c.key === "__store") {
      out.push({ col: c, header: "Store #" }, { col: null, header: "Location" });
      prev = c.label;
      continue;
    }
    const base = c.label === "Score" ? `${prev} Score` : c.label;
    out.push({ col: c, header: c.g === "id" ? base : `${GROUPS[c.g]}: ${base}` });
    prev = c.label;
  }
  return out;
}

function csvValue(r: RankingResultRow, c: Col): string | number {
  const v = cellValue(r, c);
  switch (c.kind) {
    case "money": return isNum(v) ? Math.round(v * 100) / 100 : "";
    case "spct":
    case "pct1": return isNum(v) ? Math.round(v * 1000) / 10 : typeof v === "string" ? v : "";
    case "num1": return isNum(v) ? Math.round(v * 10) / 10 : typeof v === "string" ? v : "";
    case "rank": case "pts": case "score": case "tot": case "int": return isNum(v) ? v : "";
    default: return v == null ? "" : String(v);
  }
}

function Cell({ v, kind }: { v: unknown; kind: Kind }) {
  switch (kind) {
    case "rank": return <span className="font-mono text-xs text-zinc-400">{isNum(v) ? v : "–"}</span>;
    case "pts": return <span className="font-mono text-[15px] font-bold text-midnight">{isNum(v) ? v : "–"}</span>;
    case "money": return <span className="font-mono text-xs">{fmtMoney(v)}</span>;
    case "spct": {
      const cls = isNum(v) ? (v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "") : "text-zinc-400";
      return <span className={cn("font-mono text-xs", cls)}>{fmtSignedPct(v)}</span>;
    }
    case "varpct": {
      // Labor variance is inverted: OVER chart (positive) is bad -> red;
      // UNDER chart (negative) is good -> green.
      const cls = isNum(v) ? (v > 0 ? "text-red-600" : v < 0 ? "text-emerald-700" : "") : "text-zinc-400";
      return <span className={cn("font-mono text-xs", cls)}>{fmtSignedPct(v)}</span>;
    }
    case "hrsover": {
      const cls = isNum(v) ? (v > 0 ? "text-red-600" : "text-emerald-700") : "text-zinc-400";
      return <span className={cn("font-mono text-xs", cls)}>{fmtInt(v)}</span>;
    }
    case "pct1": return <span className={cn("font-mono text-xs", !isNum(v) && "text-zinc-400")}>{fmtPct1(v)}</span>;
    case "num1": return <span className={cn("font-mono text-xs", !isNum(v) && "text-zinc-400")}>{fmtNum1(v)}</span>;
    case "score": return <ScoreChip v={v} />;
    case "tot": return <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold">{isNum(v) ? v : "–"}</span>;
    case "int": return <span className="font-mono text-xs">{fmtInt(v)}</span>;
    default: return <span className="text-xs text-zinc-500">{v == null ? "—" : String(v)}</span>;
  }
}

// ── main view ────────────────────────────────────────────────────────
export function RankingResultsView() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [scope, setScope] = useState<RankScope>("ptd");
  const [tier, setTier] = useState<RankTier>("store");
  const [groupsOn, setGroupsOn] = useState<Record<string, boolean>>({ sales: true, fc: false, labor: false, fin: true, ops: true, info: false });
  const [showScores, setShowScores] = useState(true); // 1–5 chips + Fin/Ops score totals
  const [showPoints, setShowPoints] = useState(true); // the Points column
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // null = the latest run; a run id = the picked week (legacy-ranker-style).
  const [runId, setRunId] = useState<string | null>(null);
  const [wbBusy, setWbBusy] = useState(false);

  const runsQ = useQuery({ queryKey: ["ranking-runs-list"], queryFn: fetchRankingRuns, staleTime: 60_000 });
  const weekRuns = runsQ.data?.runs ?? [];

  const q = useQuery({
    queryKey: ["ranking-run", scope, tier, runId ?? "latest"],
    queryFn: () => fetchRankingLatest(scope, tier, runId),
    staleTime: 60_000,
  });
  const run = q.data?.run ?? null;

  // Where the shown run sits in the per-week list (0 = newest).
  const weekIdx = run ? weekRuns.findIndex((r) => r.id === run.id || r.week_ending === run.week_ending) : -1;
  const canOlder = weekIdx >= 0 && weekIdx < weekRuns.length - 1;
  const canNewer = weekIdx > 0;

  const runNow = useMutation({
    mutationFn: triggerRankingRun,
    onSuccess: (r) => {
      toast.push(`Ranked P${r.period} W${r.week} (week ending ${r.week_ending}) — ${r.rows} rows.`, "success");
      setRunId(null); // jump back to the latest
      qc.invalidateQueries({ queryKey: ["ranking-run"] });
      qc.invalidateQueries({ queryKey: ["ranking-runs-list"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Run failed.", "error"),
  });

  const baseCols = tier === "store" ? STORE_COLS : LEADER_COLS;
  const cols = useMemo(
    () => baseCols.filter((c) =>
      (c.g === "id" || groupsOn[c.g])
      && !(scope === "wtd" && WTD_HIDE.has(c.key))
      && !(!showScores && (c.kind === "score" || c.kind === "tot")) // hide 1–5 chips + Fin/Ops totals
      && !(!showPoints && c.kind === "pts")),                        // hide Points column
    [baseCols, groupsOn, scope, showScores, showPoints],
  );

  // Frozen identity columns (Rank, Store/Name, GM/Stores): cumulative left
  // offsets so they stay pinned while the metric columns scroll under them.
  const idw = (key: string): number =>
    ({ rank: 46, __store: 176, gm: 128, name: 184, storeCount: 62 } as Record<string, number>)[key] ?? 96;
  const { stickyLeft, idBlockWidth, lastIdIdx } = useMemo(() => {
    const offsets: (number | null)[] = [];
    let acc = 0, last = -1;
    cols.forEach((c, i) => {
      if (c.g === "id") { offsets.push(acc); acc += idw(c.key); last = i; }
      else offsets.push(null);
    });
    return { stickyLeft: offsets, idBlockWidth: acc, lastIdIdx: last };
  }, [cols]);

  // Download the shown week + scope + tier as CSV (opens in Excel). Every
  // column ships regardless of the on-screen group toggles; search filters
  // are ignored — the file is the full board.
  function exportExcel() {
    if (!run) return;
    const allRows = q.data?.rows ?? [];
    const exportCols = baseCols.filter((c) => !(scope === "wtd" && WTD_HIDE.has(c.key)));
    const spec = exportHeaders(exportCols);
    const headers = spec.map((s) => s.header);
    const csvRows = allRows.map((r) => {
      const row: Record<string, unknown> = {};
      for (const s of spec) {
        if (s.header === "Store #") row[s.header] = r.entity_key;
        else if (s.col === null) row[s.header] = String(r.metrics.location ?? "");
        else row[s.header] = csvValue(r, s.col);
      }
      return row;
    });
    const tierLabel = (TIER_TABS.find((t) => t.id === tier)?.label ?? tier).toLowerCase().replace(/\s+/g, "-");
    downloadCSV(
      `soar-ranking-P${run.period}W${run.week}-${scope}-${tierLabel}.csv`,
      toCSV(headers, csvRows),
    );
    toast.push(`Downloaded P${run.period}W${run.week} · ${scope.toUpperCase()} · ${tierLabel} (${allRows.length} rows).`, "success");
  }

  // Full formatted .xlsx workbook — every tier, both scopes, styled like the
  // sheet (colored score cells, grouped headers). Fetches the whole run.
  async function exportWorkbook() {
    if (!run) return;
    setWbBusy(true);
    try {
      // Pin to the exact run the board is showing (run.id), so the workbook
      // can never resolve a different "latest" than what's on screen.
      const full = await fetchRankingFull(run.id);
      if (!full.run) { toast.push("No run to export.", "error"); return; }
      await downloadRankingWorkbook(full.run, full.scopes);
      toast.push(`Workbook downloaded — P${full.run.period}W${full.run.week}.`, "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Workbook export failed.", "error");
    } finally {
      setWbBusy(false);
    }
  }

  const rows = useMemo(() => {
    let r = [...(q.data?.rows ?? [])];
    const needle = search.trim().toLowerCase();
    if (needle) {
      r = r.filter((x) => {
        const m = x.metrics;
        return [x.entity_key, m.location, m.gm, m.name].some((v) => String(v ?? "").toLowerCase().includes(needle));
      });
    }
    if (sort) {
      const valOf = (x: RankingResultRow) =>
        sort.key === "rank" ? x.rank
          : sort.key === "totalPoints" ? x.total_points
          : sort.key === "__store" ? x.entity_key
          : x.metrics[sort.key];
      r.sort((a, b) => {
        const av = valOf(a), bv = valOf(b);
        if (!isNum(av) && !isNum(bv)) return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true }) * sort.dir;
        if (!isNum(av)) return 1; // no-data rows always sink to the bottom
        if (!isNum(bv)) return -1;
        return (av - bv) * sort.dir;
      });
    }
    return r;
  }, [q.data, search, sort]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;

  return (
    <div className="space-y-4">
      {/* Run bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-midnight">Weekly ranking</h2>
          <p className="text-xs text-zinc-500">
            {run
              ? <>Period <b className="text-midnight">{run.period}</b> · Week <b className="text-midnight">{run.week}</b> · Week ending <b className="text-midnight">{fmtDate(run.week_ending)}</b> · Last run <b className="text-midnight">{fmtStamp(run.completed_at)}</b> · run <b className="text-midnight">{String(run.id).slice(0, 8)}</b> · config {run.config_version}</>
              : "No runs yet — hit Run now to rank the last completed week from live Hub data."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Week picker — browse past runs like the legacy ranker's week tabs */}
          {weekRuns.length > 0 && (
            <div className="flex items-center gap-1">
              <button type="button" title="Older week" disabled={!canOlder}
                onClick={() => canOlder && setRunId(weekRuns[weekIdx + 1].id)}
                className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:border-zinc-300 disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <select
                value={run?.id && weekRuns.some((r) => r.id === run.id) ? run.id : weekRuns[Math.max(weekIdx, 0)]?.id ?? ""}
                onChange={(e) => setRunId(e.target.value === weekRuns[0]?.id ? null : e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm font-semibold text-midnight focus:border-accent focus:outline-none"
              >
                {weekRuns.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    P{r.period}W{r.week} · {fmtDate(r.week_ending)}{i === 0 ? " (latest)" : ""}
                  </option>
                ))}
              </select>
              <button type="button" title="Newer week" disabled={!canNewer}
                onClick={() => canNewer && setRunId(weekIdx - 1 === 0 ? null : weekRuns[weekIdx - 1].id)}
                className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:border-zinc-300 disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={exportExcel} disabled={!run || rows.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={exportWorkbook} disabled={!run || wbBusy}>
            <Download className="mr-1 h-3.5 w-3.5" /> {wbBusy ? "Building…" : "Workbook"}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
              {runNow.isPending
                ? <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> Running…</>
                : <><Play className="mr-1 h-3.5 w-3.5" /> Run now</>}
            </Button>
          )}
        </div>
      </div>

      {/* Viewing-history banner */}
      {runId && run && (
        <div className="rounded-lg border-l-4 border-accent bg-accent/5 px-3.5 py-2 text-xs text-zinc-600">
          Viewing a past week — <b>P{run.period}W{run.week}, week ending {fmtDate(run.week_ending)}</b>.{" "}
          <button className="font-semibold text-accent hover:underline" onClick={() => setRunId(null)}>
            Jump to latest
          </button>
        </div>
      )}

      {/* Alerts */}
      {(run?.issues ?? []).map((iss, i) => (
        <div key={i} className={cn(
          "rounded-lg border-l-4 px-3.5 py-2.5 text-xs",
          iss.level === "bad" ? "border-red-500 bg-red-50 text-red-800"
            : iss.level === "warn" ? "border-amber-500 bg-amber-50 text-amber-800"
            : "border-zinc-300 bg-zinc-50 text-zinc-600",
        )}>
          {iss.msg}
        </div>
      ))}

      {/* Source board */}
      {run && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(run.source_status).map(([key, s]) => (
            <span key={key} className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
              s.status === "ok" ? "border-zinc-200 bg-white"
                : s.status === "on_hold" ? "border-amber-200 bg-amber-50"
                : "border-zinc-200 bg-zinc-50",
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full",
                s.status === "ok" ? "bg-emerald-600" : s.status === "stale" ? "bg-amber-500" : s.status === "on_hold" ? "bg-amber-500" : "bg-zinc-300")} />
              <b>{SOURCE_LABEL[key] ?? key}</b>
              <span className="text-zinc-500">
                {s.status === "ok" ? `${s.stores ?? ""} stores`
                  : s.status === "stale" ? `stale — ${(s as { week_ending?: string; as_of?: string }).week_ending ?? (s as { as_of?: string }).as_of ?? "old"}`
                  : s.status === "on_hold" ? "on hold"
                  : s.status === "missing" ? "missing" : "not wired"}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 pb-2">
        <Segmented<RankScope> dense value={scope} onChange={setScope}
          options={[{ value: "ptd", label: "Period to date" }, { value: "wtd", label: "Week to date" }]} />
        <div className="ml-auto flex gap-0.5">
          {TIER_TABS.map((t) => (
            <button key={t.id} onClick={() => { setTier(t.id); setSort(null); setOpenRow(null); }}
              className={cn("border-b-2 px-3 pb-2 pt-1.5 text-sm font-bold transition",
                tier === t.id ? "border-midnight text-midnight" : "border-transparent text-zinc-400 hover:text-zinc-600")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Store, city or GM"
          className="w-56 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none" />
        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Columns</span>
        {Object.entries(GROUPS).filter(([k]) => k !== "id").map(([k, label]) => (
          <button key={k} onClick={() => setGroupsOn((g) => ({ ...g, [k]: !g[k] }))}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-bold transition",
              groupsOn[k] ? cn(GROUP_CHIP[k] ?? "border-midnight bg-midnight", "text-white") : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300")}>
            {label}
          </button>
        ))}
        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Show</span>
        <button onClick={() => setShowScores((v) => !v)}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-bold transition",
            showScores ? "border-midnight bg-midnight text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300")}>
          Scores
        </button>
        <button onClick={() => setShowPoints((v) => !v)}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-bold transition",
            showPoints ? "border-midnight bg-midnight text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300")}>
          Points
        </button>
      </div>

      {/* Table — header rows + the identity (Store/GM) columns stay locked
          so the numbers keep their context while you scroll both ways. */}
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {(() => {
                  const out: React.ReactNode[] = [];
                  let g = "", span = 0;
                  const flush = (grp: string, sp: number, key: string) => {
                    const isId = grp === "id";
                    out.push(
                      <th key={key} colSpan={sp}
                        style={isId ? { left: 0, minWidth: idBlockWidth } : undefined}
                        className={cn("h-7 px-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-white sticky top-0",
                          GROUP_HEAD[grp] ?? "bg-midnight",
                          isId ? "z-40 left-0" : "z-30")}>
                        {GROUPS[grp]}
                      </th>,
                    );
                  };
                  cols.forEach((c, i) => {
                    if (c.g !== g) { if (g) flush(g, span, g + i); g = c.g; span = 0; }
                    span++;
                    if (i === cols.length - 1) flush(g, span, g + "end");
                  });
                  return out;
                })()}
              </tr>
              <tr>
                {cols.map((c, i) => {
                  const left = stickyLeft[i];
                  const sticky = left != null;
                  return (
                    <th key={i} onClick={() => setSort((s) => s?.key === c.key
                      ? { key: c.key, dir: s.dir === 1 ? -1 : 1 }
                      : { key: c.key, dir: c.key === "rank" || c.key === "__store" || c.key === "name" ? 1 : -1 })}
                      style={sticky ? { left, minWidth: idw(c.key) } : undefined}
                      className={cn("cursor-pointer whitespace-nowrap border-b border-zinc-200 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500 hover:text-zinc-800 sticky top-7",
                        c.kind === "id" || c.kind === "text" ? "text-left" : "text-right",
                        sticky ? "bg-zinc-100 z-30" : cn(GROUP_TINT[c.g] ?? "bg-zinc-50", "z-20"),
                        i === lastIdIdx && "border-r border-zinc-200",
                        sort?.key === c.key && "text-midnight")}>
                      {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▴" : " ▾") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.metrics;
                const rowKey = r.entity_key;
                const isOpen = openRow === rowKey;
                return (
                  <Fragment key={rowKey}>
                    <tr onClick={() => setOpenRow(isOpen ? null : rowKey)}
                      className="group cursor-pointer border-b border-zinc-100">
                      {cols.map((c, i) => {
                        const left = stickyLeft[i];
                        const stickyCls = left != null
                          ? cn("sticky z-10 bg-white group-hover:bg-zinc-50", i === lastIdIdx && "border-r border-zinc-200")
                          : "group-hover:bg-zinc-50";
                        const style = left != null ? { left, minWidth: idw(c.key) } : undefined;
                        if (c.key === "__store") {
                          return (
                            <td key={i} style={style} className={cn("whitespace-nowrap px-2.5 py-2 text-left", stickyCls)}>
                              <span className="font-mono text-sm font-bold">{r.entity_key}</span>
                              <div className="text-xs text-zinc-500">{String(m.location ?? "")}</div>
                            </td>
                          );
                        }
                        if (c.key === "name") {
                          return <td key={i} style={style} className={cn("whitespace-nowrap px-2.5 py-2 text-left text-sm font-semibold text-midnight", stickyCls)}>{String(m.name ?? r.entity_key)}</td>;
                        }
                        if (c.kind === "text") {
                          return <td key={i} style={style} className={cn("whitespace-nowrap px-2.5 py-2 text-left text-xs text-zinc-500", stickyCls)}>{String(m[c.key] ?? "—")}</td>;
                        }
                        return <td key={i} style={style} className={cn("whitespace-nowrap px-2.5 py-2 text-right", stickyCls)}><Cell v={cellValue(r, c)} kind={c.kind} /></td>;
                      })}
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-zinc-100 bg-zinc-50/70">
                        <td colSpan={cols.length} className="px-4 py-3">
                          <DetailGrid m={m} />
                          {tier === "store" && (
                            <Link to="/labor-v2" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                              Open Labor v2 <ChevronRight className="h-3 w-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50/60 px-3.5 py-2 text-xs text-zinc-500">
          <span>{rows.length} row{rows.length === 1 ? "" : "s"} · {cols.length} of {baseCols.length} columns · click a row for full detail</span>
          <span className="inline-flex items-center gap-1">Scores {[1, 2, 3, 4, 5].map((s) => <ScoreChip key={s} v={s} />)}</span>
        </div>
      </div>

      {/* Action report — computed from the PTD store rows of this run */}
      {tier === "store" && rows.length > 0 && <ActionReport rows={q.data?.rows ?? []} />}
    </div>
  );
}

// Expanded row: every metric, labeled — the "go deeper" layer.
const DETAIL_LABELS: [string, string, (v: unknown) => string][] = [
  ["sales", "Sales", fmtMoney], ["lySales", "LY sales", fmtMoney], ["pctVsLy", "vs LY", fmtSignedPct],
  ["tickets", "Tickets", fmtInt], ["lyTickets", "LY tickets", fmtInt], ["ticketsVsLyPct", "Tickets vs LY", fmtSignedPct],
  ["laborPct", "Labor %", fmtPct1], ["ptoPct", "PTO %", fmtPct1], ["chart", "Chart (IX target)", fmtPct1], ["varianceToChart", "Variance", fmtSignedPct],
  ["laborMiss", "Labor $ miss", fmtMoney], ["hoursOver", "Hours over", fmtInt], ["avgHoursOverPerStore", "Hrs over/store", fmtNum1], ["laborAnnualized", "Labor annualized", fmtMoney],
  ["cogsEff", "COGS efficiency", fmtPct1], ["fcMiss", "FC $ miss", fmtMoney], ["fcAnnualized", "FC annualized", fmtMoney],
  ["finMiss", "Financial $ miss", fmtMoney], ["finAnnualized", "Fin annualized", fmtMoney],
  ["bscTrainingPct", "BSC training", fmtPct1], ["onTimePct", "On time", fmtPct1],
  ["callsPer10k", "Calls /10k tkts", fmtNum1], ["complaints", "Complaints", fmtNum1],
  ["ecosure", "EcoSure", fmtPct1], ["vog", "VOG", fmtPct1],
  ["totalTrainingPct", "Training %", fmtPct1], ["msCount", "Shops", fmtInt], ["msScore", "Shop avg", fmtPct1],
  ["voids", "Voids $", fmtMoney], ["voidsPct", "Voids %", fmtPct1], ["doh", "DOH", fmtNum1],
  ["endingDollars", "Ending $", fmtMoney], ["dollarsOverGoal", "$ over goal", fmtMoney],
];
function DetailGrid({ m }: { m: RankMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4 lg:grid-cols-6">
      {DETAIL_LABELS.map(([key, label, fmt]) => (
        <div key={key} className="flex items-baseline justify-between gap-2 border-b border-zinc-100 py-1">
          <span className="text-[11px] text-zinc-400">{label}</span>
          <span className="font-mono text-xs text-zinc-700">{fmt(m[key])}</span>
        </div>
      ))}
    </div>
  );
}

// The Guardrails panels, computed client-side from this run's store rows.
function ActionReport({ rows }: { rows: RankingResultRow[] }) {
  const ms = rows.map((r) => r.metrics);

  const opportunities = ms
    .filter((m) => isNum(m.finAnnualized) && (m.finAnnualized as number) > 0)
    .sort((a, b) => (b.finAnnualized as number) - (a.finAnnualized as number))
    .slice(0, 5);

  const CATS: [string, string][] = [
    ["laborScore", "Labor"], ["salesScore", "Sales vs LY"], ["onTimeScore", "On time"],
    ["fcScore", "Food cost"], ["bscScore", "BSC training"], ["vogScore", "VOG"],
  ];
  const reds = CATS
    .map(([k, label]) => [label, ms.filter((m) => m[k] === 1).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const missing: [string, string][] = [];
  const noLy = ms.filter((m) => m.pctVsLy === "NO LY").length;
  if (noLy) missing.push([`${noLy} store${noLy === 1 ? "" : "s"}`, "no LY sales"]);
  const noOt = ms.filter((m) => m.onTimePct == null).length;
  if (noOt) missing.push([`${noOt} store${noOt === 1 ? "" : "s"}`, "no on-time data"]);
  const noPts = rows.filter((r) => r.total_points == null).length;
  if (noPts) missing.push([`${noPts} store${noPts === 1 ? "" : "s"}`, "no total points"]);
  const noGm = ms.filter((m) => !m.gm).length;
  if (noGm) missing.push([`${noGm} store${noGm === 1 ? "" : "s"}`, "no GM on file"]);

  const wins = [...ms]
    .filter((m) => isNum(m.pctVsLy))
    .sort((a, b) => (b.pctVsLy as number) - (a.pctVsLy as number))
    .slice(0, 3);
  const topPts = [...rows].filter((r) => isNum(r.total_points)).sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0)).slice(0, 2);

  const storeLabel = (m: RankMetrics) => `${m.store} ${String(m.location ?? "").slice(0, 24)}`;

  return (
    <div className="pt-2">
      <h3 className="text-base font-black text-midnight">Action report</h3>
      <p className="mb-3 text-xs text-zinc-500">Generated from this run. Same panels every leader will see, scoped to what they own.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Biggest dollar opportunity (annualized)" tone="border-t-red-500">
          {opportunities.length === 0 ? <Empty /> : opportunities.map((m, i) => (
            <Item key={i} l={storeLabel(m)} r={fmtMoney(m.finAnnualized)} />
          ))}
        </Panel>
        <Panel title="Missing reporting" tone="border-t-amber-500">
          {missing.length === 0 ? <Empty text="All sources reporting." /> : missing.map(([l, r], i) => <Item key={i} l={l} r={r} />)}
        </Panel>
        <Panel title="Category reds (score = 1)" tone="border-t-zinc-300">
          {reds.length === 0 ? <Empty text="No category reds." /> : reds.map(([l, n], i) => <Item key={i} l={l} r={`${n} stores`} />)}
        </Panel>
        <Panel title="Wins" tone="border-t-emerald-600">
          {wins.map((m, i) => <Item key={`w${i}`} l={storeLabel(m)} r={fmtSignedPct(m.pctVsLy) + " LY"} />)}
          {topPts.map((r, i) => <Item key={`p${i}`} l={storeLabel(r.metrics)} r={`${r.total_points} pts`} />)}
        </Panel>
      </div>
    </div>
  );
}
function Panel({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border-t-[3px] bg-white p-3.5 ring-1 ring-zinc-200", tone)}>
      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{title}</h4>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}
function Empty({ text = "No data." }: { text?: string }) {
  return <li className="py-1 text-xs text-zinc-400">{text}</li>;
}
function Item({ l, r }: { l: string; r: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2 border-b border-zinc-50 py-1 text-xs last:border-0">
      <span className="truncate text-zinc-600">{l}</span>
      <span className="shrink-0 font-mono font-semibold text-zinc-800">{r}</span>
    </li>
  );
}
