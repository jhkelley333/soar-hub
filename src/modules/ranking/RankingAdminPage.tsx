// /admin/ranking — the Ranking module home (admin only, build phase).
// Two views: the live ranking (mockup made real — run bar, source board,
// score-chip table, action report) and System settings (versioned config,
// labor pad, complaints hold).

import { useMemo, useState } from "react";
import { Segmented } from "@/shared/ui/Segmented";
import { RankingResultsView } from "./RankingResultsView";
import { RankingDrillView } from "./RankingDrillView";
import { MyStoreView } from "./RankingStoreView";
import { RankingTrendsView } from "./RankingTrendsView";
import { RankingRiskView } from "./RankingRiskView";
import { RankingWatchlistView } from "./RankingWatchlistView";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, PauseCircle, Plus, Save } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import {
  addRankingConfig, backfillRankingFields, fetchRankingOverview, ingestBscRows, ingestEcosureRows, ingestIxFile, ingestShopRows, ingestTotzoneRows, ingestVogRows, setFcTargetEfficiency, setLaborPad,
  type RankingConfigRow, type RankingStoreRow,
} from "./api";

const inputCls =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";
const fmtDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");

type AdminView = "ranking" | "drill" | "watchlist" | "trends" | "risk" | "settings";

export function RankingAdminPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const isGm = profile?.role === "gm";
  const [view, setView] = useState<AdminView>("ranking");

  // A GM owns a single store — land them straight on the legacy-style store
  // dashboard, no tier tabs or board to wade through.
  if (isGm) {
    return (
      <>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              My Store Ranking
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Build</span>
            </span>
          }
          description="Your store's ranking, the way the Ranker showed it. In build — the sheet-fed Ranker stays live until cutover."
        />
        <MyStoreView />
      </>
    );
  }
  // Every leader sees the board/drill/analytics scoped to what they manage
  // (backend enforces the scope). Only admins get System settings.
  const options: { value: AdminView; label: string }[] = [
    { value: "ranking", label: "Ranking" },
    { value: "drill", label: "Drill" },
    { value: "watchlist", label: "Watchlist" },
    { value: "trends", label: "Trends" },
    { value: "risk", label: "Risk" },
    ...(isAdmin ? [{ value: "settings" as AdminView, label: "System settings" }] : []),
  ];
  const active = view === "settings" && !isAdmin ? "ranking" : view;
  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Ranking
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Build</span>
          </span>
        }
        description="Scoped to your stores and team, like the rest of the Hub. In build — the sheet-fed Ranker stays live until cutover."
      />
      <div className="mb-4">
        <Segmented<AdminView> value={active} onChange={setView} options={options} />
      </div>
      {active === "ranking" ? <RankingResultsView />
        : active === "drill" ? <RankingDrillView />
        : active === "watchlist" ? <RankingWatchlistView />
        : active === "trends" ? <RankingTrendsView />
        : active === "risk" ? <RankingRiskView />
        : <SettingsView />}
    </>
  );
}

function SettingsView() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ranking-admin"], queryFn: fetchRankingOverview });

  const [addOpen, setAddOpen] = useState(false);
  const [padSearch, setPadSearch] = useState("");

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;
  }
  const config = q.data?.config ?? [];
  const stores = q.data?.stores ?? [];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add config change
        </Button>
      </div>

      <div className="space-y-6">
        {/* Avg wage note — no longer a setting */}
        <div className="rounded-xl bg-white p-4 text-xs text-zinc-500 ring-1 ring-zinc-200">
          <b className="text-midnight">Average wage</b> is no longer a setting — each run computes the live company
          average from Labor v2 (total labor cost ÷ total labor hours, credit-adjusted) for its week.
        </div>

        <FcTargetEditor current={q.data?.fc_target_efficiency ?? 0.96}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ranking-admin"] })} />

        <IxUploadPanel />

        <TotzoneUploadPanel />

        <EcosureUploadPanel />

        <BscUploadPanel />

        <ShopsUploadPanel />

        <VogUploadPanel />

        <BackfillPanel />
        {/* Complaints placeholder */}
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-800">Complaints data — on hold</div>
            <p className="text-xs text-amber-700">
              No complaints source is wired yet (decided 7/13). Stores rank without it: the engine scores a missing
              complaints value as a neutral 3, so nobody is penalized. When the source lands, it plugs in here and the
              calls-per-10k column goes live.
            </p>
          </div>
        </div>

        <ConfigPanel rows={config} />
        <LaborPadPanel stores={stores} search={padSearch} onSearch={setPadSearch}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ranking-admin"] })} />
      </div>

      <AddConfigModal open={addOpen} onClose={() => setAddOpen(false)} existingKeys={[...new Set(config.map((c) => c.key))]}
        onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["ranking-admin"] }); toast.push("Config change added.", "success"); }} />
    </>
  );
}

