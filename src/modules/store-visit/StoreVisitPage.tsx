// Store Visit — mobile-first app for DO+. Phase 1: Today (computed Top-3 gaps +
// review requests + funds reminder), Walk (checklist Pass/Gap/N-A + notes),
// Summary (shared summary + leadership-only private note + submit), Actions,
// Store. Camera/photos, offline queue, and WO conversion land in Phase 2.
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, Minus, CheckCircle2, CircleSlash, AlertTriangle,
  ClipboardList, Home, Store as StoreIcon, ListChecks, Camera, Loader2, ChevronRight, Lock,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useToast } from "@/shared/ui/Toaster";
import {
  fetchVisitStores, fetchToday, fetchActions, fetchVisitHistory, startVisit, saveWalk, submitVisit, uploadVisitPhoto,
  createReview, createAction, updateAction,
  type ChecklistItem, type Gap, type PhotoRec, type StartVisitResponse, type WalkStatus,
} from "./api";
import { enqueue, listQueue, removeQueued, clearQueueFor, saveActive, loadActive, clearActive, putBlob, getBlob, delBlob } from "./visitStore";
import { WifiOff, RefreshCw, Clock } from "lucide-react";

type WalkResult = { status: WalkStatus; note: string; photos: PhotoRec[] };
type WalkSavePayload = { visit_id: string; item_id: string; category: string; label: string; status: WalkStatus; note: string; photos: PhotoRec[] };

const NAVY = "#0b3b66";
const OK = "#0e7a5a", WARN = "#9a5b00", DANGER = "#b8402f";

type Screen = "today" | "walk" | "summary" | "actions" | "store";
const PRIVATE_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

