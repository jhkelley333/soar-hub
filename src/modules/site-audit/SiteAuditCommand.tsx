// Site Audits — Command (desktop) surface for DO-and-above. Track completion
// across all stores in scope: overview KPIs + store/audit table, drill into an
// audit, and resolve issues (honoring required proof via a completion modal).
//
// Shares the same data + mutations as the Field surface; this is just the
// desktop layout the prototype's "Command" describes.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Camera, Check, ChevronRight, Clock, Image as ImageIcon,
  Plus, Send, Trash2,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { closeAudit, createAudit, deleteAudit, fetchAuditStores, fileToPhoto, resolveIssue, type PhotoPayload } from "./api";
import { SEVERITY_META, type AuditIssue, type SiteAudit } from "./types";

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function isOverdue(i: AuditIssue) {
  return !i.completed && i.due != null && new Date(`${i.due}T23:59:59`).getTime() < Date.now();
}
function dueText(due: string | null) {
  if (!due) return null;
  const days = Math.ceil((new Date(`${due}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "over" as const };
  if (days <= 3) return { text: days === 0 ? "Due today" : `Due in ${days}d`, tone: "soon" as const };
  return { text: `Due ${new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, tone: "muted" as const };
}

function Ring({ pct, size = 48 }: { pct: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const done = pct >= 100;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-zinc-200" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" strokeLinecap="round"
        className={done ? "text-emerald-500" : "text-accent"} stroke="currentColor"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" className="fill-midnight text-[11px] font-bold">{pct}%</text>
    </svg>
  );
}
function Bar({ pct }: { pct: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-accent")} style={{ width: `${pct}%` }} /></div>;
}

export function SiteAuditCommand({ audits, canWrite, focusAuditId, onStartCapture, onStartShare }: {
  audits: SiteAudit[]; canWrite: boolean;
  focusAuditId?: string | null;
  onStartCapture: (auditId: string) => void;
  onStartShare: (auditId: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(focusAuditId ?? null);
  // Re-open an audit when the parent points us at one (e.g. after capturing on
  // the centered Field screen, return to this audit's detail rather than the list).
  useEffect(() => { if (focusAuditId) setSel(focusAuditId); }, [focusAuditId]);
  const audit = audits.find((a) => a.id === sel) ?? null;
  return audit
    ? <AuditDetail audit={audit} canWrite={canWrite} onBack={() => setSel(null)} onCapture={() => onStartCapture(audit.id)} onShare={() => onStartShare(audit.id)} />
    : <Overview audits={audits} canWrite={canWrite} onOpen={setSel} onStartCapture={onStartCapture} />;
}

function Overview({ audits, canWrite, onOpen, onStartCapture }: { audits: SiteAudit[]; canWrite: boolean; onOpen: (id: string) => void; onStartCapture: (id: string) => void }) {
  const [view, setView] = useState<"active" | "archived">("active");
  const activeAudits = audits.filter((a) => a.status !== "complete");
  const archivedAudits = audits.filter((a) => a.status === "complete");
  // KPIs reflect the operational state — closed audits are out of scope here.
  const kpiSource = activeAudits.flatMap((a) => a.issues);
  const done = kpiSource.filter((i) => i.completed).length;
  const open = kpiSource.length - done;
  const high = kpiSource.filter((i) => i.severity === "high" && !i.completed).length;
  const overdue = kpiSource.filter(isOverdue).length;
  const pct = kpiSource.length ? Math.round((done / kpiSource.length) * 100) : 0;
  const visible = view === "archived" ? archivedAudits : activeAudits;

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Site Audits</div>
          <h1 className="text-2xl font-bold tracking-tight text-midnight">Operations overview</h1>
        </div>
        {canWrite && <NewWalkButton onCreated={onStartCapture} />}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Completion rate" value={`${pct}%`} sub={`${done} of ${kpiSource.length} resolved`} ring={pct} />
        <Kpi label="Open issues" value={open} sub={`across ${activeAudits.length} active audit${activeAudits.length === 1 ? "" : "s"}`} />
        <Kpi label="High severity" value={high} sub="need attention" tone={high ? "red" : "muted"} />
        <Kpi label="Overdue" value={overdue} sub="past due date" tone={overdue ? "red" : "muted"} icon={Clock} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
          <div className="text-sm font-semibold text-midnight">Store audits</div>
          <div className="inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
            {(["active", "archived"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1 text-xs font-medium capitalize transition first:rounded-l-md last:rounded-r-md",
                view === v ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50")}>
                {v} <span className="tabular-nums opacity-70">{v === "active" ? activeAudits.length : archivedAudits.length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[2.2fr_1.2fr_1.4fr_0.9fr_auto] gap-3 border-b border-zinc-100 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
          <span>Store</span><span>GM · Date</span><span>Progress</span><span>Status</span><span />
        </div>
        {visible.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-sm text-zinc-400">
              {view === "archived" ? "No archived audits yet." : "No audits in your scope yet."}
            </div>
            {view === "active" && canWrite && <div className="mt-3"><NewWalkButton onCreated={onStartCapture} label="Start your first walk" /></div>}
          </div>
        ) : visible.map((a) => {
          const s = a.stats;
          const closed = a.status === "complete";
          return (
            <button key={a.id} onClick={() => onOpen(a.id)}
              className={cn("grid w-full grid-cols-[2.2fr_1.2fr_1.4fr_0.9fr_auto] items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left transition last:border-b-0 hover:bg-zinc-50",
                closed && "bg-zinc-50/50")}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-[11px] font-bold text-accent">#{a.store_number}</span>
                <span className={cn("truncate text-sm font-semibold", closed ? "text-zinc-500" : "text-midnight")}>
                  {a.store_name || `Store #${a.store_number}`}
                </span>
                {a.last_report && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    <Send className="h-2.5 w-2.5" strokeWidth={2.5} /> Shared
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-700">{a.created_by_name || "—"}</div>
                <div className="text-xs text-zinc-400">{fmtDate(a.date)}</div>
              </div>
              <div className="pr-3">
                <div className="mb-1 flex justify-between text-[11px] text-zinc-400"><span>{s.done}/{s.total}</span><span>{s.pct}%</span></div>
                <Bar pct={s.pct} />
              </div>
              <div>
                {closed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-600">
                    Closed
                  </span>
                ) : s.high > 0 ? (
                  <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">{s.high} high</span>
                ) : s.pct === 100 ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> Complete</span>
                ) : (
                  <span className="text-[12px] font-semibold text-amber-600">In progress</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 justify-self-end text-zinc-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Kpi({ label, value, sub, ring, tone = "midnight", icon: Icon }: { label: string; value: number | string; sub: string; ring?: number; tone?: "midnight" | "red" | "muted"; icon?: typeof Clock }) {
  const c = { midnight: "text-midnight", red: "text-red-600", muted: "text-zinc-400" }[tone];
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        {ring != null ? <Ring pct={ring} size={34} /> : Icon ? <Icon className="h-4 w-4 text-zinc-300" /> : null}
      </div>
      <div className={cn("mt-3 text-3xl font-bold tabular-nums leading-none", c)}>{value}</div>
      <div className="mt-1.5 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function AuditDetail({ audit, canWrite, onBack, onCapture, onShare }: { audit: SiteAudit; canWrite: boolean; onBack: () => void; onCapture: () => void; onShare: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "open" | "high" | "done">("all");
  const [proofFor, setProofFor] = useState<AuditIssue | null>(null);
  const s = audit.stats;
  const issues = audit.issues.filter((i) => filter === "all" ? true : filter === "open" ? !i.completed : filter === "high" ? i.severity === "high" : i.completed);

  const resolve = useMutation({
    mutationFn: (v: { issue: AuditIssue; reopen?: boolean; completion?: { note?: string; photo?: PhotoPayload | null } }) =>
      resolveIssue(v.reopen ? { audit_id: audit.id, issue_id: v.issue.id, reopen: true } : { audit_id: audit.id, issue_id: v.issue.id, completion: v.completion }),
    onSuccess: () => { setProofFor(null); qc.invalidateQueries({ queryKey: ["site-audits"] }); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update.", "error"),
  });
  const del = useMutation({
    mutationFn: () => deleteAudit(audit.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["site-audits"] }); onBack(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't delete.", "error"),
  });
  const isClosed = audit.status === "complete";
  const close = useMutation({
    mutationFn: () => closeAudit({ audit_id: audit.id, reopen: isClosed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["site-audits"] }),
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update audit.", "error"),
  });

  return (
    <div className="mx-auto max-w-[1100px]">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> Overview</button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-midnight">{audit.store_name || `Store #${audit.store_number}`}</h1>
          <div className="mt-1 text-sm text-zinc-500">#{audit.store_number} · {audit.created_by_name || "—"} · {fmtDate(audit.date)}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {isClosed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Closed
              </span>
            )}
            {audit.last_report && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Report shared {new Date(audit.last_report.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {audit.last_report.signed_by_name ? ` · signed by ${audit.last_report.signed_by_name}` : ""}
                {audit.last_report.recipient_count ? ` · ${audit.last_report.recipient_count} recipient${audit.last_report.recipient_count === 1 ? "" : "s"}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          {canWrite && !isClosed && (
            <div className="flex gap-2">
              <Button size="sm" onClick={onCapture}><Camera className="h-4 w-4" /> Capture issue</Button>
              <Button size="sm" variant="secondary" onClick={onShare}><Send className="h-4 w-4" /> Share &amp; sign</Button>
            </div>
          )}
          <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-3 shadow-card">
            <Ring pct={s.pct} />
            <div className="flex gap-5">
              <St n={s.open} label="Open" /><St n={s.done} label="Resolved" tone="emerald" /><St n={s.high} label="High" tone={s.high ? "red" : "muted"} />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {([["all", `All ${s.total}`], ["open", `Open ${s.open}`], ["high", "High"], ["done", `Resolved ${s.done}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset transition",
            filter === k ? "bg-midnight text-white ring-midnight" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")}>{l}</button>
        ))}
      </div>

      {issues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-400">Nothing here.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {issues.map((i) => {
            const m = SEVERITY_META[i.severity];
            const due = !i.completed ? dueText(i.due) : null;
            const needsProof = !i.completed && i.proof_required.length > 0;
            return (
              <div key={i.id} className={cn("flex gap-4 rounded-2xl border border-l-[4px] border-zinc-200 bg-white p-4 shadow-card", m.bar)}>
                {i.photo_url ? <img src={i.photo_url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                  : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-300"><ImageIcon className="h-6 w-6" /></span>}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className={cn("text-sm font-semibold", i.completed ? "text-zinc-400 line-through" : "text-midnight")}>{i.title}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.chip)}><span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.label}</span>
                    <span className="text-[11px] text-zinc-500">{i.area}</span>
                    {due && <span className={cn("text-[11px] font-medium", due.tone === "over" ? "text-red-600" : due.tone === "soon" ? "text-amber-600" : "text-zinc-400")}>· {due.text}</span>}
                    {needsProof && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600"><AlertTriangle className="h-3 w-3" /> Proof required</span>}
                  </div>
                  {i.comment && <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">{i.comment}</div>}
                  {i.completed && i.completion && (i.completion.note || i.completion.photo_url) && (
                    <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-emerald-50 p-2 ring-1 ring-emerald-100">
                      {i.completion.photo_url && <img src={i.completion.photo_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Proof attached</div>
                        <div className="truncate text-[11px] text-zinc-600">{i.completion.note || `Closed by ${i.completion.by_name}`}</div>
                      </div>
                    </div>
                  )}
                  <div className="flex-1" />
                  {canWrite && (
                    <button
                      onClick={() => i.completed ? resolve.mutate({ issue: i, reopen: true }) : needsProof ? setProofFor(i) : resolve.mutate({ issue: i, completion: {} })}
                      disabled={resolve.isPending}
                      className={cn("mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                        i.completed ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")}>
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> {i.completed ? "Resolved · reopen" : needsProof ? "Resolve with proof" : "Mark resolved"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(audit.can_close || audit.can_delete) && (
        <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-zinc-100 pt-4">
          {audit.can_close && (
            <button
              onClick={() => close.isPending ? null : close.mutate()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> {isClosed ? "Reopen audit" : "Close audit (admin)"}
            </button>
          )}
          {audit.can_delete && (
            <button
              onClick={() => del.isPending ? null : (window.confirm("Delete this entire audit and all of its issues?") && del.mutate())}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:underline">
              <Trash2 className="h-3.5 w-3.5" /> Delete audit
            </button>
          )}
        </div>
      )}

      {proofFor && (
        <ProofModal issue={proofFor} pending={resolve.isPending} onClose={() => setProofFor(null)}
          onConfirm={(completion) => resolve.mutate({ issue: proofFor, completion })} />
      )}
    </div>
  );
}
function St({ n, label, tone = "midnight" }: { n: number; label: string; tone?: "midnight" | "emerald" | "red" | "muted" }) {
  const c = { midnight: "text-midnight", emerald: "text-emerald-600", red: "text-red-600", muted: "text-zinc-400" }[tone];
  return <div className="text-center"><div className={cn("text-xl font-bold tabular-nums leading-none", c)}>{n}</div><div className="mt-1 text-[11px] text-zinc-500">{label}</div></div>;
}

// Start a walk from the desktop Command surface: pick a store, then drop the
// auditor straight into capturing the first issue (the centered Field screen).
function NewWalkButton({ onCreated, label = "New walk" }: { onCreated: (auditId: string) => void; label?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const storesQ = useQuery({ queryKey: ["site-audit-stores"], queryFn: fetchAuditStores, enabled: open });
  const create = useMutation({
    mutationFn: () => createAudit({ store_id: storeId }),
    onSuccess: (r) => { setOpen(false); setStoreId(""); onCreated(r.audit_id); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't start the walk.", "error"),
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Start a walk" maxWidth="max-w-sm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!storeId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Starting…" : "Start walk"}</Button></>}>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Store</div>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent">
            <option value="" disabled>{storesQ.isLoading ? "Loading…" : "Pick a store…"}</option>
            {(storesQ.data?.stores ?? []).map((st) => (
              <option key={st.id} value={st.id}>#{st.number}{st.name ? ` — ${st.name}` : ""}</option>
            ))}
          </select>
          <p className="text-xs text-zinc-400">Today's date is used for the walk. You'll capture issues on the next screen.</p>
        </div>
      </Modal>
    </>
  );
}

function ProofModal({ issue, pending, onClose, onConfirm }: { issue: AuditIssue; pending: boolean; onClose: () => void; onConfirm: (c: { note?: string; photo?: PhotoPayload | null }) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<PhotoPayload | null>(null);
  const [note, setNote] = useState("");
  const need = issue.proof_required;
  const needPhoto = need.includes("photo");
  const needNote = need.includes("note");
  const ok = (!needPhoto || photo) && (!needNote || note.trim().length > 0);
  return (
    <Modal open onClose={onClose} title="Resolve with proof" maxWidth="max-w-md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button disabled={!ok || pending} onClick={() => onConfirm({ note: note.trim() || undefined, photo })}><Check className="h-4 w-4" /> {pending ? "Saving…" : "Confirm resolved"}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-600">"{issue.title}" requires {need.map((n) => n === "photo" ? "a photo" : "a note").join(" and ")} before it can close.</p>
        {needPhoto && (
          photo ? (
            <div className="relative">
              <img src={photo.data} alt="" className="h-32 w-full rounded-xl object-cover" />
              <button onClick={() => ref.current?.click()} className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white"><Camera className="h-3.5 w-3.5" /> Replace</button>
            </div>
          ) : (
            <button onClick={() => ref.current?.click()} className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-accent hover:text-midnight">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white"><Camera className="h-5 w-5" /></span>
              <span className="text-sm font-semibold">Attach photo of the fix</span>
            </button>
          )
        )}
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { setPhoto(await fileToPhoto(f)); } catch { toast.push("Couldn't read the photo.", "error"); } }} />
        {needNote && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was done to fix it?" className="block w-full resize-y rounded-xl border-0 bg-white px-3.5 py-3 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent" />}
      </div>
    </Modal>
  );
}
