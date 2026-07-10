// Store Command Center — the public per-store page (/s/:token), designed to
// live as a bookmark on the store's desktop. No login: the URL token is the
// credential and it binds to the first device that opens it, so a forwarded
// link shows a clear "registered to a different device" message instead of
// data. Light-only, per the design mock. Auto-refreshes every 5 minutes.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  AlertTriangle, ArrowRight, Check, FileText, Megaphone, MessageSquare, PhoneCall, QrCode, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPhoneForDisplay } from "@/lib/phone";
import {
  fetchPortalSnapshot, messagePortalLeader, panelItems, sendPortalReport, togglePortalAction,
  type CookingEvent, type PortalAccess, type PortalAction, type PortalSnapshot,
} from "./api";
import { TicketsView } from "./StorePortalTickets";

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function StorePortalPage() {
  const { token = "" } = useParams();
  const [showCall, setShowCall] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
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
  if (showTickets) {
    return (
      <Chrome store={data?.store} dateLabel={today}>
        <TicketsView access={{ token }} storeNumber={data?.store.number} onBack={() => setShowTickets(false)} />
      </Chrome>
    );
  }
  return (
    <Chrome store={data?.store} dateLabel={today}>
      <PortalBody data={data} isLoading={q.isLoading} access={{ token }} onCall={() => setShowCall(true)} onReport={() => setShowReport(true)} onTickets={() => setShowTickets(true)} />
      {showCall && data && <RightCallSheet contacts={data.contacts} token={token} onClose={() => setShowCall(false)} />}
      {showReport && <ReportSheet access={{ token }} onClose={() => setShowReport(false)} />}
    </Chrome>
  );
}

// The page content between the chrome and the modals — shared with the admin
// live view (/admin/store-portal/:storeId), which supplies its own data.
// `access` enables checking off day-sheet action items (token or admin).
export function PortalBody({ data, isLoading, access, onCall, onReport, onTickets }: {
  data: PortalSnapshot | undefined; isLoading: boolean; access?: PortalAccess;
  onCall: () => void; onReport: () => void; onTickets?: () => void;
}) {
  const q = { isLoading };
  // "full" = the whole day sheet (from the Notes card); "actions" = just the
  // checklist (from the Actions card) — no message-board content there.
  const [showDay, setShowDay] = useState<"full" | "actions" | null>(null);
  const openActions = (data?.actions ?? []).filter((a) => !a.done);
  return (
    <>
      {/* ── Hero ── */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 pb-12 pt-14 sm:pt-20 lg:grid-cols-[1fr_460px]">
        <div>
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
        </div>
        {(data?.whats_cooking?.length ?? 0) > 0 && <WhatsCooking events={data!.whats_cooking!} />}
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
          <p className="mt-3 line-clamp-4 flex-1 text-[15px] leading-relaxed text-zinc-500">
            {q.isLoading ? "Loading…" : data && data.work_orders.latest.length > 0
              ? data.work_orders.latest.map((t) => `${t.title} — ${t.status}.`).join(" ")
              : "No open tickets. File one the moment something breaks."}
          </p>
          {onTickets ? (
            <button onClick={onTickets} className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-red-600 hover:underline">
              {data && data.work_orders.open_count > 0 ? "Manage tickets" : "File a ticket"} <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-semibold text-zinc-400">Managed from the store screen</span>
          )}
        </Card>

        {/* Notes about today — opens the full day sheet */}
        <button onClick={() => setShowDay("full")} className="h-full text-left">
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
            <ul className="mt-4 flex flex-1 flex-col gap-2.5">
              {q.isLoading ? <li className="text-[15px] text-zinc-400">Loading…</li>
                : data && data.notes.length > 0 ? data.notes.slice(0, 3).map((n, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.pinned ? "bg-red-500" : i % 2 === 0 ? "bg-emerald-500" : "bg-amber-400")} />
                    <span className="line-clamp-2 text-[15px] leading-snug text-zinc-700">{n.title}</span>
                  </li>
                )) : <li className="text-[15px] text-zinc-400">Nothing posted for today yet.</li>}
            </ul>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[15px] font-bold text-red-600">
              Open the day sheet <ArrowRight className="h-4 w-4" />
            </span>
          </Card>
        </button>

        {/* Actions needed — the GM's checklist for the shift. Report to GM
            stays in the hero, so this card earns its spot with real work. */}
        <div className="flex flex-col rounded-2xl bg-zinc-900 p-6 text-white shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Actions Needed</h2>
            {data && (
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold",
                openActions.length > 0 ? "bg-amber-400/20 text-amber-300" : "bg-emerald-400/20 text-emerald-300")}>
                {openActions.length} open
              </span>
            )}
          </div>
          <ul className="mt-3 flex-1 space-y-2">
            {q.isLoading ? <li className="text-[15px] text-zinc-400">Loading…</li>
              : openActions.length > 0 ? openActions.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-start gap-2.5">
                  <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded border border-zinc-600" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] leading-snug text-zinc-100">{a.title}</span>
                    {(a.due_label || a.assignee) && (
                      <span className="text-[12px] text-zinc-400">{[a.due_label && `Due ${a.due_label}`, a.assignee].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                </li>
              )) : <li className="text-[15px] leading-relaxed text-zinc-300">All caught up. Anything the GM adds shows up here.</li>}
          </ul>
          <button onClick={() => setShowDay("actions")}
            className="mt-4 inline-flex items-center gap-1.5 text-left text-[15px] font-bold text-amber-400 hover:underline">
            Open today's list <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {(data?.quick_links?.length ?? 0) > 0 && <QuickLinks links={data!.quick_links!} />}

      {showDay && data && <DaySheet data={data} access={access} actionsOnly={showDay === "actions"} onClose={() => setShowDay(null)} />}
    </>
  );
}

