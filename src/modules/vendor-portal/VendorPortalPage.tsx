// Public, anonymous vendor portal. Routed at /v/:token.
//
// Flow:
//   1. Resolve the token → show store name + a list of open tickets
//      at that store.
//   2. Vendor identifies themselves (name, company, phone). Saved
//      in localStorage so they don't retype on every visit.
//   3. Vendor picks a ticket → ticket detail screen.
//   4. From ticket detail: Mark On Site, Mark Completed, Submit Quote,
//      Upload Photo. Each routes through netlify/functions/vendor-portal.
//
// Designed for phone-first. Big buttons, full-screen layout, native
// inputs. No app, no login. The token IS the auth.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Loader2,
  Mail,
  MessageCircle,
  Package,
  Phone,
  ReceiptText,
  Send,
  Truck,
  Upload,
  X,
} from "lucide-react";

const FN = "/.netlify/functions/vendor-portal";

// ── Types mirroring the function's responses ─────────────────────

interface Identity {
  vendor_name: string;
  vendor_company: string;
  vendor_phone: string;
}

interface PortalTicket {
  id: string;
  wo_number: string;
  asset_type: string | null;
  category: string | null;
  issue_description: string | null;
  priority: string;
  vendor_name: string | null;
  status: string;
  pause_state: string;
  date_submitted: string;
}

interface PortalStore {
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
}

interface PortalDoContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface ResolveResponse {
  ok: true;
  store: PortalStore | null;
  do_contact: PortalDoContact | null;
  tokenLabel: string | null;
  tickets: PortalTicket[];
}

interface PortalTicketDetail extends PortalTicket {
  store_number: string;
  store_name: string | null;
  model_number: string | null;
  is_business_critical: boolean;
  vendor_eta: string | null;
  cost_estimate: number | string | null;
  approval_status: "Pending" | "Approved" | "Rejected" | null;
  approval_level: string | null;
  approval_request_notes: string | null;
  parts_ordered_by: "vendor" | "customer" | null;
  parts_ordered_notes: string | null;
  parts_ordered_at: string | null;
  warranty_labor_days: number | null;
  warranty_parts_days: number | null;
  warranty_parts_source: "vendor" | "manufacturer" | "none" | null;
  warranty_starts_at: string | null;
  warranty_notes: string | null;
  troubleshooting_checked: boolean;
  closed_at: string | null;
  ticket_photos?: Array<{
    id: string;
    file_url: string;
    file_name: string | null;
    upload_type: string | null;
    created_at: string;
  }>;
}

// ── localStorage helpers ─────────────────────────────────────────

const IDENT_KEY = "vendor-portal:identity";

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.vendor_name) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveIdentity(id: Identity) {
  try { localStorage.setItem(IDENT_KEY, JSON.stringify(id)); } catch {}
}

// ── Fetch helpers ────────────────────────────────────────────────

// Carries the full response payload through the thrown Error so the
// page can render debug fields (like the store-number mismatch
// values returned by the backend on ticket_not_at_this_store).
class PortalError extends Error {
  payload: Record<string, unknown>;
  constructor(message: string, payload: Record<string, unknown>) {
    super(message);
    this.payload = payload;
  }
}

