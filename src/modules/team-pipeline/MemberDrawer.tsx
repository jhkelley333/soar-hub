// Member profile drawer — the editable detail for one roster member, opened
// from any layout (roster, bench ladder, 9-box, GM bench). Talent fields
// auto-save on change; notes are a running thread that also feeds the GM
// bench's "latest comment". Exposed through a context so every card/row can
// open it without prop-drilling.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, FileWarning, Phone, Plus, Star, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { addCorrectiveAction, addNote, fetchCorrectiveActions, fetchNotes, inviteMember, setCorrectiveActionStatus, updateMember } from "./api";
import {
  ASPIRATION_META, CA_CATEGORIES, CA_LEVEL_META, CA_LEVELS, CA_STATUS_META, CA_TEMPLATES,
  INVITE_ROLES, LADDER, LADDER_BY_KEY, RATING_COLOR, RISK_META, RISK_REASONS,
  type Aspiration, type CaLevel, type CorrectiveAction, type FlightRisk, type LadderKey, type MemberPatch, type TeamMember,
} from "./types";

type Ctx = { open: (m: TeamMember) => void; canWrite: boolean; roleEdit: boolean };
const MemberDrawerCtx = createContext<Ctx>({ open: () => {}, canWrite: false, roleEdit: false });
export const useMemberDrawer = () => useContext(MemberDrawerCtx);

export function MemberDrawerProvider({ canWrite, roleEdit, children }: { canWrite: boolean; roleEdit: boolean; children: ReactNode }) {
  const [member, setMember] = useState<TeamMember | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = (m: TeamMember) => { setMember(m); setIsOpen(true); };
  return (
    <MemberDrawerCtx.Provider value={{ open, canWrite, roleEdit }}>
      {children}
      <Drawer open={isOpen} onClose={() => setIsOpen(false)} title="Team member" width="w-full sm:max-w-lg">
        {member && <MemberBody key={member.id} member={member} canWrite={canWrite} roleEdit={roleEdit} />}
      </Drawer>
    </MemberDrawerCtx.Provider>
  );
}

