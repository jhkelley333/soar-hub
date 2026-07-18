// Public labor sheet — /labor/:token, no login. The token in the URL is the
// credential (same pattern as the shared Territory Map). Resolves to a live
// read-only drill-down: Company → RVP → SDO → DO → Store, with Yesterday / PTD /
// YTD labor %, Act vs Schedule (Yesterday + PTD), and a this-week-vs-last-week
// trend. An RVP's link is scoped to their region; the company link shows all.

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, TrendingDown, TrendingUp, Minus, Download, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchSharedLabor, fetchSharedLaborStore, submitSharedLaborReview, type HoursTrend, type ShareBand, type ShareNode, type SharedLaborResponse, type StoreDay } from "./api";
import { downloadSharedLaborFile } from "./sharedLaborWorkbook";

// Same fixed miss-reason list the GM picks from in the hub.
const ROOT_CAUSE_LABEL: Record<string, string> = {
  poor_projections: "Poor Projections",
  scheduled_above_chart: "Scheduled Above Chart",
  didnt_follow_schedule: "Didn't Follow the Schedule",
  auto_clock: "Auto Clock",
  other: "Other",
};

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtVar = (v: number | null) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`);
const fmtAvs = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}h`);
const fmtOverUsd = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const fmtHrsOver = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
const fmtUsd0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

// Applied labor credits (period-to-date) — No GM / PTO / Training. These are
// already baked into the labor %, $ over and hrs over above; this line just
// makes the adjustment visible, like the hub does.
function CreditsLine({ credits, light }: { credits: ShareNode["credits"]; light?: boolean }) {
  const parts: string[] = [];
  if (credits.no_gm) parts.push(`No GM ${fmtUsd0(credits.no_gm)}`);
  if (credits.pto) parts.push(`PTO ${fmtUsd0(credits.pto)}`);
  if (credits.training) parts.push(`Training ${fmtUsd0(credits.training)}`);
  if (!parts.length) return null;
  return (
    <div className={cn("text-[10px] tabular-nums", light ? "text-white/70" : "text-zinc-500")}>
      <span className={cn("font-semibold uppercase tracking-wide", light ? "text-white/50" : "text-zinc-400")}>Credits · PTD</span>{" "}
      {parts.join(" · ")}
    </div>
  );
}
const hasCredits = (c: ShareNode["credits"]) => !!(c.no_gm || c.pto || c.training);
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";

// Over chart (labor above target) is bad → red; on/under is good → emerald.

const CHAIN = ["region", "area", "district", "store"] as const;
type Chain = (typeof CHAIN)[number];
type PathItem = { level: Chain; name: string };
const LEVEL_LABEL: Record<Chain, string> = { region: "RVP · Region", area: "SDO · Market", district: "DO · District", store: "Store" };
const childOf = (l: Chain): Chain | null => CHAIN[CHAIN.indexOf(l) + 1] ?? null;

// Narrow the dataset to whatever the viewer has drilled into, so the Labor File
// covers exactly the on-screen scope: the whole link at the top, or just one
// RVP's region / SDO's market / DO's district after drilling.
function buildScopedDownload(data: SharedLaborResponse, path: PathItem[]): { data: SharedLaborResponse; label: string } {
  const matches = (n: ShareNode) => path.every((c) => (n as unknown as Record<string, unknown>)[c.level] === c.name);
  const parentLevel = path.length ? path[path.length - 1].level : null;
  const parent: ShareNode | null = !path.length
    ? data.company
    : (data.levels[parentLevel as Chain].find(matches) ?? data.company);
  const levels: SharedLaborResponse["levels"] = { region: [], area: [], district: [], store: [] };
  for (const lvl of CHAIN) levels[lvl] = (data.levels[lvl] || []).filter(matches);
  if (parentLevel) levels[parentLevel] = []; // the drilled node is the total row — don't repeat it as a section
  const label = parent?.name || (data.scope.kind === "region" ? data.scope.region ?? "Region" : "Company");
  return { data: { ...data, company: parent, levels }, label };
}