// ── Food-cost miss target efficiency ─────────────────────────────────
function FcTargetEditor({ current, onSaved }: { current: number; onSaved: () => void }) {
  const toast = useToast();
  const [pct, setPct] = useState<string>((current * 100).toFixed(1));
  const [busy, setBusy] = useState(false);

  async function save() {
    const eff = Number(pct) / 100;
    if (!isFinite(eff) || eff < 0.5 || eff > 1.5) {
      toast.push("Enter a percent between 50 and 150.", "error");
      return;
    }
    setBusy(true);
    try {
      await setFcTargetEfficiency(eff);
      toast.push(`Food-cost miss target set to ${Number(pct).toFixed(1)}% — hit Run now to apply.`, "success");
      onSaved();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't save.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">Food-cost miss target</div>
          <p className="text-xs text-zinc-500">
            FC $ Miss = dollars run <b>below this efficiency</b> — actual food cost minus what it would have been at
            the target. At or above the target the miss is $0. Default <b>96%</b>. Absolute; savings never offset
            losses. Changing it applies to the next run (past runs keep the target they used).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={50} max={150} step="0.1" value={pct} onChange={(e) => setPct(e.target.value)}
            className={cn(inputCls, "w-24 text-right")} />
          <span className="text-sm text-zinc-400">%</span>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Inventory Expressway upload ───────────────────────────────────────
function IxUploadPanel() {
  const toast = useToast();
  const [scope, setScope] = useState<"ptd" | "wtd" | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const content = await f.text();
      const detected: "ptd" | "wtd" =
        scope !== "auto" ? scope : /week[_ ]?to[_ ]?date|wtd|cycle/i.test(f.name) ? "wtd" : "ptd";
      const r = await ingestIxFile({ filename: f.name, content, scope: detected });
      setSummary(
        `${detected.toUpperCase()} · week ending ${r.week_ending ?? "?"} · ${r.stores} stores` +
        (r.flash ? ` · ${r.flash} flash row(s)` : "") +
        (r.unresolved.length ? ` · unresolved: ${r.unresolved.join(", ")}` : ""),
      );
      toast.push("IX file ingested — hit Run now on the Ranking tab to apply.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">Inventory Expressway — food cost</div>
          <p className="text-xs text-zinc-500">
            Upload the IX category export (CSV). Store efficiency, $ miss, DOH and the file's own
            DO/SDO/RVP/company rollups feed the next run. Duplicate files are rejected by content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <div className="flex items-center gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as "ptd" | "wtd" | "auto")}
            className={cn(inputCls)}>
            <option value="auto">Detect from filename</option>
            <option value="ptd">Period to date</option>
            <option value="wtd">Week to date</option>
          </select>
          <label className={cn(
            "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
            busy && "pointer-events-none opacity-50",
          )}>
            {busy ? "Ingesting…" : "Upload CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
        </div>
      </div>
    </div>
  );
}

// ── TotZone training upload (xlsx, parsed in the browser) ────────────
function TotzoneUploadPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const shaBytes = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = [...new Uint8Array(shaBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const XLSX = await import("xlsx"); // lazy — keeps the main bundle lean
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.find((n) => /station\s*completion/i.test(n));
      if (!sheetName) throw new Error('No "Station Completion Percentage" sheet in this file.');
      const grid = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(wb.Sheets[sheetName], { header: 1, raw: true });

      // Header row = the one starting with "Store #"; the as-of date sits above it.
      const hIdx = grid.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase().startsWith("store #"));
      if (hIdx < 0) throw new Error('Couldn\'t find the "Store #" header row.');
      let asOf: string | null = null;
      for (let i = 0; i < hIdx; i++) {
        for (const cell of grid[i] ?? []) {
          if (cell instanceof Date && !isNaN(cell.getTime())) { asOf = cell.toISOString().slice(0, 10); break; }
        }
        if (asOf) break;
      }
      const headers = (grid[hIdx] ?? []).map((h) => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase());
      const colOf = (frag: string) => headers.findIndex((h) => h.includes(frag));
      const cols = {
        store: 0,
        name: colOf("store name"),
        doName: colOf("do name"),
        sdoName: colOf("sdo name"),
        crew: colOf("annual & station"),
        mgr: colOf("total manager"),
        total: colOf("total crew"),
      };
      if (cols.total < 0) throw new Error('Couldn\'t find the "Total Crew and Manager Completion" column.');

      const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
      const rows = grid.slice(hIdx + 1)
        .map((r) => ({
          store_code: String(r?.[cols.store] ?? "").replace(/\D/g, ""),
          store_name: cols.name >= 0 ? String(r?.[cols.name] ?? "").trim() : null,
          do_name: cols.doName >= 0 ? String(r?.[cols.doName] ?? "").trim() : null,
          sdo_name: cols.sdoName >= 0 ? String(r?.[cols.sdoName] ?? "").trim() : null,
          crew_pct: cols.crew >= 0 ? num(r?.[cols.crew]) : null,
          manager_pct: cols.mgr >= 0 ? num(r?.[cols.mgr]) : null,
          total_training_pct: num(r?.[cols.total]),
        }))
        .filter((r) => /^\d+$/.test(r.store_code) && r.total_training_pct != null);
      if (!rows.length) throw new Error("No store rows with a total completion % found.");

      const res = await ingestTotzoneRows({ filename: f.name, sha256, as_of: asOf, rows });
      setSummary(
        `as of ${res.as_of ?? "?"} · ${res.stores} stores` +
        (res.unresolved.length ? ` · unresolved: ${res.unresolved.join(", ")}` : ""),
      );
      toast.push("TotZone ingested — hit Run now on the Ranking tab to apply.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">TotZone — Total Training</div>
          <p className="text-xs text-zinc-500">
            Upload the "TotZone Training Status — Team Members" xlsx. The Station Completion sheet feeds each
            store's Total Crew &amp; Manager completion % (scored 1–5, informational — never counts toward Total
            Points). Duplicate files are rejected by content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <label className={cn(
          "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
          busy && "pointer-events-none opacity-50",
        )}>
          {busy ? "Ingesting…" : "Upload XLSX"}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}

// ── EcoSure upload (Ecolab "List of Assessments" xlsx) ────────────────
function EcosureUploadPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const shaBytes = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = [...new Uint8Array(shaBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const XLSX = await import("xlsx");
      // NO cellDates here: this export's number formats are scrambled (the
      // score/finding columns carry date formats), so dates are decoded from
      // the raw Excel serial in the Global Date column instead.
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: true });
      const headers = (grid[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
      const colOf = (frag: string) => headers.findIndex((h) => h.includes(frag));
      const cols = {
        store: colOf("restaurant number"),
        name: colOf("restaurant name"),
        type: colOf("assessment type"),
        date: colOf("date"),
        score: colOf("score"),
        rating: colOf("rating"),
      };
      if (cols.store < 0 || cols.score < 0) {
        throw new Error('Doesn\'t look like the "List of Assessments" export — missing Restaurant Number / Score columns.');
      }
      const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : null);
      const isoDate = (v: unknown) => {
        // Excel serial (sanity-bounded to ~1954-2064) or a parseable string.
        if (typeof v === "number" && isFinite(v) && v > 20000 && v < 60000) {
          return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
        }
        const s = String(v ?? "");
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
      };
      const rows = grid.slice(1)
        .map((r) => ({
          store_code: String(r?.[cols.store] ?? "").replace(/\D/g, ""),
          store_name: cols.name >= 0 ? String(r?.[cols.name] ?? "").trim() : null,
          assessment_type: cols.type >= 0 ? String(r?.[cols.type] ?? "").trim() : null,
          date: cols.date >= 0 ? isoDate(r?.[cols.date]) : null,
          score: num(r?.[cols.score]),
          rating: cols.rating >= 0 ? String(r?.[cols.rating] ?? "").trim() : null,
        }))
        .filter((r) => /^\d+$/.test(r.store_code) && r.score != null); // drops the "Applied filters" footer
      if (!rows.length) throw new Error("No assessment rows with a store # and score found.");
      const asOf = rows.map((r) => r.date).filter(Boolean).sort().pop() ?? null;

      const res = await ingestEcosureRows({ filename: f.name, sha256, as_of: asOf, rows });
      setSummary(
        `${res.rows} assessments · ${res.stores} stores · YTD through ${res.as_of ?? "?"}` +
        (res.unresolved.length ? ` · unresolved: ${res.unresolved.join(", ")}` : ""),
      );
      toast.push("EcoSure ingested — hit Run now on the Ranking tab to apply.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">EcoSure — Food Safety</div>
          <p className="text-xs text-zinc-500">
            Upload the Ecolab TrueView "List of Assessments" xlsx. Each store scores on its YTD assessment
            average; stores without an audit show "No Audit" and take a neutral 3. Duplicates rejected by
            content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <label className={cn(
          "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
          busy && "pointer-events-none opacity-50",
        )}>
          {busy ? "Ingesting…" : "Upload XLSX"}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}

// ── BSC Training upload (the LTO training % — column G of the BSC sheet) ─
function BscUploadPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const shaBytes = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = [...new Uint8Array(shaBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets.BSC ?? wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, raw: true });
      const hIdx = grid.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase().startsWith("store #"));
      if (hIdx < 0) throw new Error('Couldn\'t find the "Store #" header row on the BSC sheet.');
      // As-of date from the title block (Excel serial).
      let asOf: string | null = null;
      for (let i = 0; i < hIdx && !asOf; i++) {
        for (const c of grid[i] ?? []) {
          if (typeof c === "number" && c > 20000 && c < 60000) {
            asOf = new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10);
            break;
          }
        }
      }
      // BSC score = column G (index 6), the LTO Training Module % Heath pointed to.
      const G = 6;
      const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
      const rows = grid.slice(hIdx + 1)
        .map((r) => ({
          store_code: String(r?.[0] ?? "").replace(/\D/g, ""),
          store_name: String(r?.[1] ?? "").trim() || null,
          do_name: String(r?.[2] ?? "").trim() || null,
          sdo_name: String(r?.[3] ?? "").trim() || null,
          bsc_pct: num(r?.[G]),
        }))
        .filter((r) => /^\d+$/.test(r.store_code) && r.bsc_pct != null); // drops the footer blocks
      if (!rows.length) throw new Error("No store rows with a BSC % in column G found.");

      const res = await ingestBscRows({ filename: f.name, sha256, as_of: asOf, rows });
      setSummary(
        `as of ${res.as_of ?? "?"} · ${res.stores} stores` +
        (res.unresolved.length ? ` · unresolved: ${res.unresolved.join(", ")}` : ""),
      );
      toast.push("BSC ingested — hit Run now on the Ranking tab to apply.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">BSC — LTO Training</div>
          <p className="text-xs text-zinc-500">
            Upload the "BSC Training" xlsx. Each store's LTO Training Module completion % (column G of the BSC
            sheet) scores 1–5 in Operations. Duplicates rejected by content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <label className={cn(
          "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
          busy && "pointer-events-none opacity-50",
        )}>
          {busy ? "Ingesting…" : "Upload XLSX"}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}

// ── Mystery Shops upload (KnowledgeForce DataDump CSV) ───────────────
function ShopsUploadPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const shaBytes = await crypto.subtle.digest("SHA-256", buf);
      const sha256 = [...new Uint8Array(shaBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(buf), { type: "array", raw: true });
      const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
      const hIdx = grid.findIndex((r) => String(r?.[2] ?? "").toLowerCase().includes("visit date"));
      if (hIdx < 0) throw new Error('Couldn\'t find the "Visit Date" header — is this the Mystery Shops DataDump?');
      // Site ID at col 4 (#001242 → 1242), Visit Date at col 2 (M/D/YY or MM/DD/YYYY), Score at col 12 (percent).
      const code = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
      const parseDate = (v: unknown) => {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(v ?? "").trim());
        if (!m) return null;
        const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      };
      const parseScore = (v: unknown) => {
        const n = parseFloat(String(v ?? "").replace("%", ""));
        return isFinite(n) ? n / 100 : null;
      };
      const rows = grid.slice(hIdx + 1)
        .filter((r) => r && r[4])
        .map((r) => ({
          store_code: code(r[4]),
          store_name: String(r[5] ?? "").trim() || null,
          visit_date: parseDate(r[2]),
          score: parseScore(r[12]),
        }))
        .filter((r) => /^\d+$/.test(r.store_code) && r.visit_date && r.score != null);
      if (!rows.length) throw new Error("No shop rows with a store #, visit date and score found.");

      const res = await ingestShopRows({ filename: f.name, sha256, rows });
      setSummary(
        `${res.rows} shops · ${res.stores} stores · latest visit ${res.as_of ?? "?"}` +
        (res.unresolved.length ? ` · unresolved: ${res.unresolved.join(", ")}` : ""),
      );
      toast.push("Mystery Shops ingested — the run keeps only shops within its period.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">Mystery Shops</div>
          <p className="text-xs text-zinc-500">
            Upload the KnowledgeForce "DataDump" CSV. Each shop keeps its visit date; the run counts and averages
            only shops that <strong>fell within its fiscal period</strong> — the rest are ignored. Informational
            (not scored into Total Points). Duplicates rejected by content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <label className={cn(
          "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
          busy && "pointer-events-none opacity-50",
        )}>
          {busy ? "Ingesting…" : "Upload CSV"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}

// ── VOG upload (Qualtrics dashboard export CSV) — scoped wtd/ptd ──────
function VogUploadPanel() {
  const toast = useToast();
  const [scope, setScope] = useState<"ptd" | "wtd" | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setSummary(null);
    try {
      const text = await f.text();
      const shaBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const sha256 = [...new Uint8Array(shaBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const ci = (name: string) => header.indexOf(name);
      const cStore = ci("storeid"), cCount = ci("count"), cL2r = ci("l2r"), cOsat = ci("osat");
      if (cStore < 0 || cL2r < 0) throw new Error('Not a VOG export — missing StoreID / L2R columns.');
      const num = (v: string) => { const n = Number(v); return isFinite(n) ? n : null; };
      const rows = lines.slice(1)
        .map((l) => l.split(","))
        .filter((r) => /^\d+$/.test(String(r[cStore] ?? "").trim())) // drops the "Average" footer
        .map((r) => ({
          store_code: String(r[cStore]).trim(),
          l2r: num(r[cL2r]),
          count: cCount >= 0 ? num(r[cCount]) : null,
          osat: cOsat >= 0 ? num(r[cOsat]) : null,
        }))
        .filter((r) => r.l2r != null);
      if (!rows.length) throw new Error("No store rows with L2R found.");

      const detected: "ptd" | "wtd" =
        scope !== "auto" ? scope : /wtd|week/i.test(f.name) ? "wtd" : /mtd|ptd|month|period/i.test(f.name) ? "ptd" : "wtd";
      const res = await ingestVogRows({ filename: f.name, sha256, scope: detected, rows });
      setSummary(
        `${detected.toUpperCase()} · ${res.stores} stores` +
        (res.unresolved.length ? ` · unresolved: ${res.unresolved.join(", ")}` : ""),
      );
      toast.push("VOG ingested — hit Run now on the Ranking tab to apply.", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Ingest failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">VOG — Voice of Guest</div>
          <p className="text-xs text-zinc-500">
            Upload the Qualtrics dashboard export CSV. Each store scores on L2R (likely-to-return top-box);
            Count feeds the response weighting. Comes in WTD and MTD (period) — upload both. Duplicates rejected
            by content hash.
          </p>
          {summary && <p className="mt-1 font-mono text-xs text-zinc-600">{summary}</p>}
        </div>
        <div className="flex items-center gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as "ptd" | "wtd" | "auto")} className={cn(inputCls)}>
            <option value="auto">Detect from filename</option>
            <option value="wtd">Week to date</option>
            <option value="ptd">Period (MTD)</option>
          </select>
          <label className={cn(
            "cursor-pointer rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800",
            busy && "pointer-events-none opacity-50",
          )}>
            {busy ? "Ingesting…" : "Upload CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Data backfill — recover 0238 fields from stored KPI snapshots ─────
function BackfillPanel() {
  const toast = useToast();
  const [days, setDays] = useState("35");
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runBackfill() {
    setRunning(true);
    setProgress("Starting…");
    let filled = 0, already = 0, failed = 0;
    try {
      // The server works within a time budget; keep calling while it reports
      // unprocessed dates.
      for (let round = 0; round < 20; round++) {
        const r = await backfillRankingFields(Number(days) || 35);
        filled += r.filled; already += r.already; failed += r.failed.length;
        setProgress(`${filled} day(s) backfilled · ${already} already had data · ${failed} not recoverable${r.remaining.length ? ` · ${r.remaining.length} to go…` : ""}`);
        if (!r.remaining.length) break;
      }
      toast.push("Backfill finished.", "success");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Backfill failed.", "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-midnight">Data backfill — tickets · on-time · voids</div>
          <p className="text-xs text-zinc-500">
            The stored KPI snapshots carried these fields all along; capture only started landing them with
            migration 0238. This re-extracts past days into Labor v2 so the ranking (and trends) have history.
            Safe to re-run — days that already have data are skipped.
          </p>
          {progress && <p className="mt-1 font-mono text-xs text-zinc-600">{progress}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={120} value={days} onChange={(e) => setDays(e.target.value)}
            className={cn(inputCls, "w-20 text-right")} />
          <span className="text-xs text-zinc-400">days</span>
          <Button size="sm" onClick={runBackfill} disabled={running}>
            {running ? "Backfilling…" : "Backfill"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Config (versioned, append-only) ───────────────────────────────────
function ConfigPanel({ rows }: { rows: RankingConfigRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const m = new Map<string, RankingConfigRow[]>();
    for (const r of rows) {
      if (!m.has(r.key)) m.set(r.key, []);
      m.get(r.key)!.push(r); // already ordered effective_from desc
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Ranking config · {grouped.length} keys ({rows.length} versions)
      </div>
      {grouped.length === 0 && (
        <p className="p-4 text-sm text-zinc-500">No config rows yet — run migrations 0237 + 0239, then refresh.</p>
      )}
      <div className="divide-y divide-zinc-100">
        {grouped.map(([key, versions]) => {
          const cur = versions[0];
          const isOpen = !!open[key];
          return (
            <div key={key}>
              <button onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50">
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />}
                <span className="w-56 shrink-0 truncate font-mono text-sm font-semibold text-midnight">{key}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500">{JSON.stringify(cur.value)}</span>
                <span className="shrink-0 text-xs text-zinc-400">
                  since {fmtDate(cur.effective_from)}{versions.length > 1 ? ` · ${versions.length} versions` : ""}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-2 bg-zinc-50/60 px-11 py-3">
                  {versions.map((v) => (
                    <div key={v.id} className="rounded-lg bg-white p-2.5 ring-1 ring-zinc-200">
                      <div className="text-[11px] font-semibold text-zinc-500">
                        effective {fmtDate(v.effective_from)}{v.note ? ` — ${v.note}` : ""}
                      </div>
                      <pre className="mt-1 overflow-x-auto font-mono text-xs text-zinc-700">{JSON.stringify(v.value)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddConfigModal({ open, onClose, existingKeys, onSaved }: {
  open: boolean; onClose: () => void; existingKeys: string[]; onSaved: () => void;
}) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [valueText, setValueText] = useState("");
  const [effective, setEffective] = useState(todayIso());
  const [note, setNote] = useState("");

  const parsed = useMemo(() => {
    if (!valueText.trim()) return { ok: false as const, err: "Value is required." };
    try { return { ok: true as const, value: JSON.parse(valueText) }; }
    catch { return { ok: false as const, err: "Not valid JSON — e.g. {\"amount\": 12.84} or [[0,1],[0.7,2]]" }; }
  }, [valueText]);

  const save = useMutation({
    mutationFn: () => addRankingConfig({ key: key.trim(), value: parsed.ok ? parsed.value : null, effective_from: effective, note: note.trim() || undefined }),
    onSuccess: () => { setKey(""); setValueText(""); setNote(""); onSaved(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add config change (append-only)"
      footer={
        <Button size="sm" onClick={() => save.mutate()} disabled={!key.trim() || !parsed.ok || save.isPending}>
          {save.isPending ? "Saving…" : "Add version"}
        </Button>
      }>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Existing rows are never edited — a new version takes effect from its date forward. Past runs keep the slice
          they were computed with.
        </p>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">Key</label>
          <input list="ranking-config-keys" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="bands.on_time / avg_wage / …" className={cn(inputCls, "w-full font-mono")} />
          <datalist id="ranking-config-keys">
            {existingKeys.map((k) => <option key={k} value={k} />)}
          </datalist>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">Value (JSON)</label>
          <textarea value={valueText} onChange={(e) => setValueText(e.target.value)} rows={4}
            placeholder='[[0,1],[0.7,2],[0.75,3],[0.8,4],[0.9,5]]'
            className={cn(inputCls, "w-full font-mono text-xs")} />
          {!parsed.ok && valueText.trim() && <p className="mt-1 text-xs text-red-600">{parsed.err}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Effective from</label>
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={cn(inputCls, "w-full")} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="why this change" className={cn(inputCls, "w-full")} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Labor pad (per store, held for the future) ────────────────────────
function LaborPadPanel({ stores, search, onSearch, onSaved }: {
  stores: RankingStoreRow[]; search: string; onSearch: (s: string) => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const padded = stores.filter((s) => s.labor_pad != null).length;

  const save = useMutation({
    mutationFn: ({ storeId, pad }: { storeId: string; pad: number | null }) => setLaborPad(storeId, pad),
    onSuccess: (_r, vars) => {
      setDrafts((d) => { const c = { ...d }; delete c[vars.storeId]; return c; });
      onSaved();
      toast.push("Labor pad saved.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? stores.filter((s) => s.number.includes(needle) || s.name.toLowerCase().includes(needle) || (s.entity ?? "").toLowerCase().includes(needle))
    : stores.filter((s) => s.labor_pad != null || Object.prototype.hasOwnProperty.call(drafts, s.store_id));

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Labor pad · {padded} store{padded === 1 ? "" : "s"} padded</span>
          <p className="text-xs text-zinc-400">
            $/period added to a store's labor target. Held for the future — today's goal is the IX target and pads are
            not applied to runs (DEVIATIONS B1). Search a store to set one.
          </p>
        </div>
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search store # / name / entity…"
          className={cn(inputCls, "w-64")} />
      </div>
      {shown.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500">
          {needle ? "No stores match." : "No pads set. Search for a store to add one."}
        </p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {shown.slice(0, 40).map((s) => {
            const draft = drafts[s.store_id];
            const current = s.labor_pad == null ? "" : String(s.labor_pad);
            const val = draft ?? current;
            const dirty = draft !== undefined && draft !== current;
            return (
              <div key={s.store_id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-midnight">#{s.number} · {s.name}</span>
                  {s.entity && <span className="ml-2 text-xs text-zinc-400">{s.entity}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-400">$</span>
                  <input type="number" min={0} step="0.01" value={val} placeholder="none"
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.store_id]: e.target.value }))}
                    className={cn(inputCls, "w-28 text-right")} />
                  <span className="text-xs text-zinc-400">/period</span>
                </div>
                <Button size="sm" variant="secondary" disabled={!dirty || save.isPending}
                  onClick={() => save.mutate({ storeId: s.store_id, pad: val.trim() === "" ? null : Number(val) })}>
                  <Save className="mr-1 h-3.5 w-3.5" /> Save
                </Button>
              </div>
            );
          })}
          {shown.length > 40 && <p className="px-4 py-2 text-xs text-zinc-400">Showing first 40 — narrow the search.</p>}
        </div>
      )}
    </div>
  );
}