function MemberBody({ member, canWrite, roleEdit }: { member: TeamMember; canWrite: boolean; roleEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<TeamMember>(member);
  useEffect(() => setDraft(member), [member]);

  const save = useMutation({
    mutationFn: (patch: MemberPatch) => updateMember(member.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tp-store-roster"] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
    },
    onError: (e: unknown) => { toast.push((e as Error)?.message ?? "Couldn't save.", "error"); setDraft(member); },
  });
  const set = (patch: MemberPatch) => { if (!canWrite) return; setDraft((d) => ({ ...d, ...patch })); save.mutate(patch); };

  const role = LADDER_BY_KEY[draft.role];
  const reasons = draft.risk_reasons ?? [];
  const toggleReason = (r: string) =>
    set({ risk_reasons: reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r] });

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex items-start gap-3">
        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent/10 text-base font-bold text-accent ring-2",
          { immediate: "ring-red-400", medium: "ring-amber-400", low: "ring-emerald-400", na: "ring-zinc-300" }[draft.flight_risk])}>
          {member.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-bold text-heading">{member.full_name}</h3>
            <AccountBadge has={member.has_account} />
            {draft.status === "loa" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">On LOA</span>}
            {draft.status === "terminated" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Terminated</span>}
          </div>
          <div className="text-sm text-ink-muted">{role?.label}{member.hire_date && ` · since ${new Date(member.hire_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {member.email && (
              <button onClick={() => { navigator.clipboard?.writeText(member.email!); toast.push("Email copied.", "success"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-surface-sunk">
                <Copy className="h-3.5 w-3.5" />{member.email}
              </button>
            )}
            {member.phone && (
              <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-surface-sunk">
                <Phone className="h-3.5 w-3.5" />{member.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {!canWrite && <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted">Read-only — talent edits are for DO and above.</div>}

      {/* role (onboarding) */}
      {canWrite && roleEdit && (
        <Field label="Role">
          <select value={draft.role} onChange={(e) => set({ role: e.target.value as LadderKey })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-heading focus:border-accent focus:outline-none">
            {LADDER.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-subtle">Promote or demote into the right seat. Turn this off in Admin → Feature Flags once onboarding is done.</p>
        </Field>
      )}

      {/* invite (Crew Leader and up, no account yet) */}
      {canWrite && !member.has_account && INVITE_ROLES.includes(draft.role) && (
        <InviteBlock member={member} />
      )}

      {/* risk */}
      <Field label="Risk">
        <div className="grid grid-cols-4 gap-1.5">
          {(["na", "low", "medium", "immediate"] as FlightRisk[]).map((r) => (
            <SegBtn key={r} on={draft.flight_risk === r} disabled={!canWrite} onClick={() => set({ flight_risk: r })}>{RISK_META[r].short}</SegBtn>
          ))}
        </div>
        {draft.flight_risk !== "na" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RISK_REASONS.map((r) => (
              <button key={r} disabled={!canWrite} onClick={() => toggleReason(r)}
                className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50",
                  reasons.includes(r) ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-surface-sunk text-ink-muted hover:text-heading")}>{r}</button>
            ))}
          </div>
        )}
      </Field>

      {/* aspiration */}
      <Field label="Aspiration">
        <div className="grid grid-cols-3 gap-1.5">
          {(["current", "next", "looking"] as Aspiration[]).map((a) => (
            <SegBtn key={a} on={draft.aspiration === a} disabled={!canWrite} onClick={() => set({ aspiration: a })}>{ASPIRATION_META[a].label}</SegBtn>
          ))}
        </div>
      </Field>

      {/* ratings */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Performance"><Rating value={draft.perf} disabled={!canWrite} onPick={(n) => set({ perf: n })} /></Field>
        <Field label="Potential"><Rating value={draft.potential} disabled={!canWrite} onPick={(n) => set({ potential: n })} /></Field>
      </div>

      {/* backfill */}
      {role?.mgr && (
        <Field label="Identified backfill / successor">
          <input defaultValue={draft.backfill ?? ""} disabled={!canWrite} placeholder="Name a ready successor…"
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (member.backfill ?? "")) set({ backfill: v || null }); }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none disabled:opacity-60" />
        </Field>
      )}

      {/* status */}
      {canWrite && (
        <Field label="Status">
          <div className="grid grid-cols-3 gap-1.5">
            <SegBtn on={draft.status === "active"} onClick={() => set({ status: "active" })}>Active</SegBtn>
            <SegBtn on={draft.status === "loa"} onClick={() => set({ status: "loa" })}>On LOA</SegBtn>
            <button onClick={() => set({ status: "terminated" })}
              className={cn("rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                draft.status === "terminated" ? "bg-red-600 text-white" : "bg-surface-sunk text-ink-muted hover:text-red-600")}>
              Terminated
            </button>
          </div>
          {draft.status === "terminated" && <p className="mt-1 text-[11px] text-ink-subtle">Removed from the active pipeline. Find them in the store's Terminated list to rehire.</p>}
        </Field>
      )}

      <NotesThread memberId={member.id} canWrite={canWrite} />
      <CorrectiveActions memberId={member.id} canWrite={canWrite} />
    </div>
  );
}

function CorrectiveActions({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["tp-ca", memberId], queryFn: () => fetchCorrectiveActions(memberId) });
  const actions = q.data?.actions ?? [];

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CorrectiveAction["status"] }) => setCorrectiveActionStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tp-ca", memberId] }),
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update.", "error"),
  });

  return (
    <Field label="Corrective actions">
      {canWrite && !adding && (
        <button onClick={() => setAdding(true)}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk">
          <Plus className="h-3.5 w-3.5" />New write-up
        </button>
      )}
      {adding && <CaForm memberId={memberId} onDone={() => setAdding(false)} />}

      {q.isLoading ? <Skeleton className="h-16 w-full" /> : actions.length === 0 ? (
        !adding && <div className="text-sm text-ink-subtle">No corrective actions on file.</div>
      ) : (
        <ol className="mt-1 flex flex-col gap-2.5">
          {actions.map((a) => {
            const lm = CA_LEVEL_META[a.level];
            const sm = CA_STATUS_META[a.status];
            return (
              <li key={a.id} className="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", lm.chip)}>
                    <FileWarning className="h-3 w-3" />{lm.short}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", sm.chip)}>{sm.label}</span>
                  {a.category && <span className="text-[11px] text-ink-muted">{a.category}</span>}
                  <span className="ml-auto text-[11px] text-ink-subtle">{a.incident_date ? new Date(a.incident_date).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-heading">{a.summary}</p>
                {a.expectations && <p className="mt-1.5 text-xs text-ink-2"><span className="font-semibold">Expectations:</span> {a.expectations}</p>}
                {a.consequence && <p className="mt-1 text-xs text-ink-2"><span className="font-semibold">Consequence:</span> {a.consequence}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                  <span>Issued by {a.issued_by ?? "—"}{a.acknowledged_by ? ` · ack’d by ${a.acknowledged_by}` : ""}</span>
                  {canWrite && (
                    <span className="ml-auto flex gap-1.5">
                      {a.status === "active" && <CaBtn onClick={() => setStatus.mutate({ id: a.id, status: "acknowledged" })}>Mark acknowledged</CaBtn>}
                      {a.status !== "closed" && <CaBtn onClick={() => setStatus.mutate({ id: a.id, status: "closed" })}>Close</CaBtn>}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Field>
  );
}

function CaForm({ memberId, onDone }: { memberId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [level, setLevel] = useState<CaLevel>("verbal");
  const [category, setCategory] = useState<string | null>(null);
  const [incidentDate, setIncidentDate] = useState("");
  const [summary, setSummary] = useState("");
  const [expectations, setExpectations] = useState(CA_TEMPLATES.verbal.expectations);
  const [consequence, setConsequence] = useState(CA_TEMPLATES.verbal.consequence);

  // Picking a level swaps in that level's boilerplate.
  const pickLevel = (l: CaLevel) => {
    setLevel(l);
    setExpectations(CA_TEMPLATES[l].expectations);
    setConsequence(CA_TEMPLATES[l].consequence);
  };

  const create = useMutation({
    mutationFn: () => addCorrectiveAction(memberId, {
      level, category, incident_date: incidentDate || null, summary: summary.trim(),
      expectations: expectations.trim() || null, consequence: consequence.trim() || null,
    }),
    onSuccess: () => {
      toast.push("Corrective action recorded.", "success");
      qc.invalidateQueries({ queryKey: ["tp-ca", memberId] });
      onDone();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't save.", "error"),
  });

  const ta = "w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-3">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {CA_LEVELS.map((l) => <SegBtn key={l} on={level === l} onClick={() => pickLevel(l)}>{CA_LEVEL_META[l].short}</SegBtn>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CA_CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCategory(category === c ? null : c)}
            className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
              category === c ? "bg-midnight text-white" : "bg-surface-sunk text-ink-muted hover:text-heading")}>{c}</button>
        ))}
      </div>
      <label className="text-[11px] font-semibold text-ink-muted">Incident date
        <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-accent focus:outline-none" />
      </label>
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What happened? (required)" className={ta} />
      <textarea value={expectations} onChange={(e) => setExpectations(e.target.value)} rows={2} placeholder="Expectations going forward" className={ta} />
      <textarea value={consequence} onChange={(e) => setConsequence(e.target.value)} rows={2} placeholder="Consequence if it recurs" className={ta} />
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
        <button disabled={!summary.trim() || create.isPending} onClick={() => create.mutate()}
          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {create.isPending ? "Saving…" : "Record write-up"}
        </button>
      </div>
    </div>
  );
}
function CaBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="rounded-md border border-border bg-surface px-2 py-1 font-semibold text-ink-2 transition hover:bg-surface-sunk">{children}</button>;
}

function NotesThread({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const notesQ = useQuery({ queryKey: ["tp-notes", memberId], queryFn: () => fetchNotes(memberId) });
  const post = useMutation({
    mutationFn: () => addNote(memberId, text.trim()),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["tp-notes", memberId] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
      qc.invalidateQueries({ queryKey: ["tp-store-roster"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't add note.", "error"),
  });
  const notes = notesQ.data?.notes ?? [];

  return (
    <Field label="Notes">
      {canWrite && (
        <div className="mb-3 flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a coaching / 1:1 note…"
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none" />
          <button disabled={!text.trim() || post.isPending} onClick={() => post.mutate()}
            className="self-end rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
            {post.isPending ? "Adding…" : "Add note"}
          </button>
        </div>
      )}
      {notesQ.isLoading ? <Skeleton className="h-16 w-full" /> : notes.length === 0 ? (
        <div className="text-sm text-ink-subtle">No notes yet.</div>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-border bg-surface-muted px-3 py-2">
              <p className="whitespace-pre-wrap text-sm text-heading">{n.body}</p>
              <div className="mt-1 text-[11px] text-ink-subtle">{n.author ?? "Someone"} · {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            </li>
          ))}
        </ol>
      )}
    </Field>
  );
}

export function AccountBadge({ has }: { has?: boolean }) {
  return has ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3 w-3" />Account
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 ring-1 ring-zinc-200">No account</span>
  );
}

function InviteBlock({ member }: { member: TeamMember }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(member.email ?? "");
  const invite = useMutation({
    mutationFn: () => inviteMember(member.id, email.trim()),
    onSuccess: () => {
      toast.push(`Invite sent to ${email.trim()}.`, "success");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["tp-store-roster"] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't send invite.", "error"),
  });
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10">
        <UserPlus className="h-3.5 w-3.5" />Invite to set up account
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Invite {member.full_name}</div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoFocus
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none" />
      <p className="text-[11px] text-ink-subtle">Creates a store-scoped login as {LADDER_BY_KEY[member.role]?.label}. They'll get an email to set a password.</p>
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
        <button disabled={!email.includes("@") || invite.isPending} onClick={() => invite.mutate()}
          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {invite.isPending ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{label}</div>{children}</div>;
}
function SegBtn({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={cn("rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:opacity-50",
        on ? "bg-midnight text-white" : "bg-surface-sunk text-ink-muted hover:text-heading")}>{children}</button>
  );
}
function Rating({ value, disabled, onPick }: { value: number | null; disabled?: boolean; onPick: (n: number) => void }) {
  // Filled stars take the colour of the *selected* value, so the rating reads
  // red (low) → green (high) at a glance.
  const tone = value != null ? RATING_COLOR[value] : null;
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button key={n} disabled={disabled} onClick={() => onPick(n)} aria-label={`${n} of 5`}
            className={cn("grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-50",
              on && tone ? `${tone.bg} ${tone.star}` : "bg-surface-sunk text-ink-subtle hover:text-ink-muted")}>
            <Star className="h-4 w-4" fill={on ? "currentColor" : "none"} />
          </button>
        );
      })}
    </div>
  );
}
