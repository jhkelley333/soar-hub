// Store Command Center — the public per-store page (/s/:token), designed to
// live as a bookmark on the store's desktop. No login: the URL token is the
// credential and it binds to the first device that opens it, so a forwarded
// link shows a clear "registered to a different device" message instead of
// data. Light-only, per the design mock. Auto-refreshes every 5 minutes.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Check, Megaphone, MessageSquare, Phone, PhoneCall, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPhoneForDisplay } from "@/lib/phone";
import { fetchPortalSnapshot, sendPortalReport, type PortalSnapshot } from "./api";

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function StorePortalPage() {
  const { token = "" } = useParams();
  const [showCall, setShowCall] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const q = useQuery({
    queryKey: ["store-portal", token],
    queryFn: () => fetchPortalSnapshot(token),
    enabled: !!token,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: (count, err) => {
      const status = (err as Error & { status?: number })?.status;
      return status !== 403 && status !== 404 && count < 2;
    },
  });

  const today = useMemo(() => {
    const d = new Date();
    return {
      weekday: d.toLocaleDateString("en-US", { weekday: "long" }),
      date: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };
  }, []);

  if (q.isError) {
    const message = (q.error as Error)?.message ?? "Something went wrong.";
    return (
      <Chrome>
        <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-28 text-center">
          <AlertTriangle className="h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">This screen can't open</h1>
          <p className="mt-2 text-zinc-500">{message}</p>
        </div>
      </Chrome>
    );
  }

  const data = q.data;
  return (
    <Chrome store={data?.store} dateLabel={today}>
      <PortalBody data={data} isLoading={q.isLoading} onCall={() => setShowCall(true)} onReport={() => setShowReport(true)} />
      {showCall && data && <RightCallSheet contacts={data.contacts} onClose={() => setShowCall(false)} />}
      {showReport && <ReportSheet token={token} onClose={() => setShowReport(false)} />}
    </Chrome>
  );
}

