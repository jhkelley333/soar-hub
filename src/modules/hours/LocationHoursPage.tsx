// Hours of Operation — per-location editor. Standard weekly hours (with bulk
// fill for weekdays/weekends) plus dated special-hours overrides. Reached from
// the grid at /admin/hours-of-operation/:storeNumber. Admin-gated in the router.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Clock, CalendarDays, History, Wrench, Plus, Trash2, MapPin, CheckCircle2, AlertTriangle, Signpost, Mail, ImagePlus, X } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { checkStoreGoogle, deleteSpecialHours, fetchSignSettings, fetchStoreHours, fetchStoreHoursHistory, orderSign, saveReconciliation, saveSpecialHours, saveStandardHours, type DayHours, type GoogleCompare, type HoursHistoryEntry, type Reconciliation, type ReconSystem, type SpecialHours as SpecialHoursRow } from "./api";
import { DAY_LABELS, DAY_SHORT, fmtRange, isOvernight, to12 } from "./hoursFmt";

type Tab = "standard" | "special" | "history" | "reconcile";
type StoreMeta = { id: string; number: string; name: string; address: string | null; city: string | null; state: string | null; zip: string | null };
const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export function LocationHoursPage() {
  const { storeNumber = "" } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("standard");
  const query = useQuery({ queryKey: ["store-hours", storeNumber], queryFn: () => fetchStoreHours(storeNumber), enabled: !!storeNumber });

  return (
    <div>
      <button type="button" onClick={() => nav("/admin/hours-of-operation")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {query.isLoading && <Skeleton className="h-96 w-full" />}
      {query.isError && <EmptyState title="Couldn't load this location" description={(query.error as Error)?.message ?? "Try again."} />}

      {query.data && (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-bold tracking-tight text-midnight">
              {query.data.store.number} — {query.data.store.name}
            </h2>
            {query.data.updated_at && (
              <span className="text-xs text-zinc-400">Last updated {new Date(query.data.updated_at).toLocaleDateString("en-US")}</span>
            )}
          </div>
          <div className="text-sm text-zinc-500">
            {[query.data.store.address, query.data.store.city, query.data.store.state].filter(Boolean).join(", ")}{query.data.store.zip ? ` ${query.data.store.zip}` : ""}
          </div>

          <GooglePanel storeNumber={storeNumber} google={query.data.google} />

          <div className="mt-5 grid gap-5 lg:grid-cols-[180px_1fr]">
            <nav className="flex gap-1 lg:flex-col">
              {([["standard", "Standard Hours", Clock], ["special", "Special Hours", CalendarDays], ["reconcile", "Reconcile", Wrench], ["history", "History", History]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition", tab === key ? "bg-accent/10 text-accent" : "text-zinc-500 hover:bg-zinc-50")}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>

            <div>
              {tab === "standard"
                ? <StandardHours storeId={query.data.store.id} storeNumber={storeNumber} initial={query.data.standard} />
                : tab === "special"
                ? <SpecialHours storeId={query.data.store.id} storeNumber={storeNumber} initial={query.data.special} />
                : tab === "reconcile"
                ? <ReconcileTab store={query.data.store} storeNumber={storeNumber} initial={query.data.reconciliation} standard={query.data.standard} googleStatus={query.data.google.status} googleDiffs={query.data.google.diffs.length} />
                : <HistoryTab storeNumber={storeNumber} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Google comparison ───────────────────────────────────────────────────────
function GooglePanel({ storeNumber, google }: { storeNumber: string; google: GoogleCompare }) {
  const qc = useQueryClient();
  const toast = useToast();
  const check = useMutation({
    mutationFn: () => checkStoreGoogle(storeNumber),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store-hours", storeNumber] });
      qc.invalidateQueries({ queryKey: ["hours-grid"] });
      if (r.error) toast.push(`Google: ${r.error}`, "error");
      else toast.push(r.status === "match" ? "Matches Google." : r.status === "mismatch" ? `${r.diffs.length} day(s) differ from Google.` : "No Google hours found.", r.status === "mismatch" ? "error" : "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Google check failed.", "error"),
  });

  if (!google.configured) {
    return (
      <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 ring-1 ring-inset ring-zinc-200">
        Set <code className="rounded bg-white px-1">GOOGLE_PLACES_API_KEY</code> in Netlify to compare this location's hours against Google.
      </div>
    );
  }

  const tone = google.status === "match" ? "emerald" : google.status === "mismatch" ? "amber" : "zinc";
  return (
    <div className={cn("mt-3 rounded-lg p-3 ring-1 ring-inset",
      tone === "emerald" ? "bg-emerald-50 ring-emerald-200" : tone === "amber" ? "bg-amber-50 ring-amber-200" : "bg-zinc-50 ring-zinc-200")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-zinc-500" />
          {google.status === "match" && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Matches Google</span>}
          {google.status === "mismatch" && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="h-4 w-4" /> {google.diffs.length} day(s) differ from Google</span>}
          {google.status === "not_found" && <span className="text-zinc-500">No Google listing/hours found</span>}
          {google.status === "unchecked" && <span className="text-zinc-500">Not yet compared to Google</span>}
        </div>
        <Button size="sm" variant="secondary" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? "Checking…" : google.status === "unchecked" ? "Check Google" : "Re-check"}
        </Button>
      </div>
      {google.status === "mismatch" && google.diffs.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-md ring-1 ring-amber-200">
          <table className="w-full text-xs">
            <thead className="bg-amber-100/60 text-left text-[10px] uppercase tracking-wide text-amber-700">
              <tr><th className="px-2 py-1">Day</th><th className="px-2 py-1">System</th><th className="px-2 py-1">Google</th></tr>
            </thead>
            <tbody className="divide-y divide-amber-100 bg-white/50">
              {google.diffs.map((d) => (
                <tr key={d.day_of_week}>
                  <td className="px-2 py-1 font-semibold text-midnight">{DAY_SHORT[d.day_of_week]}</td>
                  <td className="px-2 py-1 tabular-nums text-zinc-600">{prettyRange(d.system)}</td>
                  <td className="px-2 py-1 tabular-nums text-amber-800">{prettyRange(d.google)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {google.checked_at && <div className="mt-1.5 text-[10px] text-zinc-400">Last checked {new Date(google.checked_at).toLocaleString("en-US")}</div>}
    </div>
  );
}
// "09:00-14:00" -> "9:00 AM – 2:00 PM"; "Closed" stays.
function prettyRange(s: string): string {
  if (!s || /closed/i.test(s)) return "Closed";
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s);
  return m ? `${to12(m[1])} – ${to12(m[2])}` : s;
}

// ── Standard weekly hours ────────────────────────────────────────────────────
function StandardHours({ storeId, storeNumber, initial }: { storeId: string; storeNumber: string; initial: DayHours[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState<DayHours[]>(initial);
  const [bulkOpen, setBulkOpen] = useState("");
  const [bulkClose, setBulkClose] = useState("");
  useEffect(() => setDays(initial), [initial]);

  const dirty = useMemo(() => JSON.stringify(days) !== JSON.stringify(initial), [days, initial]);

  const setDay = (dow: number, patch: Partial<DayHours>) =>
    setDays((prev) => prev.map((d) => (d.day_of_week === dow ? { ...d, ...patch } : d)));

  const applyBulk = (which: "all" | "weekdays" | "weekends") => {
    if (!bulkOpen || !bulkClose) { toast.push("Enter an open and close time to apply.", "error"); return; }
    const inSet = (dow: number) => which === "all" || (which === "weekdays" ? dow <= 4 : dow >= 5);
    setDays((prev) => prev.map((d) => (inSet(d.day_of_week) ? { ...d, is_closed: false, open: bulkOpen, close: bulkClose } : d)));
  };
  const clearAll = () => setDays((prev) => prev.map((d) => ({ ...d, is_closed: false, open: null, close: null })));

  const save = useMutation({
    mutationFn: () => saveStandardHours(storeId, days),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-hours", storeNumber] });
      qc.invalidateQueries({ queryKey: ["hours-grid"] });
      toast.push("Standard hours saved.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-base font-bold text-midnight">Standard Hours</h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Active</span>
      </div>
      <p className="mb-4 text-sm text-zinc-500">Update standard hours for this location.</p>

      {/* Bulk fill */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200">
        <label className="text-xs font-semibold text-zinc-500">Open
          <input type="time" value={bulkOpen} onChange={(e) => setBulkOpen(e.target.value)} className="mt-0.5 block rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        </label>
        <label className="text-xs font-semibold text-zinc-500">Close
          <input type="time" value={bulkClose} onChange={(e) => setBulkClose(e.target.value)} className="mt-0.5 block rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => applyBulk("all")}>Apply to all</Button>
          <Button size="sm" variant="secondary" onClick={() => applyBulk("weekdays")}>Weekdays</Button>
          <Button size="sm" variant="secondary" onClick={() => applyBulk("weekends")}>Weekends</Button>
          <Button size="sm" variant="ghost" onClick={clearAll}>Clear</Button>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => (
          <div key={d.day_of_week} className="rounded-lg border border-zinc-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-midnight">{DAY_LABELS[d.day_of_week]}</span>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={d.is_closed} onChange={(e) => setDay(d.day_of_week, { is_closed: e.target.checked })} />
                Closed
              </label>
            </div>
            {d.is_closed ? (
              <div className="py-1.5 text-sm font-medium text-red-500">Closed all day</div>
            ) : (
              <div className="flex items-center gap-2">
                <input type="time" value={d.open ?? ""} onChange={(e) => setDay(d.day_of_week, { open: e.target.value || null })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
                <span className="text-zinc-400">–</span>
                <input type="time" value={d.close ?? ""} onChange={(e) => setDay(d.day_of_week, { close: e.target.value || null })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
              </div>
            )}
            {!d.is_closed && isOvernight(d.open, d.close) && (
              <div className="mt-1 text-[11px] text-amber-600">Closes {to12(d.close)} next day</div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 opacity-60" title="Coming soon">
        <span className="text-xs text-zinc-400">📅 Apply these changes on a future date?</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Coming soon</span>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save standard hours"}
        </Button>
      </div>
    </Card>
  );
}

// ── Special (dated) hours ────────────────────────────────────────────────────
function SpecialHours({ storeId, storeNumber, initial }: { storeId: string; storeNumber: string; initial: SpecialHoursRow[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState("");
  const [close, setClose] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["store-hours", storeNumber] });
    qc.invalidateQueries({ queryKey: ["hours-grid"] });
  };
  const add = useMutation({
    mutationFn: () => saveSpecialHours(storeId, { date, is_closed: closed, open: closed ? null : (open || null), close: closed ? null : (close || null), note }),
    onSuccess: () => { invalidate(); setDate(""); setClosed(false); setOpen(""); setClose(""); setNote(""); toast.push("Special hours saved.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteSpecialHours(id),
    onSuccess: () => { invalidate(); toast.push("Removed.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't remove.", "error"),
  });

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-bold text-midnight">Special Hours</h3>
      <p className="mb-4 text-sm text-zinc-500">Holiday closures or one-off changes that override the standard hours for a specific date.</p>

      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-200">
        <label className="text-xs font-semibold text-zinc-500">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 block rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Closed
        </label>
        {!closed && (
          <>
            <label className="text-xs font-semibold text-zinc-500">Open
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} className="mt-0.5 block rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
            </label>
            <label className="text-xs font-semibold text-zinc-500">Close
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)} className="mt-0.5 block rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
            </label>
          </>
        )}
        <label className="min-w-[160px] flex-1 text-xs font-semibold text-zinc-500">Note
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thanksgiving" className="mt-0.5 block w-full rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none" />
        </label>
        <Button size="sm" onClick={() => add.mutate()} disabled={!date || add.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {initial.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-400">No special hours set.</div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {initial.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="text-sm font-semibold text-midnight">
                  {new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </div>
                <div className={cn("text-xs", s.is_closed ? "text-red-500" : "text-zinc-500")}>
                  {s.is_closed ? "Closed" : s.open && s.close ? `${to12(s.open)} – ${to12(s.close)}` : "—"}{s.note ? ` · ${s.note}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => del.mutate(s.id)} disabled={del.isPending} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Reconciliation ───────────────────────────────────────────────────────────
const WRONG_OPTIONS: { key: ReconSystem; label: string }[] = [
  { key: "system", label: "System Hours (Hub)" },
  { key: "rap", label: "RAP Hours of Ops" },
  { key: "itsacheckmate", label: "Itsacheckmate" },
  { key: "google", label: "Google listing" },
  { key: "sign", label: "Physical hours sign" },
];

function ReconcileTab({ store, storeNumber, initial, standard, googleStatus, googleDiffs }: {
  store: StoreMeta; storeNumber: string; initial: Reconciliation; standard: DayHours[]; googleStatus: string; googleDiffs: number;
}) {
  const storeId = store.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [wrong, setWrong] = useState<ReconSystem[]>(initial.wrong_systems);
  const [status, setStatus] = useState(initial.status);
  const [action, setAction] = useState(initial.action_taken);
  const [icmNeed, setIcmNeed] = useState(initial.itsacheckmate_update_needed);
  const [icmDone, setIcmDone] = useState(initial.itsacheckmate_done);
  const [signNeed, setSignNeed] = useState(initial.sign_order_needed);
  const [signDone, setSignDone] = useState(initial.sign_ordered);
  const [orderOpen, setOrderOpen] = useState(false);

  const toggleWrong = (k: ReconSystem) => setWrong((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k]));

  const save = useMutation({
    mutationFn: () => saveReconciliation(storeId, {
      status, wrong_systems: wrong, action_taken: action,
      itsacheckmate_update_needed: icmNeed, itsacheckmate_done: icmDone,
      sign_order_needed: signNeed, sign_ordered: signDone,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-hours", storeNumber] });
      qc.invalidateQueries({ queryKey: ["hours-grid"] });
      toast.push("Reconciliation saved.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-bold text-midnight">Reconcile Hours</h3>
      <p className="mb-4 text-sm text-zinc-500">
        Record where the hours are wrong, what you corrected, and any follow-ups. Check the two places to verify: <strong>RAP Hours of Ops</strong> and <strong>Itsacheckmate</strong>.
      </p>

      {googleStatus === "mismatch" && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Google shows {googleDiffs} day(s) different from the system — see the Standard Hours tab for the diff.
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Which systems are wrong?</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {WRONG_OPTIONS.map((o) => (
            <label key={o.key} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", wrong.includes(o.key) ? "border-accent bg-accent/5 text-midnight" : "border-zinc-200 text-zinc-600")}>
              <input type="checkbox" checked={wrong.includes(o.key)} onChange={() => toggleWrong(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
      </div>

      <label className="mb-4 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What did you correct / what action did you take?</span>
        <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3}
          placeholder="e.g. Corrected System Hours to 6:30 AM–12 AM; requested RAP update; Itsacheckmate still shows old hours."
          className="mt-1 w-full rounded-lg border border-zinc-200 p-2 text-sm focus:border-accent focus:outline-none" />
      </label>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-3">
          <div className="mb-1.5 text-sm font-semibold text-midnight">Itsacheckmate</div>
          <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={icmNeed} onChange={(e) => setIcmNeed(e.target.checked)} /> Needs hours update</label>
          <label className="mt-1 flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={icmDone} onChange={(e) => setIcmDone(e.target.checked)} /> Update completed</label>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3">
          <div className="mb-1.5 text-sm font-semibold text-midnight">Hours-of-Ops sign</div>
          <label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={signNeed} onChange={(e) => setSignNeed(e.target.checked)} /> New sign needs ordered</label>
          <label className="mt-1 flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={signDone} onChange={(e) => setSignDone(e.target.checked)} /> Sign ordered</label>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOrderOpen(true)}>
            <Signpost className="mr-1.5 h-3.5 w-3.5" /> Order sign…
          </Button>
        </div>
      </div>

      {orderOpen && <OrderSignModal store={store} standard={standard} onClose={() => setOrderOpen(false)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as Reconciliation["status"])} className="rounded-md border border-zinc-200 px-2 py-1 text-sm focus:border-accent focus:outline-none">
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          {initial.reviewed_at && <span className="text-[11px] text-zinc-400">Last saved {new Date(initial.reviewed_at).toLocaleDateString("en-US")}{initial.reviewed_by_name ? ` by ${initial.reviewed_by_name}` : ""}</span>}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save reconciliation"}</Button>
        </div>
      </div>
    </Card>
  );
}

// ── Order a hours-of-op sign (email the vendor) ──────────────────────────────
function OrderSignModal({ store, standard, onClose }: { store: StoreMeta; standard: DayHours[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settingsQ = useQuery({ queryKey: ["sign-settings"], queryFn: fetchSignSettings });
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [image, setImage] = useState<{ name: string; content: string } | null>(null);

  useEffect(() => {
    if (settingsQ.data && !seeded) {
      setTo(settingsQ.data.settings.to);
      setMessage(settingsQ.data.settings.message);
      setSeeded(true);
    }
  }, [settingsQ.data, seeded]);

  const onFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setImage({ name: f.name, content: String(r.result) });
    r.readAsDataURL(f);
  };

  const send = useMutation({
    mutationFn: () => orderSign({ store_number: store.number, to: to.trim(), message: message.trim() || undefined, image }),
    onSuccess: (r) => {
      toast.push(`Sign order sent to ${r.to}.`, "success");
      qc.invalidateQueries({ queryKey: ["store-hours", store.number] });
      qc.invalidateQueries({ queryKey: ["hours-grid"] });
      onClose();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't send the order.", "error"),
  });

  const fullAddress = [store.address, store.city, store.state].filter(Boolean).join(", ") + (store.zip ? ` ${store.zip}` : "");
  const emailOff = settingsQ.data?.email_configured === false;
  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";

  return (
    <Modal open onClose={onClose} title={`Order sign — #${store.number}`} maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => send.mutate()} disabled={!isEmail(to) || send.isPending || emailOff}>
            <Mail className="mr-1.5 h-3.5 w-3.5" /> {send.isPending ? "Sending…" : "Send order"}
          </Button>
        </>
      }>
      {emailOff && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          Email isn't configured on the server yet (RESEND_API_KEY) — the order can't be sent.
        </div>
      )}
      <div className="space-y-3">
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-zinc-500">Send to (vendor email)</span>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="signs@vendor.com" className={cls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs font-semibold text-zinc-500">Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={cls} />
        </label>

        <div className="rounded-lg bg-zinc-50 p-3 text-xs ring-1 ring-inset ring-zinc-200">
          <div className="mb-1 font-semibold text-zinc-600">Ship to</div>
          <div className="text-zinc-700">{store.name} #{store.number}</div>
          <div className="text-zinc-500">{fullAddress || "— no address on file —"}</div>
          <div className="mt-2 mb-1 font-semibold text-zinc-600">Hours for the sign</div>
          <table className="text-zinc-600">
            <tbody>
              {standard.map((d) => (
                <tr key={d.day_of_week}>
                  <td className="pr-3 text-zinc-400">{DAY_LABELS[d.day_of_week]}</td>
                  <td className="font-medium">{fmtRange(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <span className="mb-1 block text-xs font-semibold text-zinc-500">Reference image (optional)</span>
          {image ? (
            <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-zinc-200">
              <ImagePlus className="h-4 w-4 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate text-zinc-600">{image.name}</span>
              <button type="button" onClick={() => setImage(null)} className="text-zinc-400 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">
              <ImagePlus className="h-4 w-4" /> Attach image
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">Sends from SOAR with the store's mailing address + hours. Marks the sign as ordered on this store's reconciliation. Edit the default recipient/message under Sign order settings.</p>
    </Modal>
  );
}

// ── Change history ───────────────────────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = { edit: "Manual edit", import: "Bulk import", baseline: "Baseline" };

// A snapshot's day_of_week -> "6:30 AM - 12:00 AM" / "Closed" / "—".
function dayMap(days: DayHours[]): Record<number, string> {
  const m: Record<number, string> = {};
  for (let dow = 0; dow < 7; dow++) m[dow] = fmtRange(days.find((d) => d.day_of_week === dow) ?? null);
  return m;
}

function HistoryTab({ storeNumber }: { storeNumber: string }) {
  const q = useQuery({ queryKey: ["store-hours-history", storeNumber], queryFn: () => fetchStoreHoursHistory(storeNumber) });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load history" description={(q.error as Error)?.message ?? "Try again."} />;
  const history = q.data?.history ?? [];

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-bold text-midnight">Change History</h3>
      <p className="mb-4 text-sm text-zinc-500">Every standard-hours change for this location, newest first. Changed days are highlighted against the prior version.</p>
      {history.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-400">No history recorded yet.</div>
      ) : (
        <ol className="space-y-3">
          {history.map((h, i) => {
            const cur = dayMap(h.days);
            const prev = i + 1 < history.length ? dayMap(history[i + 1].days) : null; // older entry
            return <HistoryEntry key={h.id} h={h} cur={cur} prev={prev} />;
          })}
        </ol>
      )}
    </Card>
  );
}

function HistoryEntry({ h, cur, prev }: { h: HoursHistoryEntry; cur: Record<number, string>; prev: Record<number, string> | null }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-midnight">
          {new Date(h.changed_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{SOURCE_LABEL[h.source ?? ""] ?? h.source ?? "Change"}</span>
        {h.by && <span className="text-xs text-zinc-400">by {h.by}</span>}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {DAY_SHORT.map((lbl, dow) => {
          const changed = prev != null && prev[dow] !== cur[dow];
          return (
            <div key={dow} className={cn("flex items-center justify-between rounded px-1.5 py-0.5 text-xs", changed ? "bg-amber-50" : "")}>
              <span className="font-medium text-zinc-500">{lbl}</span>
              <span className={cn("tabular-nums", changed ? "font-semibold text-amber-800" : "text-zinc-700")}>
                {cur[dow]}{changed ? <span className="ml-1 text-[10px] text-zinc-400">was {prev![dow]}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </li>
  );
}