function readableError(json: Record<string, unknown>, fallback: string): string {
  const msg = (json.message as string | undefined) || (json.error as string | undefined);
  if (!msg) return fallback;
  const debug = json.debug as Record<string, string | number> | undefined;
  if (!debug) return msg;
  const pairs = Object.entries(debug).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${msg} (${pairs})`;
}

async function postPortal<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || (json as { ok?: boolean }).ok === false) {
    throw new PortalError(readableError(json, `HTTP ${res.status}`), json);
  }
  return json as T;
}

async function getPortal<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || (json as { ok?: boolean }).ok === false) {
    throw new PortalError(readableError(json, `HTTP ${res.status}`), json);
  }
  return json as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result || "");
      const idx = r.indexOf(",");
      resolve(idx >= 0 ? r.slice(idx + 1) : r);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

// Lightweight phone formatter (no external dependency — we don't pull
// the auth-coupled helper from @/lib/phone into this public page).
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function relTime(iso: string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Main component ───────────────────────────────────────────────

export function VendorPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const resolveQ = useQuery({
    queryKey: ["vendor-portal-resolve", token],
    queryFn: () => getPortal<ResolveResponse>(`${FN}?action=resolve&token=${encodeURIComponent(token || "")}`),
    enabled: !!token,
    staleTime: 30_000,
  });

  if (!token) return <Frame><BadToken /></Frame>;

  if (resolveQ.isLoading) {
    return <Frame><LoadingScreen label="Looking up your store…" /></Frame>;
  }
  if (resolveQ.isError) {
    return <Frame><BadToken message={(resolveQ.error as Error)?.message} /></Frame>;
  }
  if (!resolveQ.data?.store) {
    return <Frame><BadToken /></Frame>;
  }

  const { store, tickets, tokenLabel, do_contact: doContact } = resolveQ.data;

  // Companies that have open tickets at THIS store. Powers the
  // identity-form dropdown so a vendor doesn't have to type their
  // own name — they pick from the list of who's actually been
  // assigned work here today. Sorted by ticket count desc.
  const vendorOptions = (() => {
    const map = new Map<string, number>();
    for (const t of tickets) {
      const name = (t.vendor_name || "").trim();
      if (name) map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // Identity collection guard — needed once per device.
  if (!identity) {
    return (
      <Frame>
        <IdentityForm
          store={store}
          vendorOptions={vendorOptions}
          totalOpenTickets={tickets.length}
          onSave={(id) => { saveIdentity(id); setIdentity(id); }}
        />
      </Frame>
    );
  }

  // Ticket detail screen.
  if (selectedTicketId) {
    return (
      <Frame>
        <TicketDetailScreen
          token={token}
          ticketId={selectedTicketId}
          identity={identity}
          onBack={() => setSelectedTicketId(null)}
          onIdentityChange={() => {
            saveIdentity({ vendor_name: "", vendor_company: "", vendor_phone: "" });
            setIdentity(null);
          }}
        />
      </Frame>
    );
  }

  // Ticket list.
  return (
    <Frame>
      <TicketList
        store={store}
        tokenLabel={tokenLabel}
        tickets={tickets}
        identity={identity}
        doContact={doContact}
        onPick={(id) => setSelectedTicketId(id)}
        onIdentityChange={() => {
          localStorage.removeItem(IDENT_KEY);
          setIdentity(null);
        }}
      />
    </Frame>
  );
}

// ── UI primitives ────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-midnight">
          <Truck className="h-5 w-5 text-accent" strokeWidth={2} />
          SOAR Vendor Portal
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4 pb-24">{children}</main>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 pt-20 text-zinc-500">
      <Loader2 className="h-6 w-6 animate-spin" />
      <div className="text-sm">{label}</div>
    </div>
  );
}

function BadToken({ message }: { message?: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-500" strokeWidth={1.75} />
      <div className="mt-2 text-base font-semibold text-red-900">QR code not active</div>
      <div className="mt-1 text-sm text-red-800">
        {message || "This QR code is invalid, expired, or has been revoked. Ask the store manager for a new sticker, or call the District Operator who dispatched you."}
      </div>
    </div>
  );
}

// ── Identity form ────────────────────────────────────────────────

function IdentityForm({
  store,
  vendorOptions,
  totalOpenTickets,
  onSave,
}: {
  store: PortalStore;
  vendorOptions: { name: string; count: number }[];
  totalOpenTickets: number;
  onSave: (id: Identity) => void;
}) {
  const [name, setName] = useState("");
  // Two-step company picker: pick from the list of vendors with
  // open tickets at this store, or pick "other" → type free-text.
  // Saves a typed-vs-picked round trip when the tech is in the list.
  const [companyChoice, setCompanyChoice] = useState<string>(
    vendorOptions.length > 0 ? vendorOptions[0].name : "__other__"
  );
  const [companyOther, setCompanyOther] = useState("");
  const [phone, setPhone] = useState("");

  const resolvedCompany = companyChoice === "__other__"
    ? companyOther.trim()
    : companyChoice;

  // How many open WOs are waiting for the currently-selected company.
  // Drives the green "we see your work order" / amber "no WOs for you"
  // status row right under the company picker.
  const selectedCompanyCount = companyChoice === "__other__"
    ? 0
    : (vendorOptions.find((v) => v.name === companyChoice)?.count ?? 0);

  const ok = name.trim().length >= 2 && (
    companyChoice !== "__other__" || companyOther.trim().length >= 2
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">You're at</div>
        <div className="mt-0.5 font-semibold text-midnight">Store {store.number}</div>
        {(store.city || store.state) && (
          <div className="text-xs text-zinc-500">
            {[store.city, store.state].filter(Boolean).join(", ")}
          </div>
        )}
        {/* At-a-glance: does this store have any open work right now? */}
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700">
          {totalOpenTickets > 0 ? (
            <>
              <ClipboardList className="h-3 w-3" strokeWidth={2} />
              {totalOpenTickets} open work order{totalOpenTickets === 1 ? "" : "s"} at this store
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3 text-amber-700" strokeWidth={2} />
              No open work orders at this store
            </>
          )}
        </div>
      </div>
      <div className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="text-base font-semibold tracking-tight text-midnight">
          Tell us who's here
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          One-time setup, saved on this phone.
        </div>
        <div className="mt-3 space-y-3">
          <Field label="Company *">
            {vendorOptions.length > 0 ? (
              <>
                <select
                  value={companyChoice}
                  onChange={(e) => setCompanyChoice(e.target.value)}
                  className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <optgroup label="Assigned at this store today">
                    {vendorOptions.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.count} {v.count === 1 ? "ticket" : "tickets"})
                      </option>
                    ))}
                  </optgroup>
                  <option value="__other__">Other / not listed</option>
                </select>
                {companyChoice === "__other__" && (
                  <input
                    type="text" autoComplete="organization"
                    value={companyOther}
                    onChange={(e) => setCompanyOther(e.target.value)}
                    placeholder="Type your company name"
                    className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                )}
                {/* Per-company status row — answers "is there a WO
                    waiting for me?" before they even continue. */}
                {companyChoice !== "__other__" && selectedCompanyCount > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900">
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                    {selectedCompanyCount} work order{selectedCompanyCount === 1 ? "" : "s"} waiting for {companyChoice}
                  </div>
                )}
                {companyChoice === "__other__" && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900">
                    <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                    If your work order isn't in the list, check in with the Manager on Duty.
                  </div>
                )}
                <div className="mt-1 text-[10px] text-zinc-500">
                  Pick the company that dispatched you. We'll show only your tickets first.
                </div>
              </>
            ) : (
              <input
                type="text" autoComplete="organization"
                value={companyOther}
                onChange={(e) => setCompanyOther(e.target.value)}
                placeholder="Smith HVAC"
                className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            )}
          </Field>
          <Field label="Your name *">
            <input
              type="text" autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="John Smith"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </Field>
          <Field label="Phone (for callback)">
            <input
              type="tel" autoComplete="tel" inputMode="tel"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </Field>
          <BigButton
            disabled={!ok}
            onClick={() => onSave({
              vendor_name: name.trim(),
              vendor_company: resolvedCompany,
              vendor_phone: phone.trim(),
            })}
          >
            Continue
          </BigButton>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function BigButton({
  children, onClick, disabled, tone = "primary", icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "ghost" | "danger" | "success";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "primary" ? "bg-accent text-white hover:bg-accent/90" :
    tone === "success" ? "bg-emerald-600 text-white hover:bg-emerald-700" :
    tone === "danger"  ? "bg-red-600 text-white hover:bg-red-700" :
                         "border border-zinc-300 bg-white text-midnight hover:bg-zinc-50";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={
        "flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-base font-semibold tracking-tight transition disabled:opacity-50 " +
        toneCls
      }
    >
      {icon}
      {children}
    </button>
  );
}

// ── Ticket list screen ───────────────────────────────────────────

function TicketList({
  store, tokenLabel, tickets, identity, doContact, onPick, onIdentityChange,
}: {
  store: PortalStore;
  tokenLabel: string | null;
  tickets: PortalTicket[];
  identity: Identity;
  doContact: PortalDoContact | null;
  onPick: (id: string) => void;
  onIdentityChange: () => void;
}) {
  // Filter mode toggle. Default: filter by vendor_company match
  // (case-insensitive substring both directions, so "Frostex"
  // matches "Frostex Refrigeration" and vice versa). Vendor can
  // flip to "Show all" if their assignment isn't in the list.
  const [showAll, setShowAll] = useState(false);
  const needle = identity.vendor_company?.toLowerCase().trim() || "";
  const matches = needle
    ? tickets.filter((t) => {
        const v = (t.vendor_name || "").toLowerCase().trim();
        if (!v) return false;
        return v.includes(needle) || needle.includes(v);
      })
    : [];
  const visibleTickets = showAll || !needle ? tickets : matches;
  const showAllToggle = needle && tickets.length > matches.length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-zinc-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Store</div>
            <div className="text-base font-semibold text-midnight">
              {store.number}{store.name ? ` — ${store.name}` : ""}
            </div>
            {(store.city || store.state) && (
              <div className="text-xs text-zinc-500">
                {[store.city, store.state].filter(Boolean).join(", ")}
              </div>
            )}
            {tokenLabel && (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
                {tokenLabel}
              </div>
            )}
          </div>
          <div className="text-right text-[11px] text-zinc-500">
            <div>{identity.vendor_name}</div>
            {identity.vendor_company && <div>{identity.vendor_company}</div>}
            <button
              type="button" onClick={onIdentityChange}
              className="mt-1 text-[10px] text-accent underline"
            >
              Not me
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-midnight">
          {needle && !showAll
            ? `Tickets for ${identity.vendor_company}`
            : "Open tickets at this store"}
        </div>
        {showAllToggle && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {showAll
              ? `Show only ${identity.vendor_company} (${matches.length})`
              : `Show all open (${tickets.length})`}
          </button>
        )}
      </div>

      {needle && !showAll && matches.length === 0 && tickets.length > 0 && (
        <NoTicketsPanel
          kind="none-for-company"
          companyName={identity.vendor_company}
          store={store}
          doContact={doContact}
          onShowAll={() => setShowAll(true)}
          showAllCount={tickets.length}
        />
      )}

      {tickets.length === 0 ? (
        <NoTicketsPanel
          kind="none-at-all"
          companyName={identity.vendor_company}
          store={store}
          doContact={doContact}
        />
      ) : visibleTickets.length === 0 ? null : (
        <ul className="space-y-2">
          {visibleTickets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t.id)}
                className="block w-full rounded-md border border-zinc-200 bg-white p-3 text-left hover:border-accent hover:bg-accent/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">{t.wo_number}</span>
                  <PriorityBadge p={t.priority} />
                </div>
                <div className="mt-0.5 text-base font-semibold text-midnight">
                  {t.asset_type || t.category || "Service Request"}
                </div>
                {t.issue_description && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-zinc-700">
                    {t.issue_description}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Status: {humanStatus(t.status, t.pause_state)}</span>
                  <span>{relTime(t.date_submitted)}</span>
                </div>
                {t.vendor_name && (
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    Assigned to: {t.vendor_name}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriorityBadge({ p }: { p: string }) {
  const tone =
    p === "Emergency" ? "bg-red-100 text-red-900" :
    p === "Urgent"    ? "bg-amber-100 text-amber-900" :
                        "bg-zinc-100 text-zinc-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {p}
    </span>
  );
}

// ── No-tickets escalation panel ─────────────────────────────────
// Shown when either:
//   "none-at-all"      → the store has zero open tickets
//   "none-for-company" → caller's vendor_company doesn't match any
//                        ticket assignment; suggests Show All as
//                        the inline alternative + escalation contact.
//
// Provides Manager-on-Duty messaging + click-to-call/email for the
// DO so the vendor isn't sent home empty-handed.

function NoTicketsPanel({
  kind, companyName, store, doContact, onShowAll, showAllCount,
}: {
  kind: "none-at-all" | "none-for-company";
  companyName?: string;
  store: PortalStore;
  doContact: PortalDoContact | null;
  onShowAll?: () => void;
  showAllCount?: number;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="text-base font-semibold text-amber-900">
        {kind === "none-at-all"
          ? "No open tickets at this store"
          : <>No open tickets for <span className="underline decoration-amber-400">{companyName}</span></>}
      </div>
      <div className="mt-1 text-sm text-amber-900">
        Please speak with the <strong>Manager on Duty</strong> so they can submit
        the ticket. Once it's in the system you'll see it here.
      </div>

      {store.phone && (
        <a
          href={`tel:${store.phone}`}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          <Phone className="h-4 w-4" strokeWidth={1.75} />
          Call this store: {formatPhone(store.phone)}
        </a>
      )}

      {kind === "none-for-company" && onShowAll && showAllCount ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onShowAll}
            className="text-xs font-medium text-accent underline"
          >
            Show all {showAllCount} open ticket{showAllCount === 1 ? "" : "s"} at this store
          </button>
        </div>
      ) : null}

      {doContact && (doContact.name || doContact.phone || doContact.email) && (
        <div className="mt-4 border-t border-amber-200 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
            For escalation, contact the District Operator
          </div>
          {doContact.name && (
            <div className="mt-1 text-sm font-medium text-amber-900">{doContact.name}</div>
          )}
          <div className="mt-1 flex flex-col gap-1">
            {doContact.phone && (
              <a
                href={`tel:${doContact.phone}`}
                className="inline-flex items-center gap-2 text-sm text-accent underline"
              >
                <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
                {formatPhone(doContact.phone)}
              </a>
            )}
            {doContact.email && (
              <a
                href={`mailto:${doContact.email}`}
                className="inline-flex items-center gap-2 break-all text-sm text-accent underline"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                {doContact.email}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function humanStatus(s: string, pause: string): string {
  if (s === "in_progress" && pause && pause !== "none") {
    if (pause === "on_hold")              return "In Progress · On Hold";
    if (pause === "awaiting_parts")       return "In Progress · Awaiting Parts";
    if (pause === "awaiting_replacement") return "In Progress · Awaiting Replacement";
  }
  switch (s) {
    case "submitted":   return "Submitted";
    case "in_progress": return "In Progress";
    case "scheduled":   return "Scheduled";
    case "on_site":     return "On Site";
    case "completed":   return "Completed";
    case "closed":      return "Closed";
    case "cancelled":   return "Cancelled";
    default:            return s;
  }
}

// ── Ticket detail screen + actions ───────────────────────────────

function TicketDetailScreen({
  token, ticketId, identity, onBack, onIdentityChange,
}: {
  token: string;
  ticketId: string;
  identity: Identity;
  onBack: () => void;
  onIdentityChange: () => void;
}) {
  const qc = useQueryClient();
  // While a quote is pending approval, poll every 8 seconds so a DO
  // approval or rejection lands on the vendor's phone within a few
  // beats. Once the approval resolves (Approved/Rejected), polling
  // stops automatically — no need to hammer the API after that.
  const ticketQ = useQuery({
    queryKey: ["vendor-portal-ticket", token, ticketId],
    queryFn: () => getPortal<{ ok: true; ticket: PortalTicketDetail }>(
      `${FN}?action=getTicket&token=${encodeURIComponent(token)}&ticketId=${encodeURIComponent(ticketId)}`,
    ),
    staleTime: 5_000,
    refetchInterval: (q: { state: { data?: { ticket?: PortalTicketDetail } } }) => {
      const status = q.state.data?.ticket?.approval_status;
      return status === "Pending" ? 8000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const [quoteOpen, setQuoteOpen] = useState(false);
  // Action confirmation sheet — replaces window.prompt() so the
  // dialog can't be suppressed by the browser. Holds the in-flight
  // action kind so the same component renders different copy +
  // routes to the right mutation on confirm.
  const [confirmAction, setConfirmAction] = useState<"on_site" | "completed" | null>(null);

  // Sticky alert that fires when the quote approval state transitions
  // from Pending → Approved/Rejected. The banner stays visible until
  // the vendor dismisses it. We track the previous status with a ref
  // so we only fire on the transition, not on every poll.
  const [approvalAlert, setApprovalAlert] = useState<"Approved" | "Rejected" | null>(null);
  const prevApprovalRef = useRef<string | null>(null);
  useEffect(() => {
    const current = ticketQ.data?.ticket?.approval_status ?? null;
    const prev = prevApprovalRef.current;
    if (prev === "Pending" && (current === "Approved" || current === "Rejected")) {
      setApprovalAlert(current);
    }
    prevApprovalRef.current = current;
  }, [ticketQ.data?.ticket?.approval_status]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["vendor-portal-resolve", token] });
    qc.invalidateQueries({ queryKey: ["vendor-portal-ticket", token, ticketId] });
  };

  const onSite = useMutation({
    mutationFn: (notes: string) => postPortal(`${FN}?action=markOnSite`, {
      token, ticketId, identity, notes: notes || undefined,
    }),
    onSuccess: invalidate,
  });
  const completed = useMutation({
    mutationFn: ({ notes, resolution_category }: { notes: string; resolution_category: string }) =>
      postPortal(`${FN}?action=markCompleted`, {
        token, ticketId, identity,
        notes: notes || undefined,
        resolution_category: resolution_category || undefined,
      }),
    onSuccess: invalidate,
  });
  const photo = useMutation({
    mutationFn: async ({ file, label }: { file: File; label: string }) => {
      const photoData = await fileToBase64(file);
      return postPortal(`${FN}?action=uploadPhoto`, {
        token, ticketId, identity,
        photoData, photoType: file.type, photoName: file.name, label,
      });
    },
    onSuccess: invalidate,
  });

  // Parts-on-order sheet. Opens when the vendor taps "Parts on order"
  // and asks who's responsible for ordering them.
  const [partsOpen, setPartsOpen] = useState(false);
  const partsOnOrder = useMutation({
    mutationFn: (args: { ordered_by: "vendor" | "customer"; notes: string }) =>
      postPortal(`${FN}?action=markPartsOnOrder`, {
        token, ticketId, identity,
        ordered_by: args.ordered_by,
        notes:      args.notes || undefined,
      }),
    onSuccess: invalidate,
  });

  if (ticketQ.isLoading) return <LoadingScreen label="Loading ticket…" />;
  if (ticketQ.isError || !ticketQ.data?.ticket) {
    return (
      <div className="space-y-3">
        <BackButton onClick={onBack} />
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {(ticketQ.error as Error)?.message || "Could not load this ticket."}
        </div>
      </div>
    );
  }
  const ticket = ticketQ.data.ticket;
  const terminal = ticket.status === "closed" || ticket.status === "cancelled";
  const alreadyOnSite = ticket.status === "on_site" || ticket.status === "completed";
  const alreadyDone = ticket.status === "completed";

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />

      {approvalAlert && (
        <ApprovalAlertBanner
          decision={approvalAlert}
          amount={ticket.cost_estimate}
          onDismiss={() => setApprovalAlert(null)}
        />
      )}

      {ticket.pause_state === "awaiting_parts" && (
        <PartsOnOrderBanner
          orderedBy={ticket.parts_ordered_by}
          notes={ticket.parts_ordered_notes}
          orderedAt={ticket.parts_ordered_at}
        />
      )}

      {ticket.warranty_starts_at && (
        (ticket.warranty_labor_days != null || ticket.warranty_parts_days != null) && (
          <WarrantyBanner
            startsAt={ticket.warranty_starts_at}
            laborDays={ticket.warranty_labor_days}
            partsDays={ticket.warranty_parts_days}
            partsSource={ticket.warranty_parts_source}
            notes={ticket.warranty_notes}
          />
        )
      )}

      <div className="rounded-md border border-zinc-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-zinc-500">{ticket.wo_number}</span>
          <PriorityBadge p={ticket.priority} />
        </div>
        <div className="mt-1 text-lg font-semibold text-midnight">
          {ticket.asset_type || ticket.category || "Service Request"}
        </div>
        {ticket.model_number && (
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            Model: <span className="font-mono text-zinc-700">{ticket.model_number}</span>
          </div>
        )}
        {ticket.is_business_critical && (
          <div className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900">
            Business Critical
          </div>
        )}
        <div className="mt-2 text-[11px] text-zinc-500">
          Status: {humanStatus(ticket.status, ticket.pause_state)}
        </div>
      </div>

      {ticket.issue_description && (
        <div className="rounded-md border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Issue</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-midnight">
            {ticket.issue_description}
          </div>
        </div>
      )}

      {ticket.troubleshooting_checked && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ✓ Store confirmed they ran the standard troubleshooting steps before
          calling.
        </div>
      )}

      {!!ticket.ticket_photos?.length && (
        <div className="rounded-md border border-zinc-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Photos from the store
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ticket.ticket_photos.map((p) => (
              <a
                key={p.id} href={p.file_url} target="_blank" rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-100"
              >
                {p.file_name?.toLowerCase().endsWith(".pdf") ? (
                  <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">PDF</div>
                ) : (
                  <img
                    src={p.file_url} alt={p.file_name || ""}
                    className="h-full w-full object-cover"
                  />
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!terminal && (
        <div className="space-y-3">
          {!alreadyOnSite && (
            <BigButton
              tone="primary" icon={<Truck className="h-5 w-5" strokeWidth={2} />}
              onClick={() => setConfirmAction("on_site")}
              disabled={onSite.isPending}
            >
              {onSite.isPending ? "Marking…" : "I'm on site"}
            </BigButton>
          )}
          {!alreadyDone && (
            <BigButton
              tone="success" icon={<CheckCircle2 className="h-5 w-5" strokeWidth={2} />}
              onClick={() => setConfirmAction("completed")}
              disabled={completed.isPending}
            >
              {completed.isPending ? "Marking…" : "Work completed"}
            </BigButton>
          )}
          <QuoteButton
            approvalStatus={ticket.approval_status}
            costEstimate={ticket.cost_estimate}
            approvalLevel={ticket.approval_level}
            onSubmit={() => setQuoteOpen(true)}
          />

          <BigButton
            tone="ghost" icon={<Package className="h-5 w-5" strokeWidth={2} />}
            onClick={() => setPartsOpen(true)}
            disabled={partsOnOrder.isPending}
          >
            {ticket.pause_state === "awaiting_parts"
              ? "Update parts order"
              : "Parts on order"}
          </BigButton>

          <PhotoButton
            onPick={(file, label) => photo.mutate({ file, label })}
            pending={photo.isPending}
          />
        </div>
      )}

      {terminal && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
          This ticket is {ticket.status}. No further vendor actions are possible.
          If you believe this is wrong, contact the District Operator.
        </div>
      )}

      {/* Vendor chat thread — small panel at the bottom of the
          ticket detail so the vendor can message the DO/GM without
          leaving the page. Polls every 15s while the ticket is open
          so a reply from the store side lands quickly. */}
      <VendorChatPanel token={token} ticketId={ticketId} identity={identity} />

      <div className="mt-6 text-center text-[11px] text-zinc-400">
        Logged in as <strong>{identity.vendor_name}</strong>
        {identity.vendor_company && ` · ${identity.vendor_company}`}
        {" · "}
        <button type="button" onClick={onIdentityChange} className="underline">change</button>
      </div>

      {quoteOpen && (
        <QuoteModal
          token={token}
          ticketId={ticketId}
          identity={identity}
          onClose={() => setQuoteOpen(false)}
          onSubmitted={() => { setQuoteOpen(false); invalidate(); }}
        />
      )}

      {partsOpen && (
        <PartsOnOrderSheet
          existing={
            ticket.pause_state === "awaiting_parts"
              ? {
                  ordered_by: ticket.parts_ordered_by,
                  notes:      ticket.parts_ordered_notes,
                }
              : null
          }
          submitting={partsOnOrder.isPending}
          onClose={() => setPartsOpen(false)}
          onConfirm={async (args) => {
            try {
              await partsOnOrder.mutateAsync(args);
              setPartsOpen(false);
            } catch {
              // error surfaces in the sheet's error region
            }
          }}
          errorMessage={partsOnOrder.error instanceof Error ? partsOnOrder.error.message : null}
        />
      )}

      {confirmAction && (
        <ActionConfirmSheet
          kind={confirmAction}
          submitting={onSite.isPending || completed.isPending}
          onClose={() => setConfirmAction(null)}
          onConfirm={async (notes) => {
            try {
              if (confirmAction === "on_site") {
                await onSite.mutateAsync(notes);
              } else {
                await completed.mutateAsync({ notes, resolution_category: "repaired" });
              }
              setConfirmAction(null);
            } catch {
              // error surfaces in the sheet's error region
            }
          }}
        />
      )}
    </div>
  );
}

// Parts-on-order sheet. Asks the vendor who's responsible for
// ordering the parts (vendor or customer/us) and an optional note
// for part numbers, expected arrival, vendor's PO, etc. Submits to
// markPartsOnOrder which parks the ticket in
// in_progress / awaiting_parts with the metadata attached.
//
// If the ticket is ALREADY in awaiting_parts, this sheet acts as
// an editor — pre-fills with the current values so the vendor can
// update (e.g., "started as vendor, customer is taking over").
function PartsOnOrderSheet({
  existing, submitting, errorMessage, onClose, onConfirm,
}: {
  existing: { ordered_by: "vendor" | "customer" | null; notes: string | null } | null;
  submitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (args: { ordered_by: "vendor" | "customer"; notes: string }) => void | Promise<void>;
}) {
  const [orderedBy, setOrderedBy] = useState<"vendor" | "customer" | "">(
    existing?.ordered_by ?? "",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = orderedBy === "vendor" || orderedBy === "customer";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="w-full max-w-md rounded-t-xl bg-white shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold text-midnight">
            {existing ? "Update parts order" : "Parts on order"}
          </div>
          <button
            type="button" onClick={onClose} disabled={submitting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-zinc-700">
            We'll mark this ticket as <strong>awaiting parts</strong> so the
            store and DO know the work is paused. Tell us who's responsible
            for ordering them.
          </p>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 hover:border-accent">
              <input
                type="radio" name="parts-by"
                checked={orderedBy === "vendor"}
                onChange={() => setOrderedBy("vendor")}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-midnight">
                  Vendor will order
                </div>
                <div className="text-[11px] text-zinc-500">
                  You'll source the parts from your supplier and return to
                  finish the work.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 hover:border-accent">
              <input
                type="radio" name="parts-by"
                checked={orderedBy === "customer"}
                onChange={() => setOrderedBy("customer")}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-midnight">
                  Customer will order
                </div>
                <div className="text-[11px] text-zinc-500">
                  We'll source the parts. We'll contact you when they arrive.
                </div>
              </div>
            </label>
          </div>
          <div>
            <span className="text-xs font-medium text-zinc-600">
              Parts / expected arrival (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder='e.g. "Compressor relay #ABC-123, ETA Wed"'
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-1 text-[10px] text-zinc-500">
              Part numbers, your PO, expected arrival — anything that helps
              the next person who picks this up.
            </div>
          </div>
          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {errorMessage}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3">
          <BigButton
            tone="primary"
            icon={<Package className="h-5 w-5" strokeWidth={2} />}
            disabled={!valid || submitting}
            onClick={() => {
              if (!valid) return;
              onConfirm({ ordered_by: orderedBy as "vendor" | "customer", notes: notes.trim() });
            }}
          >
            {submitting
              ? "Saving…"
              : existing
                ? "Update parts order"
                : "Mark parts on order"}
          </BigButton>
          <button
            type="button" onClick={onClose} disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Mobile-first bottom sheet that replaces window.prompt() for the
// On-Site and Completed actions. Browsers can't suppress this; we
// render it in our own DOM. Optional notes field, large confirm
// button, swipe-down close gesture not implemented (taps outside
// or Cancel button work fine for our needs).
function ActionConfirmSheet({
  kind, submitting, onConfirm, onClose,
}: {
  kind: "on_site" | "completed";
  submitting: boolean;
  onConfirm: (notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");

  const cfg = kind === "on_site"
    ? {
        title: "Mark as on site",
        body:  "Confirms you've arrived and started the work. The store and DO will be notified.",
        cta:   "Yes — I'm on site",
        tone:  "primary" as const,
        icon:  <Truck className="h-5 w-5" strokeWidth={2} />,
      }
    : {
        title: "Mark as completed",
        body:  "Confirms the work is done. The store will be asked to verify. You won't be able to undo this from here — call the DO if you need to reopen.",
        cta:   "Yes — work is complete",
        tone:  "success" as const,
        icon:  <CheckCircle2 className="h-5 w-5" strokeWidth={2} />,
      };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="w-full max-w-md rounded-t-xl bg-white shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold text-midnight">{cfg.title}</div>
          <button
            type="button" onClick={onClose} disabled={submitting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-zinc-700">{cfg.body}</p>
          <div>
            <span className="text-xs font-medium text-zinc-600">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={kind === "on_site"
                ? "Anything the store should know? (optional)"
                : "Brief description of the repair (optional)"}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3">
          <BigButton
            tone={cfg.tone}
            icon={cfg.icon}
            disabled={submitting}
            onClick={() => onConfirm(notes.trim())}
          >
            {submitting ? "Saving…" : cfg.cta}
          </BigButton>
          <button
            type="button" onClick={onClose} disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-accent"
    >
      <ChevronLeft className="h-4 w-4" strokeWidth={2} />
      Back to tickets
    </button>
  );
}

// ── Quote button (state-aware) ──────────────────────────────────
// Replaces the always-active "Submit a quote" button with a state
// machine driven by ticket.approval_status:
//   null      → "Submit a quote" (active)
//   Pending   → "Quote submitted — awaiting approval" (disabled,
//               with a spinner-like indicator)
//   Approved  → "✓ Quote approved" (disabled, green)
//   Rejected  → "Quote rejected — submit a new quote" (active, the
//               new submission will replace the prior pending row)

function QuoteButton({
  approvalStatus, costEstimate, approvalLevel, onSubmit,
}: {
  approvalStatus: PortalTicketDetail["approval_status"];
  costEstimate: PortalTicketDetail["cost_estimate"];
  approvalLevel: PortalTicketDetail["approval_level"];
  onSubmit: () => void;
}) {
  const amount = costEstimate != null && Number.isFinite(Number(costEstimate))
    ? `$${Number(costEstimate).toFixed(2)}`
    : null;

  if (approvalStatus === "Pending") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          Quote submitted — awaiting approval
        </div>
        <div className="mt-1 text-[11px] text-amber-800">
          {amount && approvalLevel
            ? `${amount} sent to ${approvalLevel} for review.`
            : "Sent for review."}
          {" "}You'll see the decision here as soon as it lands.
        </div>
      </div>
    );
  }
  if (approvalStatus === "Approved") {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
          Quote approved
        </div>
        <div className="mt-1 text-[11px] text-emerald-800">
          {amount ? `${amount} cleared.` : "Cleared."} Proceed with the work.
        </div>
      </div>
    );
  }
  if (approvalStatus === "Rejected") {
    return (
      <BigButton
        tone="ghost" icon={<ReceiptText className="h-5 w-5" strokeWidth={2} />}
        onClick={onSubmit}
      >
        Quote rejected — submit a new one
      </BigButton>
    );
  }
  return (
    <BigButton
      tone="ghost" icon={<ReceiptText className="h-5 w-5" strokeWidth={2} />}
      onClick={onSubmit}
    >
      Submit a quote
    </BigButton>
  );
}

// ── Vendor chat panel ──────────────────────────────────────────
// Small chat thread at the bottom of the ticket detail screen.
// Reads the `vendor` thread on ticket_messages and lets the vendor
// post new messages with their self-attested identity. Polls every
// 15s for new replies. Same thread is visible to staff via the WO2
// TicketChat "Vendor" tab.

interface VendorChatMessage {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  message: string;
  created_at: string;
}

function VendorChatPanel({
  token, ticketId, identity,
}: {
  token: string;
  ticketId: string;
  identity: Identity;
}) {
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");

  const msgsQ = useQuery({
    queryKey: ["vendor-portal-chat", token, ticketId],
    queryFn: () => getPortal<{ ok: true; messages: VendorChatMessage[] }>(
      `${FN}?action=getVendorMessages&token=${encodeURIComponent(token)}&ticketId=${encodeURIComponent(ticketId)}`,
    ),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgsQ.data]);

  const send = useMutation({
    mutationFn: (text: string) =>
      postPortal(`${FN}?action=sendVendorMessage`, {
        token, ticketId, identity, message: text,
      }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["vendor-portal-chat", token, ticketId] });
    },
  });

  const messages = msgsQ.data?.messages || [];

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    send.mutate(text);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="mt-6 rounded-md border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
          <MessageCircle className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
          Message the store
        </div>
        <div className="text-[10px] text-zinc-400">
          {msgsQ.isFetching ? "Refreshing…" : "Visible to the store + DO"}
        </div>
      </div>
      <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto p-3">
        {msgsQ.isLoading && (
          <div className="text-center text-xs text-zinc-500">Loading…</div>
        )}
        {!msgsQ.isLoading && messages.length === 0 && (
          <div className="text-center text-xs text-zinc-500">
            No messages yet. Drop a note if you need anything from the store.
          </div>
        )}
        {messages.map((m) => (
          <VendorChatBubble
            key={m.id}
            m={m}
            mine={m.user_role === "VENDOR" && (
              m.user_name === identity.vendor_company ||
              m.user_name === identity.vendor_name
            )}
          />
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-zinc-100 bg-zinc-50 px-2 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Type a message to the store / DO…"
          className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={send.isPending || !draft.trim()}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {send.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Send className="h-3.5 w-3.5" strokeWidth={1.75} />}
          Send
        </button>
      </div>
      {send.isError && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-900">
          {(send.error as Error).message}
        </div>
      )}
    </div>
  );
}

function VendorChatBubble({ m, mine }: { m: VendorChatMessage; mine: boolean }) {
  const time = relTime(m.created_at);
  const isStaff = m.user_role && m.user_role.toUpperCase() !== "VENDOR";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div className={mine ? "max-w-[80%]" : "max-w-[80%]"}>
        <div
          className={
            "whitespace-pre-wrap rounded-md px-3 py-2 text-sm " +
            (mine
              ? "bg-accent/10 text-midnight"
              : isStaff
                ? "bg-blue-50 text-midnight"
                : "bg-zinc-100 text-midnight")
          }
        >
          {m.message}
        </div>
        <div className={
          "mt-0.5 text-[10px] text-zinc-500 " + (mine ? "text-right" : "")
        }>
          {!mine && m.user_role && (
            <span className="mr-1 rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-semibold uppercase">
              {m.user_role}
            </span>
          )}
          {m.user_name || "Unknown"} · {time}
        </div>
      </div>
    </div>
  );
}

// ── Parts on order banner ──────────────────────────────────────
// Persistent (non-dismissible) banner that surfaces who's ordering
// the parts + the original notes. Stays up the whole time the
// ticket is in pause_state = 'awaiting_parts'. Vendor uses the
// "Update parts order" button below if they need to change who's
// ordering or update the notes.

function PartsOnOrderBanner({
  orderedBy, notes, orderedAt,
}: {
  orderedBy: "vendor" | "customer" | null;
  notes: string | null;
  orderedAt: string | null;
}) {
  const label = orderedBy === "vendor"
    ? "Vendor ordering parts"
    : orderedBy === "customer"
      ? "Customer ordering parts"
      : "Parts on order";
  return (
    <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
      <Package className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" strokeWidth={2} />
      <div className="flex-1 text-sm text-blue-900">
        <div className="font-semibold">{label}</div>
        {notes && (
          <div className="mt-0.5 whitespace-pre-wrap text-[12px] text-blue-900/90">
            {notes}
          </div>
        )}
        {orderedAt && (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-blue-700/80">
            Ordered {new Date(orderedAt).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Warranty banner ────────────────────────────────────────────
// Shown on a completed ticket when the vendor's warranty has been
// stamped (auto-populated on completion from vendor defaults).
// Shows raw days + a "≈ N months" hint + the expiration date.
// Tone shifts from emerald → amber → red as expiration nears.

function WarrantyBanner({
  startsAt, laborDays, partsDays, partsSource, notes,
}: {
  startsAt: string;
  laborDays: number | null;
  partsDays: number | null;
  partsSource: "vendor" | "manufacturer" | "none" | null;
  notes: string | null;
}) {
  const start = new Date(startsAt);
  const now = Date.now();
  const lab = warrantyStatus(start, laborDays, now);
  const par = warrantyStatus(start, partsDays, now);
  const sourceLabel =
    partsSource === "manufacturer" ? "mfg pass-through" :
    partsSource === "none"         ? "no parts coverage" :
                                     null;
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
        Warranty
      </div>
      <div className="mt-1 space-y-1 text-xs text-emerald-900">
        {laborDays != null && lab && (
          <div>
            <span className="font-semibold">Labor:</span>{" "}
            {laborDays} days
            {lab.hint && <span className="text-emerald-700"> ({lab.hint})</span>}
            <span className="ml-2 text-emerald-700">·</span>{" "}
            <span className={lab.tone === "danger" ? "text-red-700 font-semibold"
                          : lab.tone === "warn"   ? "text-amber-700 font-semibold"
                          :                         "text-emerald-700"}>
              {lab.label}
            </span>
          </div>
        )}
        {partsDays != null && par && (
          <div>
            <span className="font-semibold">Parts:</span>{" "}
            {partsDays} days
            {par.hint && <span className="text-emerald-700"> ({par.hint})</span>}
            {sourceLabel && <span className="text-emerald-700"> · {sourceLabel}</span>}
            <span className="ml-2 text-emerald-700">·</span>{" "}
            <span className={par.tone === "danger" ? "text-red-700 font-semibold"
                          : par.tone === "warn"   ? "text-amber-700 font-semibold"
                          :                         "text-emerald-700"}>
              {par.label}
            </span>
          </div>
        )}
        {notes && (
          <div className="mt-1 whitespace-pre-wrap text-[11px] text-emerald-900/90">
            {notes}
          </div>
        )}
      </div>
    </div>
  );
}

// Compute warranty expiration display for one duration.
// tone: 'ok' (>30d left), 'warn' (<=30d), 'danger' (expired).
function warrantyStatus(start: Date, days: number | null, now: number) {
  if (days == null) return null;
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) return null;
  const expiresMs = startMs + days * 86400_000;
  const daysLeft = Math.floor((expiresMs - now) / 86400_000);
  const expDate = new Date(expiresMs).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  if (daysLeft < 0) {
    return { label: `expired ${expDate}`, tone: "danger" as const, hint: "" };
  }
  if (daysLeft <= 30) {
    return { label: `expires ${expDate} (${daysLeft}d left)`, tone: "warn" as const, hint: "" };
  }
  // Friendly hint: months left for long warranties.
  const months = Math.round(daysLeft / 30);
  const hint = months >= 2 ? `~${months} months left` : "";
  return { label: `expires ${expDate}`, tone: "ok" as const, hint };
}

// ── Approval alert banner ───────────────────────────────────────
// Fires once when approval_status transitions from Pending →
// Approved/Rejected (handled by the parent's useEffect). Sticky at
// the top of the ticket detail screen so a vendor who looked away
// can't miss it. Dismissible.

function ApprovalAlertBanner({
  decision, amount, onDismiss,
}: {
  decision: "Approved" | "Rejected";
  amount: PortalTicketDetail["cost_estimate"];
  onDismiss: () => void;
}) {
  const tone = decision === "Approved"
    ? "bg-emerald-600 text-white"
    : "bg-red-600 text-white";
  const Icon = decision === "Approved" ? CheckCircle2 : AlertTriangle;
  const formatted = amount != null && Number.isFinite(Number(amount))
    ? `$${Number(amount).toFixed(2)}`
    : null;
  return (
    <div className={`flex items-start gap-3 rounded-md px-4 py-3 shadow-lg ${tone}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2} />
      <div className="flex-1">
        <div className="text-sm font-semibold">
          {decision === "Approved"
            ? `Your quote was approved${formatted ? ` (${formatted})` : ""}!`
            : `Your quote was rejected${formatted ? ` (${formatted})` : ""}.`}
        </div>
        <div className="mt-0.5 text-xs opacity-90">
          {decision === "Approved"
            ? "You're cleared to proceed with the work."
            : "Talk to your DO before continuing. You can also submit a revised quote below."}
        </div>
      </div>
      <button
        type="button" onClick={onDismiss}
        className="rounded p-1 text-white/80 hover:bg-white/10"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}