export function SharedLaborPage() {
  const { token = "" } = useParams();
  const [dl, setDl] = useState(false);
  const [path, setPath] = useState<PathItem[]>([]);
  const q = useQuery({
    queryKey: ["shared-labor", token],
    queryFn: () => fetchSharedLabor(token),
    enabled: !!token,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  async function download() {
    if (!q.data) return;
    setDl(true);
    try {
      const { data: scoped, label } = buildScopedDownload(q.data, path);
      await downloadSharedLaborFile(scoped, label);
    } finally { setDl(false); }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">SOAR Hub</div>
            <h1 className="text-2xl font-bold tracking-tight text-midnight">Labor</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {q.data
                ? `${q.data.label ? `${q.data.label} · ` : ""}Business day ${fmtDate(q.data.date)} · read-only`
                : "Read-only shared labor view."}
            </p>
          </div>
          {q.data && (
            <button
              type="button"
              onClick={download}
              disabled={dl}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-midnight px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              {dl ? "Building…" : "Labor File"}
            </button>
          )}
        </div>

        {q.isLoading && <div className="py-16 text-center text-sm text-zinc-500">Loading labor…</div>}
        {q.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center">
            <div className="text-sm font-semibold text-red-700">
              {(q.error as Error)?.message ?? "This labor link is no longer active."}
            </div>
            <p className="mt-1 text-xs text-red-600">Ask whoever sent it for a fresh link.</p>
          </div>
        )}
        {q.data && <SharedLaborExplorer data={q.data} path={path} setPath={setPath} token={token} />}
      </div>
    </div>
  );
}

function SharedLaborExplorer({ data, path, setPath, token }: {
  data: SharedLaborResponse;
  path: PathItem[];
  setPath: Dispatch<SetStateAction<PathItem[]>>;
  token: string;
}) {
  const [dayStore, setDayStore] = useState<string | null>(null);
  const startLevel: Chain = data.scope.kind === "region" ? "area" : "region";
  const displayLevel: Chain = path.length ? (childOf(path[path.length - 1].level) ?? "store") : startLevel;

  const matchesPath = (n: ShareNode) =>
    path.every((c) => (n as unknown as Record<string, unknown>)[c.level] === c.name);

  const rows = useMemo(() => {
    const src = data.levels[displayLevel] ?? [];
    return src
      .filter(matchesPath)
      .slice()
      .sort((a, b) => (b.ptd.variance_pts ?? -Infinity) - (a.ptd.variance_pts ?? -Infinity));
  }, [data, displayLevel, path]);

  // The node you've drilled INTO — its metrics stay pinned above the children
  // as you go deeper (company at the root, then the RVP / SDO / DO you opened).
  const parentNode = useMemo<ShareNode | null>(() => {
    if (!path.length) return data.company;
    const lvl = path[path.length - 1].level;
    return (data.levels[lvl] ?? []).find(matchesPath) ?? data.company;
  }, [data, path]);

  // Group rows drill deeper; a store row opens its per-day popup.
  function onRow(n: ShareNode) {
    if (displayLevel === "store") { if (n.store_number) setDayStore(n.store_number); return; }
    setPath((p) => [...p, { level: displayLevel, name: n.name }]);
  }

  return (
    <div className="space-y-4">
      {/* Scope / drilled-into summary — stays visible as you go deeper */}
      {parentNode && <SummaryCard node={parentNode} />}

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button onClick={() => setPath([])} className={cn(path.length ? "font-medium text-accent hover:underline" : "font-semibold text-midnight")}>
          {data.scope.kind === "region" ? data.scope.region ?? "Region" : "Company"}
        </button>
        {path.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
            <button onClick={() => setPath(path.slice(0, i + 1))} className={cn(i === path.length - 1 ? "font-semibold text-midnight" : "text-accent hover:underline")}>
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{LEVEL_LABEL[displayLevel]}</div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-sm text-zinc-500 ring-1 ring-zinc-200">Nothing to show here.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <NodeCard key={n.store_number ?? n.name} node={n} showChevron={displayLevel !== "store"} onClick={() => onRow(n)} />
          ))}
        </div>
      )}

      {dayStore && <StoreDayModal token={token} store={dayStore} onClose={() => setDayStore(null)} />}

      <div className="mt-4 space-y-2 rounded-xl bg-white p-4 text-[11px] leading-relaxed text-zinc-500 ring-1 ring-zinc-200">
        <p><span className="font-semibold text-zinc-600">Labor %</span> vs target · <span className="font-semibold text-zinc-600">AvS</span> = actual − scheduled hours · <span className="font-semibold text-zinc-600">$ / Hrs Over</span> = over the labor chart (red = over, green = on/under).</p>
        <p>
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><TrendingDown className="h-3 w-3" strokeWidth={2.5} />Improving</span>{" "}
          means <b>hours over chart are down vs last week</b> — it compares this week through the latest day (Mon → yesterday) against last week through the <b>same weekday</b>, so it's apples-to-apples. Fewer hours over = <span className="text-emerald-700 font-semibold">Improving</span> (green), more = <span className="text-red-600 font-semibold">Worse</span> (red).
        </p>
        <p>The <b>$ Over</b> shown on a district/region rollup counts only stores that are <b>over</b> chart — a store beating its chart won't mask the overspend.</p>
        <p className="text-zinc-400">Labor is pulled each morning, so these numbers reflect the prior business day.</p>
      </div>
    </div>
  );
}

