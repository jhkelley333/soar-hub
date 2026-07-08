// Work-order management on the Store Command Center. The screen already knows
// its store, so tickets are store-locked: list open + recently closed, file a
// new one (no store picker), open a ticket to read status/messages/photos and
// add comments — and, since the desktop has no camera, "Add photos" mints a
// short-lived QR the crew scans to upload straight from their phone. The
// detail view refetches every 15s so phone photos appear on the big screen.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Camera, Check, ExternalLink, MessageSquare, Plus, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  commentPortalTicket, createPortalTicket, fetchPhotoQr, fetchPortalTicket, fetchPortalTickets,
  type PortalAccess, type PortalTicket,
} from "./api";

const STATUS_CHIP: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-indigo-100 text-indigo-700",
  in_progress: "bg-amber-100 text-amber-800",
  scheduled: "bg-violet-100 text-violet-700",
  on_hold: "bg-zinc-200 text-zinc-700",
  completed: "bg-emerald-100 text-emerald-700",
  closed: "bg-zinc-100 text-zinc-500",
  cancelled: "bg-zinc-100 text-zinc-500",
};
const statusChip = (s: string) => STATUS_CHIP[s] ?? "bg-zinc-100 text-zinc-600";
const statusLabel = (s: string) => s.replace(/_/g, " ");
const PRIORITY_CHIP: Record<string, string> = {
  Emergency: "bg-red-100 text-red-700",
  Urgent: "bg-orange-100 text-orange-700",
};