// The page content between the chrome and the modals — shared with the admin
// live view (/admin/store-portal/:storeId), which supplies its own data.
export function PortalBody({ data, isLoading, onCall, onReport }: {
  data: PortalSnapshot | undefined; isLoading: boolean; onCall: () => void; onReport: () => void;
}) {
  const q = { isLoading };
  return (
    <>
      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-14 sm:pt-20">
        <div className="text-[12px] font-bold uppercase tracking-[0.2em] text-red-600">Store Command Center</div>
        <h1 className="mt-3 max-w-2xl text-5xl font-extrabold leading-[1.05] tracking-tight text-zinc-900 sm:text-6xl">
          Everything you need to run today's shift.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-zinc-500">
          One place for sales, labor, work orders, and the people to call when something needs a decision.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button onClick={onCall}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700">
            Make the Right Call <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={onReport}
            className="inline-flex items-center rounded-xl border border-zinc-200 bg-white px-6 py-3.5 text-base font-semibold text-zinc-900 transition hover:border-zinc-400">
            Report to GM
          </button>
        </div>
      </section>

      {/* ── KPI strip ── */}
      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-zinc-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Kpi label="Yesterday's Sales"
            value={data?.sales?.net_sales != null ? fmtMoney(data.sales.net_sales) : q.isLoading ? "…" : "—"}
            foot={data?.sales?.wow_pct != null ? (
              <Trend up={data.sales.wow_pct >= 0} good={data.sales.wow_pct >= 0} text={`${Math.abs(data.sales.wow_pct)}% vs last week`} />
            ) : <span className="text-zinc-400">No comparison yet</span>} />
          <Kpi label="Labor · Yesterday"
            value={data?.labor?.labor_pct != null ? `${data.labor.labor_pct}%` : q.isLoading ? "…" : "—"}
            foot={data?.labor?.labor_pct != null && data?.labor?.target_pct != null ? (
              data.labor.labor_pct > data.labor.target_pct
                ? <Trend up good={false} text={`${Math.round((data.labor.labor_pct - data.labor.target_pct) * 10) / 10}% over ${data.labor.target_pct}% goal`} />
                : <Trend up={false} good text={`under the ${data.labor.target_pct}% goal`} />
            ) : <span className="text-zinc-400">Goal not set</span>} />
          <Kpi label="Ranker · Last Week"
            value={data?.rank ? <>#{data.rank.rank} <span className="text-2xl font-semibold text-zinc-400">of {data.rank.total}</span></> : q.isLoading ? "…" : "—"}
            foot={data?.rank ? <span className="text-zinc-500">across the company</span> : <span className="text-zinc-400">Ranking unavailable</span>} />
        </div>
      </section>

      {/* ── Cards ── */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-6 py-10 lg:grid-cols-3">
        {/* Work orders */}
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-zinc-900">Work Orders</h2>
            {data && (
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold",
                data.work_orders.open_count > 0 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700")}>
                {data.work_orders.open_count} open
              </span>
            )}
          </div>
          <p className="mt-3 min-h-[3rem] text-[15px] leading-relaxed text-zinc-500">
            {q.isLoading ? "Loading…" : data && data.work_orders.latest.length > 0
              ? data.work_orders.latest.map((t) => `${t.title} — ${t.status}.`).join(" ")
              : "No open tickets. File one the moment something breaks."}
          </p>
          <a href="/submit" className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-red-600 hover:underline">
            {data && data.work_orders.open_count > 0 ? "Open tickets" : "File a ticket"} <ArrowRight className="h-4 w-4" />
          </a>
        </Card>

        {/* Notes about today */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Notes About Today</h2>
              <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Set by the GM</div>
            </div>
            {data && data.notes.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">{data.notes.length} new</span>
            )}
          </div>
          <ul className="mt-4 flex min-h-[3rem] flex-col gap-2.5">
            {q.isLoading ? <li className="text-[15px] text-zinc-400">Loading…</li>
              : data && data.notes.length > 0 ? data.notes.slice(0, 4).map((n, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.pinned ? "bg-red-500" : i % 2 === 0 ? "bg-emerald-500" : "bg-amber-400")} />
                  <span className="text-[15px] leading-snug text-zinc-700">{n.title}</span>
                </li>
              )) : <li className="text-[15px] text-zinc-400">Nothing posted for today yet.</li>}
          </ul>
        </Card>

        {/* Report to GM */}
        <div className="flex flex-col rounded-2xl bg-zinc-900 p-6 text-white shadow-sm">
          <h2 className="text-xl font-bold">Report to the GM</h2>
          <p className="mt-3 flex-1 text-[15px] leading-relaxed text-zinc-300">
            Running late? See a safety or equipment issue? Send it straight to your GM.
          </p>
          <button onClick={onReport}
            className="mt-4 inline-flex items-center gap-1.5 text-left text-[15px] font-bold text-amber-400 hover:underline">
            Report tardiness or issue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

    </>
  );
}

