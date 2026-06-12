// Site Audits (Audit Pro) — Field surface. A GM (or above) walks a store,
// captures issues with a photo + note + severity + due + optional required
// proof, and tracks each to completion. Screen stack: list → audit summary →
// capture → issue detail. Online-first v1 (offline queue is a later phase).
//
// The prototype's dark/amber field look is adapted to SOAR's light tokens.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Camera, Check, ChevronRight, Image as ImageIcon,
  Mic, Plus, Send, Trash2,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  captureIssue, createAudit, deleteAudit, deleteIssue, fetchAuditStores, fetchAudits,
  fileToPhoto, resolveIssue, shareReport, updateIssue, type PhotoPayload,
} from "./api";
import { AREAS, SEVERITY_META, type AuditIssue, type ProofKind, type Severity, type SiteAudit } from "./types";
import { SiteAuditCommand } from "./SiteAuditCommand";

type Nav = { screen: "list" | "audit" | "capture" | "issue" | "share"; auditId?: string; issueId?: string };

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function dueLabel(due: string | null): { text: string; tone: "muted" | "soon" | "over" } | null {
  if (!due) return null;
  const d = new Date(`${due}T23:59:59`);
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "over" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days <= 3) return { text: `Due in ${days}d`, tone: "soon" };
  return { text: `Due ${new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, tone: "muted" };
}

function Ring({ pct, size = 56 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const done = pct >= 100;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-200" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" strokeLinecap="round"
        className={done ? "text-emerald-500" : "text-accent"} stroke="currentColor"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-midnight text-[13px] font-bold">{pct}%</text>
    </svg>
  );
}
function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
      <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}
function SevChip({ s }: { s: Severity }) {
  const m = SEVERITY_META[s];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.chip)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.label}
    </span>
  );
}

export function SiteAuditPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [nav, setNav] = useState<Nav>({ screen: "list" });
  const auditsQ = useQuery({ queryKey: ["site-audits"], queryFn: fetchAudits });
  const audits = auditsQ.data?.audits ?? [];
  const canWrite = auditsQ.data?.can_write ?? false;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["site-audits"] });

  const audit = useMemo(() => audits.find((a) => a.id === nav.auditId) ?? null, [audits, nav.auditId]);
  const issue = useMemo(() => audit?.issues.find((i) => i.id === nav.issueId) ?? null, [audit, nav.issueId]);

  if (auditsQ.isLoading) {
    return <div className="mx-auto w-full max-w-md space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (auditsQ.isError) {
    return <EmptyState title="Couldn't load audits" description={(auditsQ.error as Error)?.message ?? "Make sure migration 0145 has run."} />;
  }

  // Field (mobile) — the GM's capture/resolve stack.
  const field =
    nav.screen === "audit" && audit ? (
      <AuditSummary audit={audit} canWrite={canWrite}
        onBack={() => setNav({ screen: "list" })}
        onCapture={() => setNav({ screen: "capture", auditId: audit.id })}
        onShare={() => setNav({ screen: "share", auditId: audit.id })}
        onIssue={(iid) => setNav({ screen: "issue", auditId: audit.id, issueId: iid })}
        onDeleted={() => { invalidate(); setNav({ screen: "list" }); }} />
    ) : nav.screen === "share" && audit ? (
      <ShareReport audit={audit}
        onBack={() => setNav({ screen: "audit", auditId: audit.id })}
        onSent={() => { invalidate(); }} />
    ) : nav.screen === "capture" && audit ? (
      <CaptureIssue audit={audit}
        onBack={() => setNav({ screen: "audit", auditId: audit.id })}
        onSaved={() => { invalidate(); toast.push("Issue captured.", "success"); setNav({ screen: "audit", auditId: audit.id }); }} />
    ) : nav.screen === "issue" && audit && issue ? (
      <IssueDetail audit={audit} issue={issue} canWrite={canWrite}
        onBack={() => setNav({ screen: "audit", auditId: audit.id })}
        onChanged={invalidate}
        onDeleted={() => { invalidate(); setNav({ screen: "audit", auditId: audit.id }); }} />
    ) : (
      <AuditList audits={audits} canWrite={canWrite} onOpen={(id) => setNav({ screen: "audit", auditId: id })}
        onCreated={(id) => { invalidate(); setNav({ screen: "audit", auditId: id }); }} />
    );

  // Capture & share have no desktop-specific layout — render the Field screen
  // centered at any width so DO+ can run a full walk from the Command surface too.
  if ((nav.screen === "capture" || nav.screen === "share") && audit) {
    return <div className="mx-auto w-full max-w-md">{field}</div>;
  }

  return (
    <>
      {/* Field on phones/tablets; Command desktop dashboard on lg+. */}
      <div className="mx-auto w-full max-w-md lg:hidden">{field}</div>
      <div className="hidden lg:block">
        <SiteAuditCommand audits={audits} canWrite={canWrite}
          focusAuditId={nav.auditId ?? null}
          onStartCapture={(id) => setNav({ screen: "capture", auditId: id })}
          onStartShare={(id) => setNav({ screen: "share", auditId: id })} />
      </div>
    </>
  );
}

// ── List ──────────────────────────────────────────────────────────────────
function AuditList({ audits, canWrite, onOpen, onCreated }: {
  audits: SiteAudit[]; canWrite: boolean; onOpen: (id: string) => void; onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const storesQ = useQuery({ queryKey: ["site-audit-stores"], queryFn: fetchAuditStores, enabled: picking });
  const [storeId, setStoreId] = useState("");
  const create = useMutation({
    mutationFn: () => createAudit({ store_id: storeId }),
    onSuccess: (r) => { setPicking(false); setStoreId(""); onCreated(r.audit_id); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't start audit.", "error"),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Site Audits</div>
          <h1 className="text-2xl font-bold tracking-tight text-midnight">My audits</h1>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> New audit</Button>
        )}
      </div>

      {audits.length === 0 ? (
        <EmptyState title="No audits yet" description={canWrite ? "Start a new audit to walk a store and capture issues." : "Audits in your scope will appear here."} />
      ) : (
        <div className="space-y-3">
          {audits.map((a) => {
            const s = a.stats;
            return (
              <button key={a.id} onClick={() => onOpen(a.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-card transition hover:border-accent/60">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent text-sm font-bold">
                  #{a.store_number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-midnight">{a.store_name || `Store #${a.store_number}`}</span>
                    {s.high > 0 && <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{s.high} high</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">{fmtDate(a.date)} · {a.created_by_name || "—"}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Bar pct={s.pct} />
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">{s.done}/{s.total}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
              </button>
            );
          })}
        </div>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} title="Start a new audit" maxWidth="max-w-sm"
        footer={<><Button variant="secondary" onClick={() => setPicking(false)}>Cancel</Button>
          <Button disabled={!storeId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Starting…" : "Start audit"}</Button></>}>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Store</div>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent">
            <option value="" disabled>{storesQ.isLoading ? "Loading…" : "Pick a store…"}</option>
            {(storesQ.data?.stores ?? []).map((s) => (
              <option key={s.id} value={s.id}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
            ))}
          </select>
          <p className="text-xs text-zinc-400">Today's date is used for the audit. You'll capture issues on the next screen.</p>
        </div>
      </Modal>
    </div>
  );
}

