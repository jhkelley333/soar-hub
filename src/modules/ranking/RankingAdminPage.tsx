// /admin/ranking — the Ranking module home (admin only, build phase).
// Two views: the live ranking (mockup made real — run bar, source board,
// score-chip table, action report) and System settings (versioned config,
// labor pad, complaints hold).

import { useMemo, useState } from "react";
import { Segmented } from "@/shared/ui/Segmented";
import { RankingResultsView } from "./RankingResultsView";
import { RankingTrendsView } from "./RankingTrendsView";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, PauseCircle, Plus, Save } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  addRankingConfig, backfillRankingFields, fetchRankingOverview, ingestIxFile, setLaborPad,
  type RankingConfigRow, type RankingStoreRow,
} from "./api";

const inputCls =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";
const fmtDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");

type AdminView = "ranking" | "trends" | "settings";

export function RankingAdminPage() {
  const [view, setView] = useState<AdminView>("ranking");
  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Ranking
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Build</span>
          </span>
        }
        description="Admin-only while the module is in build — leaders keep the sheet-fed Ranker until cutover."
      />
      <div className="mb-4">
        <Segmented<AdminView>
          value={view}
          onChange={setView}
          options={[
            { value: "ranking", label: "Ranking" },
            { value: "trends", label: "Trends" },
            { value: "settings", label: "System settings" },
          ]}
        />
      </div>
      {view === "ranking" ? <RankingResultsView /> : view === "trends" ? <RankingTrendsView /> : <SettingsView />}
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

        <IxUploadPanel />

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
        scope !== "auto" ? scope : /week[_ ]?to[_ ]?date|wtd/i.test(f.name) ? "wtd" : "ptd";
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