// ── chrome ────────────────────────────────────────────────────────────────────
export function Chrome({ store, dateLabel, children }: {
  store?: PortalSnapshot["store"]; dateLabel?: { weekday: string; date: string }; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <header className="border-b border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
          <div className="text-2xl font-extrabold tracking-tight">
            my<span className="text-red-600">soar</span>hub
          </div>
          <div className="flex items-center gap-4">
            {store && (
              <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm font-bold text-zinc-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                SONIC #{store.number}
                {(store.city || store.state) && (
                  <span className="font-medium text-zinc-400">{[store.city, store.state].filter(Boolean).join(", ")}</span>
                )}
              </span>
            )}
            {dateLabel && (
              <div className="hidden text-right sm:block">
                <div className="text-sm font-bold">{dateLabel.weekday}</div>
                <div className="text-xs text-zinc-400">{dateLabel.date}</div>
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot: React.ReactNode }) {
  return (
    <div className="px-8 py-7">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">{label}</div>
      <div className="mt-2 text-4xl font-extrabold tabular-nums tracking-tight text-zinc-900">{value}</div>
      <div className="mt-1.5 text-sm font-medium">{foot}</div>
    </div>
  );
}

function Trend({ up, good, text }: { up: boolean; good: boolean; text: string }) {
  return (
    <span className={cn("font-bold", good ? "text-emerald-600" : "text-red-600")}>
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>;
}

// ── Make the Right Call ───────────────────────────────────────────────────────
const SLOT_TITLE: Record<string, string> = {
  GM: "General Manager",
  DO: "Director of Operations",
  SDO: "Senior Director of Operations",
  RVP: "Regional VP",
};

export function RightCallSheet({ contacts, onClose }: { contacts: PortalSnapshot["contacts"]; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Make the Right Call" icon={<PhoneCall className="h-5 w-5 text-red-600" />}>
      <p className="text-sm text-zinc-500">Start at the top. If you can't reach them, move down the list.</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {contacts.length === 0 && <li className="text-sm text-zinc-400">No contacts on file — ask your GM.</li>}
        {contacts.map((c) => (
          <li key={c.slot} className="rounded-xl border border-zinc-200 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-14 shrink-0 place-items-center rounded-lg bg-zinc-100 text-xs font-extrabold text-zinc-600">{c.slot}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-zinc-900">{c.name ?? "—"}</div>
                <div className="text-xs font-medium text-zinc-500">{SLOT_TITLE[c.slot] ?? c.slot}</div>
                <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", c.phone ? "text-zinc-700" : "font-normal text-zinc-400")}>
                  {c.phone ? formatPhoneForDisplay(c.phone) : "No phone on file"}
                </div>
              </div>
            </div>
            {c.phone && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <a href={`tel:${c.phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700">
                  <Phone className="h-4 w-4" /> Call
                </a>
                <a href={`sms:${c.phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-bold text-zinc-800 transition hover:border-zinc-500">
                  <MessageSquare className="h-4 w-4" /> Text
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ── Report to GM ──────────────────────────────────────────────────────────────
const KINDS = [
  { key: "tardiness", label: "Tardiness" },
  { key: "safety", label: "Safety" },
  { key: "equipment", label: "Equipment" },
  { key: "issue", label: "Other issue" },
];

function ReportSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const [kind, setKind] = useState("issue");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const send = useMutation({
    mutationFn: () => sendPortalReport(token, { kind, message: message.trim(), reporter_name: name.trim() || undefined }),
  });

  if (send.isSuccess) {
    return (
      <Modal onClose={onClose} title="Sent to your GM" icon={<Check className="h-5 w-5 text-emerald-600" />}>
        <p className="text-sm text-zinc-500">
          Your report is on its way{send.data.notified > 1 ? " to your GM and DO" : ""}. If it's urgent, use <strong>Make the Right Call</strong> too.
        </p>
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">Done</button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Report to the GM" icon={<Megaphone className="h-5 w-5 text-red-600" />}>
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button key={k.key} onClick={() => setKind(k.key)}
            className={cn("rounded-xl border px-3 py-2.5 text-sm font-bold transition",
              kind === k.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400")}>
            {k.label}
          </button>
        ))}
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} autoFocus
        placeholder="What's going on? Who and what does it affect?"
        className="mt-3 w-full resize-none rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
        className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none" />
      {send.isError && <p className="mt-2 text-sm font-medium text-red-600">{(send.error as Error)?.message ?? "Could not send — try again."}</p>}
      <button disabled={!message.trim() || send.isPending} onClick={() => send.mutate()}
        className="mt-4 w-full rounded-xl bg-red-600 py-3.5 text-base font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 disabled:opacity-40">
        {send.isPending ? "Sending…" : "Send to GM"}
      </button>
    </Modal>
  );
}

function Modal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">{icon}<h2 className="text-lg font-extrabold text-zinc-900">{title}</h2></div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