// ── Day sheet ─────────────────────────────────────────────────────────────────
// The full "Notes About Today" view from the design mock: the pinned note as
// a banner, the rest of the notes, the GM's action checklist (checkable from
// the screen), and this week's birthdays.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function birthdayLabel(b: { month: number; day: number; in_days: number }): string {
  const now = new Date();
  if (b.month === now.getMonth() + 1 && b.day === now.getDate()) return "Today";
  const d = new Date(now);
  d.setDate(now.getDate() + b.in_days);
  return WEEKDAYS[d.getDay()];
}
const prettyRole = (r: string | null) =>
  r ? r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
// "14:30" → "2:30p"
const fmt12 = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h)) return t;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")}${h >= 12 ? "p" : "a"}`;
};
const fmtShortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function DaySheet({ data, access, actionsOnly, onClose }: {
  data: PortalSnapshot; access?: PortalAccess; actionsOnly?: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const notes = actionsOnly ? [] : data.notes;
  const banner = notes.find((n) => n.pinned) ?? notes[0] ?? null;
  const rest = notes.filter((n) => n !== banner);
  const actions = data.actions ?? [];
  const birthdays = actionsOnly ? [] : data.birthdays ?? [];
  const weekday = WEEKDAYS[new Date().getDay()];

  const isDone = (a: PortalAction) => checked[a.id] ?? a.done;
  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => {
      if (!access) return Promise.resolve({ ok: true as const });
      return togglePortalAction(access, id, done);
    },
    onMutate: ({ id, done }) => setChecked((c) => ({ ...c, [id]: done })),
    onError: (_e, { id, done }) => setChecked((c) => ({ ...c, [id]: !done })),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["store-portal"] });
      qc.invalidateQueries({ queryKey: ["store-portal-live"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 p-4 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-600">Set by the GM · {weekday}</div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">{actionsOnly ? "Actions Needed" : "Notes About Today"}</h2>
          </div>
          {banner?.author && <span className="text-sm text-zinc-400">{banner.author}</span>}
        </div>

        {!actionsOnly && (
          <>
            {banner && (
              <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border-l-4 border-amber-400 bg-zinc-50 px-4 py-3.5">
                {banner.title && <div className="text-[15px] font-bold text-zinc-900">{banner.title}</div>}
                {banner.body && <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">{banner.body}</p>}
              </div>
            )}
            {rest.length > 0 && (
              <div className="mt-3 space-y-2">
                {rest.map((n, i) => (
                  <div key={i} className="max-h-60 overflow-y-auto rounded-xl bg-zinc-50 px-4 py-3">
                    <div className="text-[14px] font-bold text-zinc-900">{n.title}</div>
                    {n.body && <p className="mt-0.5 whitespace-pre-line text-[13.5px] leading-snug text-zinc-600">{n.body}</p>}
                  </div>
                ))}
              </div>
            )}
            {!banner && rest.length === 0 && (
              <p className="mt-4 text-sm text-zinc-400">Nothing posted for today yet.</p>
            )}
          </>
        )}

        {!actionsOnly && <SheetHeading dot="bg-red-500" label="Actions Needed" />}
        {actions.length === 0 ? (
          <p className={cn("text-sm text-zinc-400", actionsOnly && "mt-4")}>No action items for today.</p>
        ) : (
          <ul className={cn("divide-y divide-zinc-100", actionsOnly && "mt-4")}>
            {actions.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-3">
                <button
                  onClick={() => toggle.mutate({ id: a.id, done: !isDone(a) })}
                  disabled={!access}
                  className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition",
                    isDone(a) ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 bg-white hover:border-zinc-500")}
                  aria-label={isDone(a) ? "Mark not done" : "Mark done"}>
                  {isDone(a) && <Check className="h-4 w-4" />}
                </button>
                <div className="min-w-0">
                  <div className={cn("text-[15px] font-semibold leading-snug", isDone(a) ? "text-zinc-400 line-through" : "text-zinc-900")}>{a.title}</div>
                  {(a.due_label || a.assignee) && (
                    <div className="mt-0.5 text-[13px] text-zinc-400">{[a.due_label && `Due ${a.due_label}`, a.assignee].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!actionsOnly && (data.training_today?.length ?? 0) > 0 && (
          <>
            <SheetHeading dot="bg-emerald-500" label="Who's Training Today" />
            <ul className="space-y-2">
              {data.training_today!.map((t, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {initials(t.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-zinc-900">{t.name}</span>
                    {t.type && <span className="block text-[13px] text-zinc-500">{t.type}</span>}
                  </span>
                  {t.start_time && (
                    <span className="rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-zinc-600">
                      {fmt12(t.start_time)}{t.end_time ? ` – ${fmt12(t.end_time)}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {!actionsOnly && (data.out_today?.length ?? 0) > 0 && (
          <>
            <SheetHeading dot="bg-blue-500" label="Out Today — PTO" />
            <ul className="space-y-2">
              {data.out_today!.map((p, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-zinc-900">{p.name}</span>
                    {p.position && <span className="block text-[13px] text-zinc-500">{p.position}</span>}
                  </span>
                  <span className="text-sm font-semibold text-zinc-400">through {fmtShortDate(p.until)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {birthdays.length > 0 && (
          <>
            <SheetHeading dot="bg-amber-400" label="Birthdays" />
            <ul className="space-y-2">
              {birthdays.map((b, i) => {
                const label = birthdayLabel(b);
                const today = label === "Today";
                return (
                  <li key={i} className={cn("flex items-center gap-3 rounded-xl px-4 py-3", today ? "bg-amber-50" : "bg-zinc-50")}>
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold",
                      today ? "bg-white text-amber-700" : "bg-white text-zinc-600")}>
                      {initials(b.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-zinc-900">{b.name}</span>
                      {b.role && <span className="block text-[13px] text-zinc-500">{prettyRole(b.role)}</span>}
                    </span>
                    <span className={cn("text-sm font-semibold", today ? "text-red-600" : "text-zinc-400")}>{label}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="rounded-xl bg-zinc-100 px-6 py-3 text-sm font-bold text-zinc-800 transition hover:bg-zinc-200">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SheetHeading({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="mb-2 mt-7 flex items-center gap-2 border-t border-zinc-100 pt-6">
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      <h3 className="text-[13px] font-extrabold uppercase tracking-wider text-zinc-900">{label}</h3>
    </div>
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
  return <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>;
}

// ── What's Cooking ────────────────────────────────────────────────────────────
// Upcoming events from the linked calendar (LTO launches, promos, visits),
// shown beside the hero. Admin links the iCal feed in Command Center Links.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function DateTile({ date, today, size = "sm" }: { date: string; today: boolean; size?: "sm" | "lg" }) {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  return (
    <span className={cn("flex shrink-0 flex-col items-center justify-center rounded-xl",
      size === "lg" ? "h-14 w-14" : "h-12 w-12",
      today ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-700")}>
      <span className={cn("text-[9px] font-extrabold tracking-widest", today ? "text-red-200" : "text-zinc-400")}>{MONTHS[(m || 1) - 1]}</span>
      <span className={cn("font-extrabold leading-none", size === "lg" ? "text-xl" : "text-lg")}>{d || y}</span>
    </span>
  );
}

function WhatsCooking({ events }: { events: NonNullable<PortalSnapshot["whats_cooking"]> }) {
  const todayIso = new Date().toLocaleDateString("en-CA");
  const [open, setOpen] = useState<CookingEvent | null>(null);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-600">What's Cooking…</div>
      <ul className="-mx-2 mt-3 flex max-h-[340px] flex-col gap-1 overflow-y-auto px-2 py-1">
        {events.map((e, i) => {
          const today = e.date === todayIso;
          return (
            <li key={i}>
              <button onClick={() => setOpen(e)}
                className="flex w-full items-center gap-3.5 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-50">
                <DateTile date={e.date} today={today} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-snug text-zinc-900">{e.title}</span>
                  <span className="block text-[12.5px] text-zinc-400">
                    {today ? "Today" : new Date(`${e.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" })}
                    {e.time ? ` · ${fmt12(e.time)}` : ""}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            </li>
          );
        })}
      </ul>
      {open && <CookingDetail event={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CookingDetail({ event: e, onClose }: { event: CookingEvent; onClose: () => void }) {
  const today = e.date === new Date().toLocaleDateString("en-CA");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <DateTile date={e.date} today={today} size="lg" />
            <div>
              <h2 className="text-lg font-extrabold leading-snug text-zinc-900">{e.title}</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {today ? "Today" : new Date(`${e.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                {e.time ? ` · ${fmt12(e.time)}` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        {e.location && (
          <p className="mt-4 text-sm text-zinc-600"><span className="font-bold text-zinc-800">Where:</span> {e.location}</p>
        )}
        {e.description ? (
          <div className="mt-4 max-h-72 overflow-y-auto rounded-xl bg-zinc-50 px-4 py-3.5">
            <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-zinc-700">{e.description}</p>
          </div>
        ) : !e.location && (
          <p className="mt-4 text-sm text-zinc-400">No extra details on this one — check the calendar invite.</p>
        )}
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">
          Close
        </button>
      </div>
    </div>
  );
}

// ── Quick Links ───────────────────────────────────────────────────────────────
// Admin-managed pills below the cards. kind = link opens the site in a new
// tab; kind = panel opens a clean pop-over with contact lines + sub-links
// (the Coke Support pattern). Managed from Admin → Command Center Links.
function QuickLinks({ links }: { links: NonNullable<PortalSnapshot["quick_links"]> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ label: string; url: string } | null>(null);
  const open = links.find((l) => l.id === openId) ?? null;

  return (
    <section className="mx-auto max-w-6xl px-6 pb-14">
      <h2 className="mb-4 text-xl font-bold text-zinc-900">Quick Links</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => {
          const inner = (
            <>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-xl">
                {l.emoji || "🔗"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-zinc-900">{l.label}</span>
                {l.description && <span className="mt-0.5 block text-[13px] leading-snug text-zinc-500">{l.description}</span>}
              </span>
              {l.kind === "link" && l.url && <QrButton onClick={() => setQr({ label: l.label, url: l.url! })} />}
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" />
            </>
          );
          const cls = "flex w-full items-center gap-3.5 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-red-300 hover:shadow";
          return l.kind === "link" && l.url ? (
            <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
          ) : (
            <button key={l.id} onClick={() => setOpenId(l.id)} className={cls}>{inner}</button>
          );
        })}
      </div>
      {open && open.panel && <LinkPanel link={open} onClose={() => setOpenId(null)} />}
      {qr && <LinkQrModal label={qr.label} url={qr.url} onClose={() => setQr(null)} />}
    </section>
  );
}

// Small QR trigger that lives inside a clickable pill/row: stops the parent
// link from firing and pops the scan-to-phone modal instead.
function QrButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title="Show QR code to open on a phone"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-red-300 hover:text-red-600">
      <QrCode className="h-4 w-4" />
    </button>
  );
}

// Scan-to-phone modal for any link: the store screen is a desktop, so a QR
// hands the URL to whoever is standing in front of it.
function LinkQrModal({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [url]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-zinc-900">Scan with your phone</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-1 text-left text-sm text-zinc-500">Opens <strong className="text-zinc-700">{label}</strong> on your phone.</p>
        {src
          ? <img src={src} alt={`QR code for ${label}`} className="mx-auto mt-4 h-[260px] w-[260px] rounded-xl border border-zinc-200" />
          : <div className="mx-auto mt-4 grid h-[260px] w-[260px] place-items-center rounded-xl border border-zinc-200 text-sm text-zinc-400">Generating…</div>}
        <p className="mt-3 break-all text-xs text-zinc-400">{url}</p>
        <a href={url} target="_blank" rel="noreferrer"
          className="mt-4 block w-full rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-700 transition hover:border-red-300">
          Open on this screen instead
        </a>
        <button onClick={onClose} className="mt-2 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">
          Done
        </button>
      </div>
    </div>
  );
}

function LinkPanel({ link, onClose }: { link: NonNullable<PortalSnapshot["quick_links"]>[number]; onClose: () => void }) {
  const p = link.panel!;
  const items = panelItems(p);
  const [qr, setQr] = useState<{ label: string; url: string } | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-100 text-2xl">{link.emoji || "🔗"}</span>
            <div>
              <h2 className="text-lg font-extrabold text-zinc-900">{link.label}</h2>
              {p.subtitle && <p className="text-sm text-zinc-500">{p.subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>

        {p.lines.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5 rounded-xl bg-zinc-50 px-4 py-3">
            {p.lines.map((line, i) => (
              <p key={i} className="text-[15px] leading-snug text-zinc-700">{line}</p>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {items.map((it, i) => {
              if (it.type === "info") {
                return (
                  <div key={i} className="rounded-xl bg-zinc-50 px-4 py-3">
                    <span className="block text-[15px] font-bold text-zinc-900">{it.label}</span>
                    {it.body && <span className="mt-0.5 block whitespace-pre-line text-[13px] leading-snug text-zinc-600">{it.body}</span>}
                  </div>
                );
              }
              if (it.type === "doc") {
                return (
                  <a key={i} href={it.file_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 transition hover:border-red-300 hover:shadow-sm">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600"><FileText className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[15px] font-bold text-zinc-900">{it.label}</span>
                      <span className="mt-0.5 block truncate text-[13px] leading-snug text-zinc-500">{it.description || it.file_name || "Open document"}</span>
                    </span>
                    <QrButton onClick={() => setQr({ label: it.label, url: it.file_url })} />
                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" />
                  </a>
                );
              }
              return (
                <a key={i} href={it.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 transition hover:border-red-300 hover:shadow-sm">
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[15px] font-bold text-zinc-900">{it.label}</span>
                    {it.description && <span className="mt-0.5 block text-[13px] leading-snug text-zinc-500">{it.description}</span>}
                  </span>
                  <QrButton onClick={() => setQr({ label: it.label, url: it.url })} />
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" />
                </a>
              );
            })}
          </div>
        )}
        {qr && <LinkQrModal label={qr.label} url={qr.url} onClose={() => setQr(null)} />}

        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">
          Back to Command Center
        </button>
      </div>
    </div>
  );
}

// ── Make the Right Call ───────────────────────────────────────────────────────
const SLOT_TITLE: Record<string, string> = {
  GM: "General Manager",
  DO: "Director of Operations",
  SDO: "Senior Director of Operations",
  RVP: "Regional VP",
};

// token present = the store screen (compose enabled). The admin live view
// passes no token, so it shows the sheet read-only.
export function RightCallSheet({ contacts, token, onClose }: {
  contacts: PortalSnapshot["contacts"]; token?: string; onClose: () => void;
}) {
  const [composeSlot, setComposeSlot] = useState<string | null>(null);
  const [vcardSlot, setVcardSlot] = useState<string | null>(null);
  const target = contacts.find((c) => c.slot === composeSlot) ?? null;
  const vcardTarget = contacts.find((c) => c.slot === vcardSlot) ?? null;

  if (token && target) {
    return (
      <LeaderCompose token={token} contact={target} onBack={() => setComposeSlot(null)} onClose={onClose} />
    );
  }
  if (vcardTarget) {
    return <ContactQrModal contact={vcardTarget} onBack={() => setVcardSlot(null)} onClose={onClose} />;
  }
  return (
    <Modal onClose={onClose} title="Make the Right Call" icon={<PhoneCall className="h-5 w-5 text-red-600" />}>
      <p className="text-sm text-zinc-500">
        Start at the top. Message them on Chat — it lands on their phone. The number is there if you need to dial from yours.
      </p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {contacts.length === 0 && <li className="text-sm text-zinc-400">No contacts on file — ask your GM.</li>}
        {contacts.map((c) => (
          <li key={c.slot} className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3">
            <span className="grid h-9 w-14 shrink-0 place-items-center rounded-lg bg-zinc-100 text-xs font-extrabold text-zinc-600">{c.slot}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold text-zinc-900">{c.name ?? "—"}</div>
              <div className="text-xs font-medium text-zinc-500">{SLOT_TITLE[c.slot] ?? c.slot}</div>
              <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", c.phone ? "text-zinc-700" : "font-normal text-zinc-400")}>
                {c.phone ? formatPhoneForDisplay(c.phone) : "No phone on file"}
              </div>
            </div>
            {c.name && (c.phone || c.email) && (
              <button onClick={() => setVcardSlot(c.slot)} title="Scan to save this contact on your phone"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-red-300 hover:text-red-600">
                <QrCode className="h-5 w-5" />
              </button>
            )}
            {token && (
              <button onClick={() => setComposeSlot(c.slot)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700">
                <MessageSquare className="h-4 w-4" /> Message
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// Scan-to-save contact card. The QR encodes the vCard itself — phone cameras
// recognize it and offer "Add to Contacts" on the spot, no download needed.
const vcEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (m) => `\\${m}`);
function buildVCard(c: PortalSnapshot["contacts"][number]): string {
  const name = (c.name ?? "").trim();
  const parts = name.split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vcEscape(last)};${vcEscape(first)};;;`,
    `FN:${vcEscape(name)}`,
    `TITLE:${vcEscape(SLOT_TITLE[c.slot] ?? c.slot)}`,
    "ORG:SOAR",
  ];
  if (c.phone) lines.push(`TEL;TYPE=CELL:${c.phone}`);
  if (c.email) lines.push(`EMAIL:${vcEscape(c.email)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function ContactQrModal({ contact, onBack, onClose }: {
  contact: PortalSnapshot["contacts"][number]; onBack: () => void; onClose: () => void;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(buildVCard(contact), { width: 260, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [contact]);

  return (
    <Modal onClose={onClose} title="Save contact" icon={<QrCode className="h-5 w-5 text-red-600" />}>
      <p className="text-sm text-zinc-500">
        Point your phone camera at the code — it will offer to add{" "}
        <strong className="text-zinc-700">{contact.name}</strong> ({SLOT_TITLE[contact.slot] ?? contact.slot}) to your contacts.
      </p>
      {src
        ? <img src={src} alt={`QR code with contact card for ${contact.name}`} className="mx-auto mt-4 h-[260px] w-[260px] rounded-xl border border-zinc-200" />
        : <div className="mx-auto mt-4 grid h-[260px] w-[260px] place-items-center rounded-xl border border-zinc-200 text-sm text-zinc-400">Generating…</div>}
      <div className="mt-3 text-center text-sm text-zinc-500">
        {contact.phone && <div className="font-semibold tabular-nums text-zinc-700">{formatPhoneForDisplay(contact.phone)}</div>}
        {contact.email && <div className="break-all text-xs">{contact.email}</div>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onBack} className="rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-400">Back</button>
        <button onClick={onClose} className="rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">Done</button>
      </div>
    </Modal>
  );
}

function LeaderCompose({ token, contact, onBack, onClose }: {
  token: string; contact: PortalSnapshot["contacts"][number]; onBack: () => void; onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const send = useMutation({
    mutationFn: () => messagePortalLeader(token, { slot: contact.slot, message: message.trim(), reporter_name: name.trim() || undefined }),
  });

  if (send.isSuccess) {
    return (
      <Modal onClose={onClose} title="Message sent" icon={<Check className="h-5 w-5 text-emerald-600" />}>
        <p className="text-sm text-zinc-500">
          Sent to {contact.name ?? SLOT_TITLE[contact.slot] ?? contact.slot} on Chat. If it's urgent and they don't answer, dial{" "}
          {contact.phone ? <strong className="tabular-nums">{formatPhoneForDisplay(contact.phone)}</strong> : "their number"} from your phone.
        </p>
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">Done</button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title={`Message ${contact.name ?? contact.slot}`} icon={<MessageSquare className="h-5 w-5 text-red-600" />}>
      <p className="text-sm text-zinc-500">{SLOT_TITLE[contact.slot] ?? contact.slot} · arrives in their SOAR Chat</p>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} autoFocus
        placeholder="What do they need to know?"
        className="mt-3 w-full resize-none rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
        className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none" />
      {send.isError && <p className="mt-2 text-sm font-medium text-red-600">{(send.error as Error)?.message ?? "Could not send — try again."}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onBack} className="rounded-xl border border-zinc-200 py-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-400">Back</button>
        <button disabled={!message.trim() || send.isPending} onClick={() => send.mutate()}
          className="rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 disabled:opacity-40">
          {send.isPending ? "Sending…" : "Send"}
        </button>
      </div>
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

export function ReportSheet({ access, onClose }: { access: import("./api").PortalAccess; onClose: () => void }) {
  const [kind, setKind] = useState("issue");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const send = useMutation({
    mutationFn: () => sendPortalReport(access, { kind, message: message.trim(), reporter_name: name.trim() || undefined }),
  });

  if (send.isSuccess) {
    return (
      <Modal onClose={onClose} title="Sent to your GM" icon={<Check className="h-5 w-5 text-emerald-600" />}>
        <p className="text-sm text-zinc-500">
          Your report is in your GM's Inbox on SOAR. If it's urgent, use <strong>Make the Right Call</strong> too.
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