export function StoreVisitPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const role = String(profile?.role ?? "").toLowerCase();

  const [storeId, setStoreId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("today");
  const [visit, setVisit] = useState<StartVisitResponse | null>(null);
  const [results, setResults] = useState<Record<string, WalkResult>>({});
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(() => { listQueue().then((q) => setPending(q.length)); }, []);

  // Latest visit/results for the flusher (which is a stable callback).
  const visitRef = useRef(visit);
  const resultsRef = useRef(results);
  useEffect(() => { visitRef.current = visit; resultsRef.current = results; }, [visit, results]);

  // Replay queued walk-saves in order, then upload any photos captured offline
  // and re-save those items with real paths. Stop on the first failure.
  const flush = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const ops = await listQueue();
    for (const op of ops) {
      try { await saveWalk(op.payload as WalkSavePayload); if (op.id != null) await removeQueued(op.id); }
      catch { break; }
    }
    // Reconcile offline photo blobs: upload → replace pendingKey with a path.
    const v = visitRef.current;
    if (v) {
      const cur = resultsRef.current;
      const itemById = new Map(v.items.map((i) => [i.id, i]));
      const patched: Record<string, WalkResult> = {};
      let changed = false;
      for (const [itemId, r] of Object.entries(cur)) {
        if (!r.photos?.some((p) => p.pendingKey && !p.path)) continue;
        const next: PhotoRec[] = [];
        for (const p of r.photos) {
          if (p.pendingKey && !p.path) {
            try {
              const blob = await getBlob(p.pendingKey);
              if (blob) { const rec = await uploadVisitPhoto(v.visit_id, "walk", blob, "jpg"); await delBlob(p.pendingKey); next.push(rec); changed = true; }
              else next.push(p);
            } catch { next.push(p); }
          } else next.push(p);
        }
        patched[itemId] = { ...r, photos: next };
        const it = itemById.get(itemId);
        try { await saveWalk({ visit_id: v.visit_id, item_id: itemId, category: it?.category ?? "", label: it?.label ?? "", status: r.status, note: r.note, photos: next }); } catch { /* retry next flush */ }
      }
      if (changed) setResults((prev) => ({ ...prev, ...patched }));
    }
    refreshPending();
  }, [refreshPending]);

  // Online/offline wiring + initial flush + restore an in-progress visit.
  useEffect(() => {
    const on = () => { setOnline(true); flush(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    refreshPending();
    flush();
    loadActive<{ visit: StartVisitResponse; results: Record<string, WalkResult> }>().then(async (a) => {
      if (!a?.visit?.visit_id) return;
      const restored = a.results ?? {};
      // Regenerate previews for photos captured offline (their object URLs died with the old page).
      for (const r of Object.values(restored)) {
        for (const p of r.photos ?? []) {
          if (p.pendingKey && !p.path) { const b = await getBlob(p.pendingKey); if (b) p.previewUrl = URL.createObjectURL(b); }
        }
      }
      setVisit(a.visit); setResults(restored);
      flush();
    });
    const t = setInterval(flush, 20_000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, [flush, refreshPending]);

  // Persist the in-progress visit so a reload/kill mid-walk can resume it.
  useEffect(() => { if (visit) saveActive({ visit, results }); }, [visit, results]);

  const storesQ = useQuery({ queryKey: ["visit-stores"], queryFn: fetchVisitStores, staleTime: 5 * 60_000 });
  const stores = storesQ.data?.stores ?? [];
  useEffect(() => { if (!storeId && stores.length) setStoreId(stores[0].id); }, [stores, storeId]);

  const todayQ = useQuery({ queryKey: ["visit-today", storeId], queryFn: () => fetchToday(storeId!), enabled: !!storeId, staleTime: 60_000 });
  const actionsQ = useQuery({ queryKey: ["visit-actions", storeId], queryFn: () => fetchActions(storeId!), enabled: !!storeId && screen === "actions", staleTime: 60_000 });

  const start = useMutation({
    mutationFn: () => startVisit(storeId!),
    onSuccess: (r) => { setVisit(r); setResults({}); saveActive({ visit: r, results: {} }); setScreen("walk"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't start the visit.", "error"),
  });

  // Per-item patch + save. Offline (or a failed save) queues to IndexedDB and
  // flushes on reconnect, so a spotty-wifi walk never loses data.
  function patchResult(item: ChecklistItem, patch: Partial<WalkResult>) {
    setResults((prev) => {
      const cur: WalkResult = prev[item.id] ?? { status: "pass", note: "", photos: [] };
      const next: WalkResult = { ...cur, ...patch };
      if (visit) {
        const payload: WalkSavePayload = { visit_id: visit.visit_id, item_id: item.id, category: item.category, label: item.label, status: next.status, note: next.note, photos: next.photos };
        const target = `${visit.visit_id}:${item.id}`;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          enqueue({ target, payload }).then(refreshPending);
        } else {
          saveWalk(payload).catch(() => enqueue({ target, payload }).then(refreshPending));
        }
      }
      return { ...prev, [item.id]: next };
    });
  }

  const submit = useMutation({
    mutationFn: async (input: { summary: string; private_note: string; funds_reviewed: boolean; summary_photos: PhotoRec[] }) => {
      await flush(); // land any queued walk results before finalizing
      return submitVisit({ visit_id: visit!.visit_id, ...input });
    },
    onSuccess: async () => {
      toast.push("Visit submitted.", "success");
      if (visit) await clearQueueFor(visit.visit_id);
      await clearActive();
      setVisit(null); setResults({}); setScreen("today"); refreshPending();
      qc.invalidateQueries({ queryKey: ["visit-today", storeId] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Submit failed.", "error"),
  });
  function trySubmit(input: { summary: string; private_note: string; funds_reviewed: boolean; summary_photos: PhotoRec[] }) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.push("You're offline — reconnect to submit. Your walk is saved on this device.", "error");
      return;
    }
    submit.mutate(input);
  }

  const store = todayQ.data?.store ?? null;
  const canPrivate = PRIVATE_ROLES.has(role) || role === "do"; // DO+ authors write it; store never sees it

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col" style={{ fontFamily: "'Geist', system-ui, sans-serif" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pb-2 pt-3" style={{ background: NAVY }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md text-[11px] font-black text-white" style={{ background: "#d7282f" }}>S</span>
            <span className="text-sm font-bold text-white">Store Visit</span>
          </div>
          {todayQ.data?.last_visit_at && (
            <span className="text-[11px] text-white/60">last {new Date(todayQ.data.last_visit_at).toLocaleDateString()}</span>
          )}
        </div>
        <select
          value={storeId ?? ""}
          onChange={(e) => { setStoreId(e.target.value); setVisit(null); setScreen("today"); }}
          className="mt-2 w-full rounded-lg border-0 bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline-none"
        >
          {stores.map((s) => <option key={s.id} value={s.id} className="text-black">#{s.number} — {s.name}{s.city ? `, ${s.city}` : ""}</option>)}
        </select>
      </div>

      {/* Offline / sync banner */}
      {(!online || pending > 0) && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[12px] font-semibold text-white"
          style={{ background: !online ? WARN : NAVY }}>
          {!online ? <WifiOff className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          {!online
            ? <>Offline — changes save on this device{pending > 0 ? ` (${pending} pending)` : ""}. They’ll sync when you’re back.</>
            : <>Syncing {pending} change{pending === 1 ? "" : "s"}…</>}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[#f4f6f9] px-4 py-3 pb-24">
        {screen === "today" && <TodayScreen q={todayQ} onStart={() => start.mutate()} starting={start.isPending} hasVisit={!!visit} onResume={() => setScreen("walk")} />}
        {screen === "walk" && <WalkScreen visit={visit} results={results} patchResult={patchResult} onReview={() => setScreen("summary")} />}
        {screen === "summary" && <SummaryScreen visitId={visit?.visit_id ?? null} canPrivate={canPrivate} onBack={() => setScreen("walk")} onSubmit={trySubmit} submitting={submit.isPending} />}
        {screen === "actions" && <ActionsScreen storeId={storeId} actions={actionsQ.data?.actions ?? []} loading={actionsQ.isLoading} />}
        {screen === "store" && <StoreScreen store={store} storeId={storeId} canPush={PRIVATE_ROLES.has(role)} openActions={todayQ.data?.open_actions ?? 0} lastVisitAt={todayQ.data?.last_visit_at ?? null} />}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md items-stretch border-t border-zinc-200 bg-white">
        {([
          { id: "today", label: "Today", icon: Home },
          { id: "walk", label: "Walk", icon: ListChecks },
          { id: "actions", label: "Actions", icon: ClipboardList },
          { id: "store", label: "Store", icon: StoreIcon },
        ] as { id: Screen; label: string; icon: typeof Home }[]).map((t) => {
          const active = screen === t.id || (t.id === "walk" && screen === "summary");
          return (
            <button key={t.id} type="button" onClick={() => setScreen(t.id)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold"
              style={{ color: active ? NAVY : "#9aa3af", minHeight: 44 }}>
              <t.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────
function TodayScreen({ q, onStart, starting, hasVisit, onResume }: {
  q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchToday>>>>;
  onStart: () => void; starting: boolean; hasVisit: boolean; onResume: () => void;
}) {
  if (q.isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></Centered>;
  if (q.isError || !q.data) return <Centered><span className="text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load."}</span></Centered>;
  const d = q.data;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Store #{d.store.number}</div>
        <div className="text-lg font-bold" style={{ color: NAVY }}>{d.store.name}</div>
        <div className="text-sm text-zinc-500">{[d.store.city, d.store.state].filter(Boolean).join(", ")}</div>
      </div>

      {!d.funds_reviewed && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#fff4e5", color: WARN }}>
          <AlertTriangle className="h-4 w-4" /> Store Funds not yet reviewed this visit.
        </div>
      )}

      {d.reviews.length > 0 && (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">Review requests</div>
          <div className="space-y-1.5">
            {d.reviews.map((r) => (
              <div key={r.id} className="flex items-start gap-2 rounded-lg bg-[#eef4fb] px-3 py-2 text-sm">
                <span className="mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: NAVY }}>{r.by_role ?? "lead"}</span>
                <span className="text-zinc-700">{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-xs font-bold uppercase tracking-wide text-zinc-400">Top 3 gaps</span>
          <span className="text-[11px] text-zinc-400">vs. last visit</span>
        </div>
        {d.gaps.length === 0 ? (
          <div className="rounded-2xl bg-white p-4 text-center text-sm text-zinc-500 shadow-sm">No metrics under target — clean board.</div>
        ) : (
          <div className="space-y-2">{d.gaps.map((g) => <GapCard key={g.metric} g={g} />)}</div>
        )}
      </div>

      <button type="button" onClick={hasVisit ? onResume : onStart} disabled={starting}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-sm"
        style={{ background: NAVY, minHeight: 44 }}>
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
        {hasVisit ? "Resume store walk" : "Start store walk"}
      </button>
    </div>
  );
}

function GapCard({ g }: { g: Gap }) {
  const sevPct = Math.min(100, Math.round(g.severity * 100));
  const TrendIcon = g.dir === "up" ? ArrowUpRight : g.dir === "down" ? ArrowDownRight : Minus;
  const trendColor = g.dir === "up" ? OK : g.dir === "down" ? DANGER : "#9aa3af";
  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold" style={{ color: NAVY }}>{g.label}</span>
        <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: trendColor, fontFamily: "'Geist Mono', ui-monospace, monospace" }}>
          <TrendIcon className="h-3.5 w-3.5" />{g.delta ?? ""}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-black" style={{ color: DANGER, fontFamily: "'Geist Mono', ui-monospace, monospace" }}>{g.value}</span>
        <span className="text-xs text-zinc-400">target {g.target}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full" style={{ width: `${sevPct}%`, background: DANGER }} />
      </div>
    </div>
  );
}

// ── Walk ─────────────────────────────────────────────────────────────
function WalkScreen({ visit, results, patchResult, onReview }: {
  visit: StartVisitResponse | null;
  results: Record<string, WalkResult>;
  patchResult: (item: ChecklistItem, patch: Partial<WalkResult>) => void;
  onReview: () => void;
}) {
  if (!visit) return <Centered><span className="text-sm text-zinc-500">Start a walk from the Today tab.</span></Centered>;
  const catMap = new Map<string, ChecklistItem[]>();
  for (const it of visit.items) (catMap.get(it.category) || catMap.set(it.category, []).get(it.category))!.push(it);
  const cats = [...catMap.entries()];
  const done = Object.keys(results).length;
  const total = visit.items.length;

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between bg-[#f4f6f9] px-4 py-1.5">
        <span className="text-sm font-bold" style={{ color: NAVY }}>Store walk</span>
        <span className="text-xs font-semibold text-zinc-500" style={{ fontFamily: "'Geist Mono', monospace" }}>{done}/{total}</span>
      </div>
      {cats.map(([cat, items]) => (
        <div key={cat} className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">{cat}</div>
          <div className="space-y-2.5">
            {items.map((it) => {
              const r = results[it.id];
              return (
                <div key={it.id}>
                  <div className="text-sm text-zinc-800">{it.label}</div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(["pass", "gap", "na"] as WalkStatus[]).map((st) => {
                      const active = r?.status === st;
                      const meta = st === "pass" ? { c: OK, Icon: CheckCircle2, t: "Pass" } : st === "gap" ? { c: DANGER, Icon: AlertTriangle, t: "Gap" } : { c: "#6b7280", Icon: CircleSlash, t: "N/A" };
                      return (
                        <button key={st} type="button" onClick={() => patchResult(it, { status: st })}
                          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold"
                          style={{ minHeight: 44, background: active ? meta.c : "#f1f3f6", color: active ? "white" : "#6b7280" }}>
                          <meta.Icon className="h-3.5 w-3.5" />{meta.t}
                        </button>
                      );
                    })}
                  </div>
                  {r?.status === "gap" && (
                    <div className="mt-1.5">
                      <textarea value={r.note} onChange={(e) => patchResult(it, { note: e.target.value })}
                        placeholder="What's the gap? (note)" rows={2}
                        className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-[#0b3b66] focus:outline-none" />
                      {visit && <PhotoStrip visitId={visit.visit_id} kind="walk" photos={r.photos ?? []} onChange={(ph) => patchResult(it, { photos: ph })} allowOffline />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" onClick={onReview}
        className="flex w-full items-center justify-center gap-1 rounded-xl py-3.5 text-sm font-bold text-white shadow-sm"
        style={{ background: NAVY, minHeight: 44 }}>
        Review &amp; submit <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Summary ──────────────────────────────────────────────────────────
function SummaryScreen({ visitId, canPrivate, onBack, onSubmit, submitting }: {
  visitId: string | null;
  canPrivate: boolean;
  onBack: () => void;
  onSubmit: (v: { summary: string; private_note: string; funds_reviewed: boolean; summary_photos: PhotoRec[] }) => void;
  submitting: boolean;
}) {
  const [summary, setSummary] = useState("");
  const [priv, setPriv] = useState("");
  const [funds, setFunds] = useState(false);
  const [photos, setPhotos] = useState<PhotoRec[]>([]);
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-sm font-semibold text-zinc-500">← Back to walk</button>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="text-sm font-bold" style={{ color: NAVY }}>Visit summary</div>
        <div className="text-[11px] text-zinc-400">Shared — the store sees this.</div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="What went well, what to work on…"
          className="mt-2 w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm focus:border-[#0b3b66] focus:outline-none" />
        {visitId && <PhotoStrip visitId={visitId} kind="summary" photos={photos} onChange={setPhotos} />}
      </div>

      {canPrivate && (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-sm font-bold" style={{ color: NAVY }}>
            <Lock className="h-3.5 w-3.5" /> Private note
          </div>
          <div className="text-[11px] text-zinc-400">Leadership only — never shown to the store.</div>
          <textarea value={priv} onChange={(e) => setPriv(e.target.value)} rows={3} placeholder="For SDO/VP eyes only…"
            className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50/40 px-2.5 py-2 text-sm focus:border-amber-400 focus:outline-none" />
        </div>
      )}

      <label className="flex items-center gap-2 rounded-2xl bg-white p-3 text-sm shadow-sm">
        <input type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} className="h-4 w-4 accent-[#0b3b66]" />
        Store Funds reviewed
      </label>

      <button type="button" onClick={() => onSubmit({ summary, private_note: priv, funds_reviewed: funds, summary_photos: photos })} disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white shadow-sm"
        style={{ background: OK, minHeight: 44 }}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Submit visit
      </button>
    </div>
  );
}

// ── Actions ──────────────────────────────────────────────────────────
function ActionsScreen({ storeId, actions, loading }: { storeId: string | null; actions: Awaited<ReturnType<typeof fetchActions>>["actions"]; loading: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"high" | "med" | "low">("med");
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["visit-actions", storeId] }); qc.invalidateQueries({ queryKey: ["visit-today", storeId] }); };
  const add = useMutation({
    mutationFn: () => createAction({ store_id: storeId!, text: text.trim(), priority }),
    onSuccess: () => { setText(""); setPriority("med"); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't add.", "error"),
  });
  const upd = useMutation({
    mutationFn: (v: { id: string; status: "resolved" }) => updateAction(v),
    onSuccess: invalidate,
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update.", "error"),
  });
  const tone = (p: string) => (p === "high" ? DANGER : p === "low" ? "#6b7280" : WARN);

  return (
    <div className="space-y-2">
      {/* Add action */}
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">New action item</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What needs to happen…"
          className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-[#0b3b66] focus:outline-none" />
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg ring-1 ring-inset ring-zinc-200">
            {(["high", "med", "low"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className="px-2.5 py-1 text-xs font-bold" style={{ background: priority === p ? tone(p) : "white", color: priority === p ? "white" : "#6b7280" }}>
                {p}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => text.trim() && storeId && add.mutate()} disabled={!text.trim() || add.isPending}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: NAVY, minHeight: 44 }}>
            {add.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {loading ? <Centered><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></Centered>
        : actions.length === 0 ? <div className="rounded-2xl bg-white p-4 text-center text-sm text-zinc-400 shadow-sm">No open action items.</div>
        : actions.map((a) => (
          <div key={a.id} className="rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm text-zinc-800">{a.text}</span>
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: tone(a.priority) }}>{a.priority}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">{a.owner ? `${a.owner} · ` : ""}{a.due ? `due ${a.due} · ` : ""}{a.status}</span>
              <button type="button" onClick={() => upd.mutate({ id: a.id, status: "resolved" })} disabled={upd.isPending}
                className="rounded-md px-2 py-1 text-[11px] font-bold" style={{ color: OK }}>
                Resolve
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

// ── Store ────────────────────────────────────────────────────────────
function StoreScreen({ store, storeId, canPush, openActions, lastVisitAt }: {
  store: { number: string; name: string; city: string | null; state: string | null; address: string | null } | null;
  storeId: string | null; canPush: boolean; openActions: number; lastVisitAt: string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [flag, setFlag] = useState("");
  const push = useMutation({
    mutationFn: () => createReview({ store_id: storeId!, text: flag.trim() }),
    onSuccess: () => { setFlag(""); toast.push("Flagged for the next visit.", "success"); qc.invalidateQueries({ queryKey: ["visit-today", storeId] }); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't flag.", "error"),
  });
  if (!store) return <Centered><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></Centered>;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Store #{store.number}</div>
        <div className="text-lg font-bold" style={{ color: NAVY }}>{store.name}</div>
        <div className="text-sm text-zinc-500">{store.address ?? [store.city, store.state].filter(Boolean).join(", ")}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Open actions" value={String(openActions)} />
        <Stat label="Last visit" value={lastVisitAt ? new Date(lastVisitAt).toLocaleDateString() : "—"} />
      </div>

      {canPush && (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">Flag for next visit</div>
          <div className="text-[11px] text-zinc-400">Pushes a review request onto the next visitor's Today screen.</div>
          <textarea value={flag} onChange={(e) => setFlag(e.target.value)} rows={2} placeholder="e.g. Check walk-in temps and the DT timer setup."
            className="mt-2 w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-[#0b3b66] focus:outline-none" />
          <button type="button" onClick={() => flag.trim() && storeId && push.mutate()} disabled={!flag.trim() || push.isPending}
            className="mt-1.5 w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: NAVY, minHeight: 44 }}>
            {push.isPending ? "Flagging…" : "Push review request"}
          </button>
        </div>
      )}

      <VisitHistory storeId={storeId} />
    </div>
  );
}

function VisitHistory({ storeId }: { storeId: string | null }) {
  const q = useQuery({ queryKey: ["visit-history", storeId], queryFn: () => fetchVisitHistory(storeId!), enabled: !!storeId, staleTime: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const visits = q.data?.visits ?? [];
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400">Visit history</div>
      {q.isLoading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-zinc-300" /></div>
      ) : visits.length === 0 ? (
        <div className="py-4 text-center text-sm text-zinc-400">No submitted visits yet.</div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {visits.map((v) => {
            const TrendIcon = v.trend === "up" ? ArrowUpRight : v.trend === "down" ? ArrowDownRight : Minus;
            const tc = v.trend === "up" ? OK : v.trend === "down" ? DANGER : "#9aa3af";
            const isOpen = open === v.id;
            return (
              <div key={v.id} className="py-2">
                <button type="button" onClick={() => setOpen(isOpen ? null : v.id)} className="flex w-full items-center gap-2 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-midnight">
                      {new Date(v.submitted_at).toLocaleDateString()}
                      {v.has_private_note && <Lock className="h-3 w-3 text-amber-500" />}
                    </div>
                    <div className="text-[11px] text-zinc-400">{[v.visitor, v.role?.toUpperCase()].filter(Boolean).join(" · ")}{v.actions ? ` · ${v.actions} action${v.actions === 1 ? "" : "s"}` : ""}</div>
                  </div>
                  <span className="text-sm font-bold tabular-nums" style={{ color: NAVY, fontFamily: "'Geist Mono', monospace" }}>{pct(v.walk_score)}</span>
                  <span className="flex w-10 items-center justify-end gap-0.5 text-[11px] font-semibold tabular-nums" style={{ color: tc }}>
                    {v.trend && <TrendIcon className="h-3.5 w-3.5" />}{v.delta != null && v.delta !== 0 ? `${v.delta > 0 ? "+" : ""}${v.delta}` : ""}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-1.5 space-y-1.5 rounded-lg bg-zinc-50 p-2.5 text-sm">
                    {v.summary ? <div className="text-zinc-700">{v.summary}</div> : <div className="text-zinc-400">No summary.</div>}
                    {v.has_private_note && (
                      v.private_note
                        ? <div className="rounded-md bg-amber-50 px-2 py-1.5 text-[13px] text-amber-800"><Lock className="mr-1 inline h-3 w-3" />{v.private_note}</div>
                        : <div className="text-[11px] italic text-zinc-400"><Lock className="mr-1 inline h-3 w-3" />Private note (SDO+ only)</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-lg font-black" style={{ color: NAVY, fontFamily: "'Geist Mono', monospace" }}>{value}</div>
    </div>
  );
}

// Camera-first photo capture. Native camera via file-capture (reliable on
// mobile, EXIF preserved); GPS + timestamp captured at upload. Instant preview
// via object URL; the server re-signs on read. Full custom viewfinder is a
// later polish.
function PhotoStrip({ visitId, kind, photos, onChange, allowOffline }: {
  visitId: string; kind: "walk" | "summary"; photos: PhotoRec[]; onChange: (p: PhotoRec[]) => void; allowOffline?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    if (offline && !allowOffline) {
      toast.push("You're offline — reconnect to add photos here.", "error");
      return;
    }
    setBusy(true);
    try {
      const recs: PhotoRec[] = [];
      for (const f of files) {
        if (offline) {
          // Stash the blob locally; it uploads on reconnect (see flush()).
          const key = `${visitId}:${kind}:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await putBlob(key, f);
          recs.push({ pendingKey: key, previewUrl: URL.createObjectURL(f), at: new Date().toISOString() });
        } else {
          recs.push(await uploadVisitPhoto(visitId, kind, f));
        }
      }
      onChange([...photos, ...recs]);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Photo upload failed.", "error");
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {photos.map((p, i) => (
        <div key={i} className="relative h-14 w-14">
          <img src={p.previewUrl || p.url || ""} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-zinc-200" />
          {p.pendingKey && !p.path && (
            <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-white" title="Uploads when you're back online">
              <Clock className="h-2.5 w-2.5" />
            </span>
          )}
        </div>
      ))}
      <label className="grid h-14 w-14 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-zinc-300 text-zinc-400 active:bg-zinc-50" style={{ minHeight: 44 }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onPick} disabled={busy} />
      </label>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[40vh] place-items-center">{children}</div>;
}