// ── Photo button ─────────────────────────────────────────────────

function PhotoButton({
  onPick, pending,
}: {
  onPick: (file: File, label: string) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState("after");
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onPick(file, label);
    e.target.value = ""; // allow re-select same file
  }
  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        Upload a photo
      </div>
      <select
        value={label} onChange={(e) => setLabel(e.target.value)}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
      >
        <option value="before">Before</option>
        <option value="after">After</option>
        <option value="serial">Serial / Nameplate</option>
        <option value="other">Other</option>
      </select>
      <label className="block">
        <input
          type="file" accept="image/*" capture="environment"
          onChange={handleChange} className="hidden"
        />
        <span className={
          "flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:border-accent hover:bg-accent/5" +
          (pending ? " opacity-50 pointer-events-none" : "")
        }>
          {pending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Camera className="h-4 w-4" strokeWidth={1.75} />}
          {pending ? "Uploading…" : "Take or choose a photo"}
        </span>
      </label>
    </div>
  );
}

// ── Quote modal ──────────────────────────────────────────────────

function QuoteModal({
  token, ticketId, identity, onClose, onSubmitted,
}: {
  token: string;
  ticketId: string;
  identity: Identity;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const inferredTier = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 500) return "DO < $500";
    if (n <= 1000) return "SDO $501-$1000";
    return "VP $1001-$1750";
  }, [amount]);

  const previewUrl = useMemo(() => {
    if (!file || !file.type.startsWith("image/")) return null;
    return URL.createObjectURL(file);
  }, [file]);

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return Promise.reject(new Error("Enter a positive dollar amount."));
      }
      if (!file) {
        return Promise.reject(new Error("Attach the quote — PDF or a photo — before submitting."));
      }
      const photoData = await fileToBase64(file);
      return postPortal(`${FN}?action=submitQuote`, {
        token, ticketId, identity,
        amount: amt,
        notes: notes || undefined,
        photo: {
          photoData,
          photoType: file.type,
          photoName: file.name,
        },
      });
    },
    onSuccess: onSubmitted,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget && !mut.isPending) onClose(); }}
    >
      <div className="w-full max-w-md rounded-t-xl bg-white shadow-2xl sm:rounded-xl">
        <div className="border-b border-zinc-100 px-5 py-3 text-base font-semibold text-midnight">
          Submit a Quote
        </div>
        <div className="space-y-3 px-5 py-4">
          <Field label="Quote amount *">
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">$</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base"
              />
            </div>
            {inferredTier && (
              <div className="mt-1 text-[10px] text-zinc-500">
                Routes to: <strong>{inferredTier}</strong>
              </div>
            )}
          </Field>
          <Field label="Notes">
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What does this cover?"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Quote (PDF or photo) *">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <input
                  type="file" accept="application/pdf,image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <span className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-3 text-sm font-medium text-zinc-700 hover:border-accent">
                  <Upload className="h-4 w-4" strokeWidth={1.75} />
                  Attach file
                </span>
              </label>
              <label className="block">
                <input
                  type="file" accept="image/*" capture="environment"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <span className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-3 text-sm font-medium text-zinc-700 hover:border-accent">
                  <Camera className="h-4 w-4" strokeWidth={1.75} />
                  Take photo
                </span>
              </label>
            </div>
            {file && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Quote preview"
                    className="h-16 w-16 shrink-0 rounded-md border border-zinc-200 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-500">
                    PDF
                  </div>
                )}
                <div className="min-w-0 flex-1 text-[11px]">
                  <div className="truncate font-medium text-midnight">{file.name}</div>
                  <div className="text-zinc-500">{Math.ceil(file.size / 1024)} KB</div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="mt-1 text-[10px] text-red-600 underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
            <div className="mt-1 text-[10px] text-zinc-500">
              Hand-written quotes work — snap a clear photo and we'll attach it as-is.
            </div>
          </Field>
          {mut.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {(mut.error as Error).message}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <button
            type="button" onClick={onClose} disabled={mut.isPending}
            className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button" onClick={() => mut.mutate()} disabled={mut.isPending}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
            Submit Quote
          </button>
        </div>
      </div>
    </div>
  );
}