export function TicketsView({ access, onBack }: { access: PortalAccess; onBack: () => void }) {
  const navigate = useNavigate();
  const [view, setView] = useState<{ kind: "list" } | { kind: "new" } | { kind: "detail"; id: string }>({ kind: "list" });
  const q = useQuery({ queryKey: ["portal-tickets", access], queryFn: () => fetchPortalTickets(access), refetchInterval: 60_000 });
  // Admin (live view) is logged in: opening a ticket lands in the REAL Work
  // Orders system with full management. The store screen has no login, so it
  // keeps the on-screen detail (same tickets underneath).
  const adminMode = "store_id" in access;
  const openTicket = adminMode
    ? (id: string) => navigate(`/admin/work-orders-v2?ticket=${encodeURIComponent(id)}`)
    : (id: string) => setView({ kind: "detail", id });

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={view.kind === "list" ? onBack : () => setView({ kind: "list" })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 transition hover:border-zinc-400">
            <ArrowLeft className="h-4 w-4" /> {view.kind === "list" ? "Back" : "All tickets"}
          </button>
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">
            {view.kind === "new" ? "New work order" : "Work Orders"}
          </h1>
        </div>
        {view.kind === "list" && (
          <div className="flex items-center gap-2">
            {adminMode && (
              <button onClick={() => navigate("/admin/work-orders-v2")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:border-zinc-400">
                <ExternalLink className="h-4 w-4" /> Open Work Orders system
              </button>
            )}
            <button onClick={() => setView({ kind: "new" })}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700">
              <Plus className="h-4 w-4" /> New ticket
            </button>
          </div>
        )}
      </div>

      {view.kind === "list" && (
        <TicketList loading={q.isLoading} open={q.data?.open ?? []} closed={q.data?.recent_closed ?? []}
          onOpen={openTicket} />
      )}
      {view.kind === "new" && (
        <NewTicketForm access={access} onCreated={openTicket} />
      )}
      {view.kind === "detail" && <TicketDetail access={access} ticketId={view.id} />}
    </section>
  );
}

function TicketList({ loading, open, closed, onOpen }: {
  loading: boolean; open: PortalTicket[]; closed: PortalTicket[]; onOpen: (id: string) => void;
}) {
  if (loading) return <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-400">Loading tickets…</div>;
  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">Open · {open.length}</h2>
        {open.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-400">
            Nothing open. File a ticket the moment something breaks.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <ul className="divide-y divide-zinc-100">
              {open.map((t) => <TicketRow key={t.id} t={t} onOpen={onOpen} />)}
            </ul>
          </div>
        )}
      </div>
      {closed.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">Recently closed</h2>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm opacity-80">
            <ul className="divide-y divide-zinc-100">
              {closed.map((t) => <TicketRow key={t.id} t={t} onOpen={onOpen} />)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function TicketRow({ t, onOpen }: { t: PortalTicket; onOpen: (id: string) => void }) {
  return (
    <li>
      <button onClick={() => onOpen(t.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-zinc-50">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-zinc-400">{t.wo_number}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold capitalize", statusChip(t.status))}>{statusLabel(t.status)}</span>
            {t.priority && PRIORITY_CHIP[t.priority] && (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", PRIORITY_CHIP[t.priority])}>{t.priority}</span>
            )}
          </div>
          <p className="mt-1 truncate text-[15px] font-medium text-zinc-800">{t.issue_description}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {t.category || "General"} · {new Date(t.date_submitted).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            {t.vendor_name ? ` · ${t.vendor_name}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-red-600">Open →</span>
      </button>
    </li>
  );
}

// ── New ticket (store pre-locked; no picker) ──────────────────────────────────
function NewTicketForm({ access, onCreated }: { access: PortalAccess; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("Standard");
  const [description, setDescription] = useState("");
  const [checked, setChecked] = useState(false);
  const create = useMutation({
    mutationFn: () => createPortalTicket(access, {
      submitter_name: name.trim(), issue_description: description.trim(),
      category: category.trim() || undefined, priority, troubleshooting_checked: checked,
    }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["portal-tickets", access] }); onCreated(r.ticket_id); },
  });
  const input = "w-full rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none";

  return (
    <div className="max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-zinc-500">Filed for <strong>this store automatically</strong> — no store number needed. Add photos from your phone right after.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={input} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="What's affected (fryer, HVAC, stall…)" className={input} />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
        placeholder="Describe the issue — what's broken, since when, what it's blocking."
        className={cn(input, "mt-3 resize-none")} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-500">Priority</span>
        {["Standard", "Urgent", "Emergency"].map((p) => (
          <button key={p} onClick={() => setPriority(p)}
            className={cn("rounded-full px-4 py-1.5 text-sm font-bold transition",
              priority === p
                ? p === "Emergency" ? "bg-red-600 text-white" : p === "Urgent" ? "bg-orange-500 text-white" : "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")}>
            {p}
          </button>
        ))}
      </div>
      <label className="mt-4 flex items-start gap-2.5 text-sm text-zinc-600">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300" />
        We tried basic troubleshooting (power cycle, breaker, reset) before filing this.
      </label>
      {create.isError && <p className="mt-3 text-sm font-medium text-red-600">{(create.error as Error)?.message ?? "Could not submit."}</p>}
      <button disabled={!name.trim() || description.trim().length < 10 || create.isPending} onClick={() => create.mutate()}
        className="mt-5 w-full rounded-xl bg-red-600 py-3.5 text-base font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 disabled:opacity-40">
        {create.isPending ? "Submitting…" : "Submit work order"}
      </button>
    </div>
  );
}

// ── Ticket detail ─────────────────────────────────────────────────────────────
function TicketDetail({ access, ticketId }: { access: PortalAccess; ticketId: string }) {
  const qc = useQueryClient();
  const [showQr, setShowQr] = useState(false);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const q = useQuery({
    queryKey: ["portal-ticket", access, ticketId],
    queryFn: () => fetchPortalTicket(access, ticketId),
    refetchInterval: 15_000, // phone photos + status changes appear on the big screen
  });
  const post = useMutation({
    mutationFn: () => commentPortalTicket(access, { ticket_id: ticketId, message: comment.trim(), name: name.trim() || undefined }),
    onSuccess: () => { setComment(""); qc.invalidateQueries({ queryKey: ["portal-ticket", access, ticketId] }); },
  });

  if (q.isLoading) return <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-400">Loading ticket…</div>;
  if (q.isError) return <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-red-600">{(q.error as Error)?.message}</div>;
  const { ticket, messages, photos } = q.data!;
  const input = "w-full rounded-xl border border-zinc-200 px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* left: ticket + messages */}
      <div className="space-y-5 lg:col-span-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-zinc-400">{ticket.wo_number}</span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold capitalize", statusChip(ticket.status))}>{statusLabel(ticket.status)}</span>
            {ticket.priority && PRIORITY_CHIP[ticket.priority] && (
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", PRIORITY_CHIP[ticket.priority])}>{ticket.priority}</span>
            )}
            {ticket.vendor_name && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-600">{ticket.vendor_name}</span>}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-400"><RefreshCw className="h-3 w-3" /> live</span>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-800">{ticket.issue_description}</p>
          <p className="mt-2 text-xs text-zinc-400">
            {ticket.category || "General"} · filed {new Date(ticket.date_submitted).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-2 text-lg font-bold text-zinc-900"><MessageSquare className="h-5 w-5 text-red-600" /> Updates</h3>
          <ul className="mt-4 flex flex-col gap-3">
            {messages.length === 0 && <li className="text-sm text-zinc-400">No updates yet.</li>}
            {messages.map((m, i) => (
              <li key={i} className="rounded-xl bg-zinc-50 px-4 py-3">
                <p className="text-[15px] leading-snug text-zinc-800">{m.message}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {m.user_name ?? "—"} · {new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Add an update for the team…" className={cn(input, "resize-none")} />
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" className={cn(input, "flex-1")} />
              <button disabled={!comment.trim() || post.isPending} onClick={() => post.mutate()}
                className="shrink-0 rounded-xl bg-zinc-900 px-6 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:opacity-40">
                {post.isPending ? "Posting…" : "Post"}
              </button>
            </div>
            {post.isError && <p className="text-sm font-medium text-red-600">{(post.error as Error)?.message}</p>}
          </div>
        </div>
      </div>

      {/* right: photos + QR handoff */}
      <div className="space-y-5">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-zinc-900">Photos</h3>
            <span className="text-xs font-bold text-zinc-400">{photos.length}</span>
          </div>
          {photos.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">No photos yet — add some from a phone.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {photos.map((p, i) => (
                <a key={i} href={p.file_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-zinc-100">
                  <img src={p.file_url} alt={p.file_name} className="aspect-square w-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          <button onClick={() => setShowQr(true)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700">
            <Camera className="h-4 w-4" /> Add photos from your phone
          </button>
          <p className="mt-2 text-center text-xs text-zinc-400">This computer has no camera — scan the code with any phone.</p>
        </div>
      </div>

      {showQr && <PhotoQrModal access={access} ticketId={ticketId} woNumber={ticket.wo_number} onClose={() => setShowQr(false)} />}
    </div>
  );
}

// ── QR handoff modal ──────────────────────────────────────────────────────────
function PhotoQrModal({ access, ticketId, woNumber, onClose }: { access: PortalAccess; ticketId: string; woNumber: string; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const q = useQuery({
    queryKey: ["portal-photo-qr", access, ticketId],
    queryFn: () => fetchPhotoQr(access, ticketId),
    staleTime: 0, gcTime: 0,
  });
  useEffect(() => {
    if (!q.data) return;
    const url = `${window.location.origin}/p/${q.data.token}`;
    QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [q.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-zinc-900">Scan with your phone</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Photos land on <strong className="font-mono">{woNumber}</strong> and show up here automatically.</p>
        <div className="mt-4 grid place-items-center">
          {q.isLoading || !src ? (
            <div className="grid h-[260px] w-[260px] place-items-center rounded-xl bg-zinc-100 text-sm text-zinc-400">Generating…</div>
          ) : (
            <img src={src} alt="Scan to upload photos" width={260} height={260} className="rounded-xl" />
          )}
        </div>
        {q.data && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <Check className="h-3.5 w-3.5" /> Code works for {q.data.expires_in_minutes} minutes
          </p>
        )}
      </div>
    </div>
  );
}