function SummaryCard({ node }: { node: ShareNode }) {
  return (
    <div className="rounded-xl bg-midnight p-4 text-white ring-1 ring-black/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{node.name}</div>
          <div className="truncate text-xs text-white/60">{node.leader ? `${node.leader} · ` : ""}{node.storeCount} stores</div>
        </div>
        <HoursFlag trend={node.hours_trend} light />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <BandBox label="Daily" b={node.daily} light withAvs />
        <BandBox label="WTD" b={node.wtd} light withAvs />
        <BandBox label="PTD" b={node.ptd} light withAvs />
      </div>
      {hasCredits(node.credits) && <div className="mt-2"><CreditsLine credits={node.credits} light /></div>}
    </div>
  );
}

// Week-over-week flag on hours over chart: are they improving? Fewer hours over
// than last week = improving (green ▼). Shows "—" until last week's close lands.
function HoursFlag({ trend, light }: { trend: HoursTrend; light?: boolean }) {
  const { delta, improving } = trend;
  if (delta == null) {
    return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", light ? "bg-white/10 text-white/50" : "bg-zinc-100 text-zinc-400")}>Hrs WoW —</span>;
  }
  const flat = Math.abs(delta) < 0.05;
  const Icon = flat ? Minus : improving ? TrendingDown : TrendingUp;
  const tone = flat
    ? (light ? "bg-white/10 text-white/70" : "bg-zinc-100 text-zinc-500")
    : improving
      ? (light ? "bg-emerald-400/20 text-emerald-200" : "bg-emerald-50 text-emerald-700")
      : (light ? "bg-red-400/20 text-red-200" : "bg-red-50 text-red-700");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", tone)} title="WTD hours over vs same point last week">
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? "Hrs flat vs LW" : `${improving ? "Improving" : "Worse"} ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}h`}
    </span>
  );
}

function NodeCard({ node, showChevron, onClick }: { node: ShareNode; showChevron: boolean; onClick: () => void }) {
  const over = (node.daily.variance_pts ?? 0) > 0;
  const title = node.store_number ? `#${node.store_number} ${node.store_name ?? ""}` : node.name;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("w-full overflow-hidden rounded-xl bg-white text-left ring-1 ring-zinc-200 active:bg-zinc-50", over && "ring-red-200")}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full", over ? "bg-red-500" : "bg-emerald-500")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-midnight">
            <span className="truncate">{title}</span>
            {showChevron && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {node.leader ? node.leader : "—"}{node.store_number ? "" : ` · ${node.storeCount} store${node.storeCount === 1 ? "" : "s"}`}
          </div>
          <div className="mt-1"><HoursFlag trend={node.hours_trend} /></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 p-2.5">
        <BandBox label="Daily" b={node.daily} withAvs />
        <BandBox label="WTD" b={node.wtd} withAvs />
        <BandBox label="PTD" b={node.ptd} withAvs />
      </div>
      {hasCredits(node.credits) && (
        <div className="border-t border-zinc-100 px-2.5 py-1.5"><CreditsLine credits={node.credits} /></div>
      )}
    </button>
  );
}