// ── Audit summary ───────────────────────────────────────────────────────────
function AuditSummary({ audit, canWrite, onBack, onCapture, onShare, onIssue, onDeleted }: {
  audit: SiteAudit; canWrite: boolean; onBack: () => void; onCapture: () => void; onShare: () => void; onIssue: (id: string) => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"open" | "done" | "all">("open");
  const s = audit.stats;
  const issues = audit.issues.filter((i) => tab === "all" ? true : tab === "open" ? !i.completed : i.completed);
  const del = useMutation({
    mutationFn: () => deleteAudit(audit.id),
    onSuccess: onDeleted,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't delete.", "error"),
  });

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> My audits</button>
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-midnight">{audit.store_name || `Store #${audit.store_number}`}</h1>
        <div className="text-xs text-zinc-500">#{audit.store_number} · {fmtDate(audit.date)} · {audit.created_by_name || "—"}</div>
        {audit.last_report && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <Check className="h-3 w-3" strokeWidth={2.5} /> Report shared · {new Date(audit.last_report.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-card">
        <Ring pct={s.pct} />
        <div className="flex flex-1 justify-around">
          <Stat n={s.open} label="Open" />
          <Stat n={s.done} label="Resolved" tone="emerald" />
          <Stat n={s.high} label="High" tone={s.high ? "red" : "muted"} />
        </div>
      </div>

      {canWrite && (
        <button onClick={onShare}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-semibold text-midnight shadow-card transition hover:border-accent hover:text-accent">
          <Send className="h-4 w-4" /> Share &amp; sign off report
        </button>
      )}

      <div className="mb-3 inline-flex rounded-md ring-1 ring-inset ring-zinc-200">
        {(["open", "done", "all"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-3.5 py-1.5 text-sm font-medium capitalize transition first:rounded-l-md last:rounded-r-md",
            tab === t ? "bg-midnight text-white" : "text-zinc-600 hover:bg-zinc-50")}>
            {t === "done" ? "Resolved" : t} {t !== "all" && <span className="tabular-nums opacity-70">{t === "open" ? s.open : s.done}</span>}
          </button>
        ))}
      </div>

      {issues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-400">Nothing here.</div>
      ) : (
        <div className="space-y-2">{issues.map((i) => <IssueRow key={i.id} issue={i} onClick={() => onIssue(i.id)} />)}</div>
      )}

      {canWrite && (
        <button onClick={onCapture}
          className="sticky bottom-4 mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-sm font-semibold text-white shadow-float hover:bg-accent/90">
          <Camera className="h-5 w-5" /> Capture issue
        </button>
      )}

      {canWrite && (
        <button onClick={() => del.isPending ? null : (window.confirm("Delete this entire audit?") && del.mutate())}
          className="mx-auto mt-4 block text-xs font-medium text-red-500 hover:underline">Delete audit</button>
      )}
    </div>
  );
}
function Stat({ n, label, tone = "midnight" }: { n: number; label: string; tone?: "midnight" | "emerald" | "red" | "muted" }) {
  const c = { midnight: "text-midnight", emerald: "text-emerald-600", red: "text-red-600", muted: "text-zinc-400" }[tone];
  return <div className="text-center"><div className={cn("text-2xl font-bold tabular-nums leading-none", c)}>{n}</div><div className="mt-1 text-[11px] text-zinc-500">{label}</div></div>;
}
function IssueRow({ issue, onClick }: { issue: AuditIssue; onClick: () => void }) {
  const due = !issue.completed ? dueLabel(issue.due) : null;
  const needsProof = !issue.completed && issue.proof_required.length > 0;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5 text-left transition hover:border-accent/50">
      {issue.photo_url
        ? <img src={issue.photo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
        : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-300"><ImageIcon className="h-5 w-5" /></span>}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", issue.completed ? "text-zinc-400 line-through" : "text-midnight")}>{issue.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <SevChip s={issue.severity} />
          <span className="text-[11px] text-zinc-500">{issue.area}</span>
          {due && <span className={cn("text-[11px] font-medium", due.tone === "over" ? "text-red-600" : due.tone === "soon" ? "text-amber-600" : "text-zinc-400")}>· {due.text}</span>}
          {needsProof && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600"><AlertTriangle className="h-3 w-3" /> Proof</span>}
        </div>
      </div>
      {issue.completed
        ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /></span>
        : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />}
    </button>
  );
}

// ── Capture ─────────────────────────────────────────────────────────────────
function PhotoInput({ photo, onPick, label }: { photo: PhotoPayload | null; onPick: (p: PhotoPayload | null) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  return (
    <div>
      {photo ? (
        <div className="relative">
          <img src={photo.data} alt="" className="h-44 w-full rounded-xl object-cover" />
          <button onClick={() => ref.current?.click()} className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
            <Camera className="h-3.5 w-3.5" /> Retake
          </button>
        </div>
      ) : (
        <button onClick={() => ref.current?.click()}
          className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 text-zinc-500 transition hover:border-accent hover:text-midnight">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-white"><Camera className="h-6 w-6" /></span>
          <span className="text-sm font-semibold">{label}</span>
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          try { onPick(await fileToPhoto(f)); } catch { toast.push("Couldn't read the photo.", "error"); }
        }} />
    </div>
  );
}
function CaptureIssue({ audit, onBack, onSaved }: { audit: SiteAudit; onBack: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [photo, setPhoto] = useState<PhotoPayload | null>(null);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<string>(AREAS[0]);
  const [sev, setSev] = useState<Severity>("medium");
  const [dueDays, setDueDays] = useState(7);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<ProofKind[]>([]);
  const toggleProof = (k: ProofKind) => setProof((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const save = useMutation({
    mutationFn: () => {
      const d = new Date(); d.setDate(d.getDate() + dueDays);
      return captureIssue({
        audit_id: audit.id, title: title.trim(), area, severity: sev,
        comment: note.trim() || undefined, due: d.toISOString().slice(0, 10),
        proof_required: proof, photo,
      });
    },
    onSuccess: onSaved,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Save failed.", "error"),
  });

  return (
    <div className="pb-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> {audit.store_name || `#${audit.store_number}`}</button>
      <h1 className="mb-4 text-xl font-bold tracking-tight text-midnight">Capture issue</h1>

      <div className="space-y-4">
        <PhotoInput photo={photo} onPick={setPhoto} label="Tap to take photo" />
        <L label="What's the issue?">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cracked floor tile at entry" className={inputCls} />
        </L>
        <L label="Area">
          <div className="flex flex-wrap gap-2">
            {AREAS.map((a) => <Chip key={a} active={area === a} onClick={() => setArea(a)}>{a}</Chip>)}
          </div>
        </L>
        <L label="Severity">
          <div className="flex gap-2">
            {(["high", "medium", "low"] as const).map((k) => {
              const m = SEVERITY_META[k];
              return (
                <button key={k} onClick={() => setSev(k)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold transition",
                  sev === k ? m.chip + " ring-1" : "border-zinc-200 bg-white text-zinc-500")}>
                  <span className={cn("h-2 w-2 rounded-full", m.dot)} />{m.label}
                </button>
              );
            })}
          </div>
        </L>
        <L label="Due">
          <div className="flex gap-2">
            {[[1, "Tomorrow"], [3, "3 days"], [7, "1 week"], [14, "2 weeks"]].map(([d, l]) => (
              <Chip key={d} active={dueDays === d} onClick={() => setDueDays(d as number)} grow>{l as string}</Chip>
            ))}
          </div>
        </L>
        <L label="Note">
          <div className="relative">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add detail, or dictate with the mic…" className={cn(inputCls, "resize-y pr-12")} />
            <div className="absolute bottom-2 right-2"><MicButton onText={(t) => setNote((n) => (n ? n + " " : "") + t)} /></div>
          </div>
        </L>
        <L label="Require proof to resolve">
          <div className="-mt-1 mb-2 text-xs text-zinc-500">Whoever closes this must attach what you select.</div>
          <div className="flex gap-2">
            {([["photo", "Photo"], ["note", "Note"]] as [ProofKind, string][]).map(([k, l]) => {
              const on = proof.includes(k);
              return (
                <button key={k} onClick={() => toggleProof(k)} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition",
                  on ? "border-accent/60 bg-accent/10 text-accent" : "border-zinc-200 bg-white text-zinc-500")}>
                  {k === "photo" ? <Camera className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}{l}{on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        </L>
      </div>

      <div className="sticky bottom-4 mt-6 bg-gradient-to-t from-white via-white to-transparent pt-3">
        <Button className="w-full" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save issue"}
        </Button>
      </div>
    </div>
  );
}

// ── Issue detail + resolve (proof-aware) ────────────────────────────────────
function IssueDetail({ audit, issue, canWrite, onBack, onChanged, onDeleted }: {
  audit: SiteAudit; issue: AuditIssue; canWrite: boolean; onBack: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [proofPhoto, setProofPhoto] = useState<PhotoPayload | null>(null);
  const [proofNote, setProofNote] = useState("");
  const need = issue.proof_required;
  const needPhoto = need.includes("photo");
  const needNote = need.includes("note");
  const proofOk = (!needPhoto || proofPhoto) && (!needNote || proofNote.trim().length > 0);
  const due = dueLabel(issue.due);

  const resolve = useMutation({
    mutationFn: (vars: { reopen?: boolean }) =>
      resolveIssue(vars.reopen
        ? { audit_id: audit.id, issue_id: issue.id, reopen: true }
        : { audit_id: audit.id, issue_id: issue.id, completion: { note: proofNote.trim() || undefined, photo: proofPhoto } }),
    onSuccess: () => { setResolving(false); setProofPhoto(null); setProofNote(""); onChanged(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update.", "error"),
  });
  const sevMut = useMutation({
    mutationFn: (s: Severity) => updateIssue({ audit_id: audit.id, issue_id: issue.id, severity: s }),
    onSuccess: onChanged,
  });
  const del = useMutation({ mutationFn: () => deleteIssue({ audit_id: audit.id, issue_id: issue.id }), onSuccess: onDeleted });

  return (
    <div className="pb-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> Audit</button>

      {issue.photo_url && <img src={issue.photo_url} alt="" className="mb-4 h-52 w-full rounded-xl object-cover" />}
      <h1 className="text-xl font-bold tracking-tight text-midnight">{issue.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SevChip s={issue.severity} />
        <span className="text-sm text-zinc-500">{issue.area}</span>
        {due && !issue.completed && <span className={cn("text-sm font-medium", due.tone === "over" ? "text-red-600" : due.tone === "soon" ? "text-amber-600" : "text-zinc-400")}>{due.text}</span>}
      </div>

      {issue.comment && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Note</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{issue.comment}</div>
        </div>
      )}

      {/* Resolution */}
      <div className="mt-4">
        {issue.completed ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><Check className="h-4 w-4" strokeWidth={2.5} /> Resolved</div>
            <div className="mt-1 text-xs text-emerald-700">
              {issue.completion ? `Closed by ${issue.completion.by_name} · ${new Date(issue.completion.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Closed"}
            </div>
            {issue.completion && (issue.completion.note || issue.completion.photo_url) && (
              <div className="mt-3 flex gap-3 rounded-lg bg-white p-3 ring-1 ring-emerald-100">
                {issue.completion.photo_url && <img src={issue.completion.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
                {issue.completion.note && <div className="text-sm text-zinc-700">{issue.completion.note}</div>}
              </div>
            )}
            {canWrite && <button onClick={() => resolve.mutate({ reopen: true })} className="mt-3 text-xs font-semibold text-accent hover:underline">Reopen</button>}
          </div>
        ) : need.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Proof required to resolve</div>
            <div className="mt-1 text-xs text-amber-700">The auditor requires {need.map((n) => n === "photo" ? "a photo" : "a note").join(" and ")}.</div>
            {!resolving ? (
              canWrite && <Button className="mt-3 w-full" onClick={() => setResolving(true)}><Check className="h-4 w-4" /> Add proof &amp; resolve</Button>
            ) : (
              <div className="mt-3 space-y-3">
                {needPhoto && <PhotoInput photo={proofPhoto} onPick={setProofPhoto} label="Photo of the fix" />}
                {needNote && (
                  <div className="relative">
                    <textarea value={proofNote} onChange={(e) => setProofNote(e.target.value)} rows={3} placeholder="What was done to fix it?" className={cn(inputCls, "resize-y pr-12")} />
                    <div className="absolute bottom-2 right-2"><MicButton onText={(t) => setProofNote((n) => (n ? n + " " : "") + t)} /></div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" className="w-full" onClick={() => setResolving(false)} disabled={resolve.isPending}>Cancel</Button>
                  <Button className="w-full" disabled={!proofOk || resolve.isPending} onClick={() => resolve.mutate({})}><Check className="h-4 w-4" /> {resolve.isPending ? "Saving…" : "Confirm resolved"}</Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          canWrite && (
            <Button className="w-full" onClick={() => resolve.mutate({})} disabled={resolve.isPending}>
              <Check className="h-5 w-5" /> Mark resolved
            </Button>
          )
        )}
      </div>

      {/* Severity quick-edit */}
      {canWrite && !issue.completed && (
        <L label="Severity" className="mt-5">
          <div className="flex gap-2">
            {(["high", "medium", "low"] as const).map((k) => {
              const m = SEVERITY_META[k];
              return (
                <button key={k} onClick={() => sevMut.mutate(k)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold",
                  issue.severity === k ? m.chip + " ring-1" : "border-zinc-200 bg-white text-zinc-500")}>
                  <span className={cn("h-2 w-2 rounded-full", m.dot)} />{m.label}
                </button>
              );
            })}
          </div>
        </L>
      )}

      {canWrite && (
        <button onClick={() => confirmDel ? del.mutate() : setConfirmDel(true)}
          className={cn("mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition",
            confirmDel ? "bg-red-500 text-white" : "bg-red-50 text-red-600")}>
          <Trash2 className="h-4 w-4" /> {confirmDel ? "Tap again to confirm delete" : "Delete issue"}
        </button>
      )}
    </div>
  );
}

// ── Share + signature ───────────────────────────────────────────────────────
function ShareReport({ audit, onBack, onSent }: { audit: SiteAudit; onBack: () => void; onSent: () => void }) {
  const toast = useToast();
  const [toDo, setToDo] = useState(true);
  const [toSdo, setToSdo] = useState(true);
  const [toSelf, setToSelf] = useState(true);
  const [extra, setExtra] = useState("");
  const [message, setMessage] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [signed, setSigned] = useState(false);
  const [sent, setSent] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const toggleIssue = (id: string) =>
    setExcluded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // The report reflects only the included issues, so the summary recomputes.
  const included = audit.issues.filter((i) => !excluded.has(i.id));
  const done = included.filter((i) => i.completed).length;
  const high = included.filter((i) => i.severity === "high" && !i.completed).length;
  const s = { total: included.length, done, open: included.length - done, high, pct: included.length ? Math.round((done / included.length) * 100) : 0 };

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#15324B"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = c.getBoundingClientRect();
      const t = "touches" in e ? e.touches[0] : (e as MouseEvent);
      return [(t.clientX - r.left) * (c.width / r.width), (t.clientY - r.top) * (c.height / r.height)] as const;
    };
    const down = (e: MouseEvent | TouchEvent) => { drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = (e: MouseEvent | TouchEvent) => { if (!drawing.current) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setSigned(true); e.preventDefault(); };
    const up = () => { drawing.current = false; };
    c.addEventListener("mousedown", down); c.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    c.addEventListener("touchstart", down, { passive: false }); c.addEventListener("touchmove", move, { passive: false }); c.addEventListener("touchend", up);
    return () => {
      c.removeEventListener("mousedown", down); c.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      c.removeEventListener("touchstart", down); c.removeEventListener("touchmove", move); c.removeEventListener("touchend", up);
    };
  }, []);
  function clearSig() { const c = cv.current; if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setSigned(false); }

  const share = useMutation({
    mutationFn: () => {
      const sig = cv.current!.toDataURL("image/png");
      const extras = extra.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
      return shareReport({
        audit_id: audit.id, signature: sig, to_do: toDo, to_sdo: toSdo, to_self: toSelf, extra_emails: extras,
        message: message.trim() || undefined, issue_ids: included.map((i) => i.id),
      });
    },
    onSuccess: () => { setSent(true); onSent(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't share.", "error"),
  });

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-emerald-100 text-emerald-600"><Check className="h-10 w-10" strokeWidth={2.5} /></span>
        <div>
          <div className="text-xl font-bold text-midnight">Report shared</div>
          <div className="mt-1 max-w-xs text-sm text-zinc-500">Signed off and sent. The recipients can track every issue to completion.</div>
        </div>
        <Button onClick={onBack}>Back to audit</Button>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-midnight"><ArrowLeft className="h-4 w-4" /> Audit</button>
      <h1 className="mb-4 text-xl font-bold tracking-tight text-midnight">Share report</h1>

      <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center gap-3">
          <Ring pct={s.pct} />
          <div>
            <div className="font-semibold text-midnight">{audit.store_name || `Store #${audit.store_number}`}</div>
            <div className="text-xs text-zinc-500">{fmtDate(audit.date)} · {s.total} issue{s.total === 1 ? "" : "s"} included</div>
          </div>
        </div>
        <div className="flex gap-2">
          <MiniStat n={s.high} label="High" tone="red" /><MiniStat n={s.open} label="Open" tone="accent" /><MiniStat n={s.done} label="Resolved" tone="emerald" />
        </div>
      </div>

      <L label="Message" className="mb-4">
        <div className="relative">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            placeholder="Add a note for the recipients (optional) — or dictate with the mic…"
            className={cn(inputCls, "resize-y pr-12")} />
          <div className="absolute bottom-2 right-2"><MicButton onText={(t) => setMessage((m) => (m ? m + " " : "") + t)} /></div>
        </div>
      </L>

      {audit.issues.length > 0 && (
        <L label={`Issues in report · ${included.length}/${audit.issues.length}`} className="mb-4">
          <div className="space-y-2">
            {audit.issues.map((i) => {
              const on = !excluded.has(i.id);
              return (
                <button key={i.id} onClick={() => toggleIssue(i.id)}
                  className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                    on ? "border-zinc-200 bg-white" : "border-dashed border-zinc-200 bg-zinc-50 opacity-60")}>
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border-2",
                    on ? "border-accent bg-accent text-white" : "border-zinc-300")}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate text-sm", on ? "text-midnight" : "text-zinc-500 line-through")}>{i.title}</span>
                  <SevChip s={i.severity} />
                </button>
              );
            })}
          </div>
        </L>
      )}

      <L label="Send to">
        <div className="space-y-2">
          <RecipientRow label="District Operator" sub="The store's DO" on={toDo} onToggle={() => setToDo((v) => !v)} />
          <RecipientRow label="Above-store (SDO)" sub="The store's SDO" on={toSdo} onToggle={() => setToSdo((v) => !v)} />
          <RecipientRow label="Me" sub="A copy for your records" on={toSelf} onToggle={() => setToSelf((v) => !v)} />
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add other emails (comma-separated)" className={inputCls} />
        </div>
      </L>

      <L label="Sign off" className="mt-4">
        <div className={cn("overflow-hidden rounded-xl border bg-white", signed ? "border-emerald-300" : "border-zinc-200")}>
          <canvas ref={cv} width={640} height={200} className="block h-32 w-full cursor-crosshair touch-none" />
          <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2">
            <span className={cn("text-xs", signed ? "text-emerald-600" : "text-zinc-400")}>{signed ? "✓ Signed" : "Sign with your finger"}</span>
            <button onClick={clearSig} className="text-xs font-semibold text-accent">Clear</button>
          </div>
        </div>
      </L>

      <Button className="mt-5 w-full" disabled={!signed || share.isPending} onClick={() => share.mutate()}>
        <Send className="h-4 w-4" /> {share.isPending ? "Sending…" : "Sign & share report"}
      </Button>
    </div>
  );
}
function MiniStat({ n, label, tone }: { n: number; label: string; tone: "red" | "accent" | "emerald" }) {
  const c = { red: "text-red-600", accent: "text-accent", emerald: "text-emerald-600" }[tone];
  return <div className="flex-1 rounded-xl bg-zinc-50 py-2.5 text-center"><div className={cn("text-xl font-bold tabular-nums leading-none", c)}>{n}</div><div className="mt-1 text-[11px] text-zinc-500">{label}</div></div>;
}
function RecipientRow({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-left">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-midnight">{label}</div>
        <div className="text-[11px] text-zinc-400">{sub}</div>
      </div>
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition", on ? "bg-accent" : "bg-zinc-300")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

// ── voice-to-text dictation (Web Speech API; graceful when unsupported) ──────
function MicButton({ onText }: { onText: (t: string) => void }) {
  const toast = useToast();
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);
  function toggle() {
    if (!SR) { toast.push("Voice input isn't supported on this device.", "error"); return; }
    if (listening) { try { recRef.current?.stop(); } catch { /* ignore */ } setListening(false); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      if (t.trim()) onText(t.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }
  if (!SR) return null;
  return (
    <button type="button" onClick={toggle} aria-label="Dictate"
      className={cn("grid h-9 w-9 place-items-center rounded-full transition", listening ? "animate-pulse bg-red-500 text-white" : "bg-accent text-white")}>
      <Mic className="h-4 w-4" />
    </button>
  );
}

// ── small primitives ────────────────────────────────────────────────────────
const inputCls = "block w-full rounded-xl border-0 bg-white px-3.5 py-3 text-sm text-midnight ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";
function L({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><div className="mb-2 text-xs font-semibold text-zinc-500">{label}</div>{children}</div>;
}
function Chip({ active, onClick, children, grow }: { active: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-3.5 py-2 text-sm font-medium transition", grow && "flex-1",
      active ? "border-accent/60 bg-accent/10 text-accent" : "border-zinc-200 bg-white text-zinc-500")}>{children}</button>
  );
}
