// Hours of Operation — per-location editor. Standard weekly hours (with bulk
// fill for weekdays/weekends) plus dated special-hours overrides. Reached from
// the grid at /admin/hours-of-operation/:storeNumber. Admin-gated in the router.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Clock, CalendarDays, Plus, Trash2, MapPin, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { checkStoreGoogle, deleteSpecialHours, fetchStoreHours, saveSpecialHours, saveStandardHours, type DayHours, type GoogleCompare, type SpecialHours as SpecialHoursRow } from "./api";
import { DAY_LABELS, DAY_SHORT, isOvernight, to12 } from "./hoursFmt";

type Tab = "standard" | "special";

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
              {([["standard", "Standard Hours", Clock], ["special", "Special Hours", CalendarDays]] as const).map(([key, label, Icon]) => (
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
                : <SpecialHours storeId={query.data.store.id} storeNumber={storeNumber} initial={query.data.special} />}
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