// Store popup — the current week's daily labor for one store, with the filed
// miss reason and an inline editor to add/update a reason + note. The public
// link has no login, so submissions are attributed to the typed name.
function StoreDayModal({ token, store, onClose }: { token: string; store: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["shared-labor-store", token, store],
    queryFn: () => fetchSharedLaborStore(token, store),
    staleTime: 60_000,
    retry: false,
  });
  const d = q.data;
  const [name, setName] = useState(() => { try { return localStorage.getItem("shared-labor-filed-by") || ""; } catch { return ""; } });

  const save = useMutation({
    mutationFn: (input: { date: string; root_cause: string | null; note: string }) =>
      submitSharedLaborReview(token, { store, ...input, filed_by: name.trim() }),
    onSuccess: () => {
      try { localStorage.setItem("shared-labor-filed-by", name.trim()); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["shared-labor-store", token, store] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full overflow-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-midnight">{d ? `#${d.store_number} ${d.store_name ?? ""}` : `#${store}`}</div>
            <div className="text-xs text-zinc-500">This week · daily labor · tap a day to add a reason</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>
        {q.isLoading ? (
          <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>
        ) : q.isError || !d ? (
          <div className="py-8 text-center text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load this store."}</div>
        ) : (
          <div className="space-y-2">
            {d.days.map((day) => (
              <DayRow key={day.date} day={day} name={name} setName={setName}
                onSave={(input) => save.mutateAsync(input)} saving={save.isPending} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DayRow({ day, name, setName, onSave, saving }: {
  day: StoreDay;
  name: string;
  setName: (v: string) => void;
  onSave: (input: { date: string; root_cause: string | null; note: string }) => Promise<{ ok: true }>;
  saving: boolean;
}) {
  const label = new Date(`${day.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(day.root_cause ?? "");
  const [note, setNote] = useState(day.note ?? "");
  const [err, setErr] = useState<string | null>(null);

  if (!day.polled) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-500">{label}</span><span>No polling</span>
      </div>
    );
  }
  const over = (day.variance_pts ?? 0) > 0;
  const oc = (v: number | null) => ((v ?? 0) > 0 ? "text-red-600" : "text-emerald-600");

  async function submit() {
    setErr(null);
    try { await onSave({ date: day.date, root_cause: reason || null, note: note.trim() }); setOpen(false); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }

  return (
    <div className={cn("rounded-lg px-3 py-2 ring-1", over ? "bg-red-50/40 ring-red-100" : "bg-zinc-50 ring-zinc-100")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-midnight">{label}</span>
        <span className={cn("text-sm font-bold tabular-nums", over ? "text-red-600" : "text-emerald-600")}>{fmtPct(day.labor_pct)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-zinc-500">
        <span>tgt {fmtPct(day.target_pct)} · {fmtVar(day.variance_pts)}</span>
        <span className={oc(day.dollars_over)}>$ over {fmtOverUsd(day.dollars_over)}</span>
        <span className={oc(day.hours_over)}>hrs over {fmtHrsOver(day.hours_over)}</span>
        <span className={oc(day.act_vs_sched)}>AvS {fmtAvs(day.act_vs_sched)}</span>
      </div>
      {(day.root_cause || day.note) && !open && (
        <div className="mt-1.5 rounded-md bg-white px-2 py-1.5 text-[11px] ring-1 ring-zinc-100">
          {day.root_cause && (
            <span className="mr-1.5 inline-block rounded-full bg-sonic-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sonic-700">
              {ROOT_CAUSE_LABEL[day.root_cause] ?? day.root_cause}
            </span>
          )}
          {day.note && <span className="text-zinc-600">{day.note}</span>}
        </div>
      )}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-1.5 text-[11px] font-semibold text-accent hover:underline">
          {day.root_cause || day.note ? "Edit reason" : "Add reason"}
        </button>
      ) : (
        <div className="mt-2 space-y-2 rounded-md bg-white p-2 ring-1 ring-zinc-200">
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs focus:border-accent focus:outline-none">
            <option value="">Reason (optional)…</option>
            {Object.entries(ROOT_CAUSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note…"
            className="w-full resize-y rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
            className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none" />
          {err && <div className="text-[11px] text-red-600">{err}</div>}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100">Cancel</button>
            <button type="button" onClick={submit} disabled={saving || !note.trim() || !name.trim()}
              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BandBox({ label, b, light, withAvs }: { label: string; b: ShareBand; light?: boolean; withAvs?: boolean }) {
  // Over chart = bad = red; on/under = good = green. Lighter tones on the dark
  // summary card so they stay legible.
  const overCls = (v: number | null) => ((v ?? 0) > 0
    ? (light ? "text-red-300" : "text-red-600")
    : (light ? "text-emerald-300" : "text-emerald-600"));
  const pctCls = (b.variance_pts ?? 0) > 0
    ? (light ? "text-red-300" : "text-red-600")
    : (light ? "text-emerald-300" : "text-emerald-600");
  return (
    <div className={cn("rounded-lg px-2 py-1.5", light ? "bg-white/10" : "bg-zinc-50")}>
      <div className={cn("text-[9px] font-semibold uppercase tracking-wide", light ? "text-white/50" : "text-zinc-400")}>{label}</div>
      <div className={cn("mt-0.5 text-base font-bold tabular-nums", pctCls)}>{fmtPct(b.labor_pct)}</div>
      <div className={cn("text-[10px] tabular-nums", light ? "text-white/60" : "text-zinc-400")}>
        tgt {fmtPct(b.target_pct)} · {fmtVar(b.variance_pts)}
      </div>
      <div className={cn("text-[10px] tabular-nums", overCls(b.dollars_over))}>$ over {fmtOverUsd(b.dollars_over)}</div>
      <div className={cn("text-[10px] tabular-nums", overCls(b.hours_over))}>hrs over {fmtHrsOver(b.hours_over)}</div>
      {withAvs && (
        <div className={cn("text-[10px] tabular-nums", overCls(b.act_vs_sched))}>AvS {fmtAvs(b.act_vs_sched)}</div>
      )}
    </div>
  );
}
