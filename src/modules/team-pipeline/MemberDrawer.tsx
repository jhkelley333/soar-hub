// Member profile drawer — the editable detail for one roster member, opened
// from any layout (roster, bench ladder, 9-box, GM bench). Talent fields
// auto-save on change; notes are a running thread that also feeds the GM
// bench's "latest comment". Exposed through a context so every card/row can
// open it without prop-drilling.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openNla, fetchNlaTemplates } from "@/modules/nla/api";
import { BadgeCheck, Check, ChevronDown, Copy, FileWarning, Phone, Plus, Star, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import {
  addCorrectiveAction, addDevItem, addDevMilestone, addNote, addSuccessor, fetchCorrectiveActions, fetchDevPlan,
  fetchMemberReadiness, fetchMemberSignals, fetchNotes, fetchStoreRoster, fetchSuccessors, inviteMember, removeDevItem,
  removeDevMilestone, removeSuccessor, saveDevPlan, setCorrectiveActionStatus, updateDevItem, updateDevMilestone,
  updateMember, updateSuccessor,
} from "./api";
import {
  ASPIRATION_META, CA_CATEGORIES, CA_LEVEL_META, CA_LEVELS, CA_STATUS_META, CA_TEMPLATES, DEV_ITEM_META,
  INVITE_ROLES, LADDER, LADDER_BY_KEY, MILESTONE_META, RATING_COLOR, READINESS_BAND_META, READINESS_META, RISK_META, RISK_REASONS,
  SIGNAL_SEVERITY_META,
  type Aspiration, type CaLevel, type CorrectiveAction, type DevItem, type DevItemStatus,
  type FlightRisk, type LadderKey, type MemberPatch, type MilestoneStatus, type Readiness, type TeamMember,
} from "./types";

// Risk severity order for client-side gap checks (mirror backend RISK_ORDER).
const RISK_RANK: Record<FlightRisk, number> = { na: 0, low: 1, medium: 2, immediate: 3 };

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
      qc.invalidateQueries({ queryKey: ["tp-member-signals", member.id] });
      qc.invalidateQueries({ queryKey: ["tp-risk-review"] });
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
          <ReadinessBadge memberId={member.id} />
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
        <RiskSignals memberId={member.id} currentRisk={draft.flight_risk} canWrite={canWrite} onApply={(r) => set({ flight_risk: r })} />
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

      {/* succession bench */}
      {role?.mgr && (
        <SuccessionBench member={member} legacyBackfill={draft.backfill} canWrite={canWrite}
          onClearLegacy={() => set({ backfill: null })} />
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

      {canWrite && <NlaLaunch member={member} />}
      <DevPlan member={member} canWrite={canWrite} />
      <NotesThread memberId={member.id} canWrite={canWrite} />
      <CorrectiveActions memberId={member.id} canWrite={canWrite} />
    </div>
  );
}

// Data-driven risk cues (discipline, aspiration, tenure, ratings, PDP coverage)
// with a one-tap "apply the suggested risk" when the data flags higher than the
// current manual flag.
function RiskSignals({ memberId, currentRisk, canWrite, onApply }: {
  memberId: string; currentRisk: FlightRisk; canWrite: boolean; onApply: (r: FlightRisk) => void;
}) {
  const q = useQuery({ queryKey: ["tp-member-signals", memberId], queryFn: () => fetchMemberSignals(memberId) });
  if (q.isLoading || q.isError) return null;
  const data = q.data!;
  if (!data.signals.length) return null;
  const showApply = canWrite && RISK_RANK[data.suggested] > RISK_RANK[currentRisk];

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-muted px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Risk signals</span>
        <span className="text-[11px] text-ink-subtle">from the data</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {data.signals.map((s) => {
          const sm = SIGNAL_SEVERITY_META[s.severity];
          return (
            <li key={s.key} className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", sm.dot)} />
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-heading">{s.label}</span>
                <span className="text-[12px] text-ink-muted"> — {s.detail}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {showApply && (
        <button onClick={() => onApply(data.suggested)}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90">
          Set risk to {RISK_META[data.suggested].short}
        </button>
      )}
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

// Open a Next Level Assessment on this roster member (needs an app account so
// they can self-assess). Feeds the compare/align + PDP loop.
function NlaLaunch({ member }: { member: TeamMember }) {
  const navigate = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ["nla-templates"], queryFn: fetchNlaTemplates, staleTime: 5 * 60_000 });
  const templates = q.data?.templates ?? [];
  const [target, setTarget] = useState("");
  useEffect(() => {
    const ts = q.data?.templates ?? [];
    if (!target && ts.length) setTarget(ts[0].target_role);
  }, [q.data, target]);

  const open = useMutation({
    mutationFn: () => openNla({
      subject_profile_id: member.profile_id as string, subject_member_id: member.id,
      target_role: target, store_id: member.store_id,
    }),
    onSuccess: (r) => { toast.push(r.existed ? "Opening the existing assessment." : "Assessment opened.", "success"); navigate(`/nla/${r.assessment_id}`); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not open.", "error"),
  });

  return (
    <Field label="Next Level Assessment">
      {!member.has_account || !member.profile_id ? (
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          Invite this person to an app account first — they self-assess as part of the NLA.
        </div>
      ) : templates.length === 0 ? (
        <div className="text-sm text-ink-subtle">No active assessment templates yet.</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-heading focus:border-accent focus:outline-none">
            {templates.map((t) => <option key={t.id} value={t.target_role}>{t.title}</option>)}
          </select>
          <button disabled={!target || open.isPending} onClick={() => open.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-midnight px-3 py-2 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
            {open.isPending ? "Opening…" : "Open assessment"}
          </button>
        </div>
      )}
    </Field>
  );
}

const READINESS_ORDER: Readiness[] = ["now", "6mo", "12mo"];

// Ranked succession bench for a manager seat — internal roster members or typed
// names, each tagged ready-now / 6mo / 12mo. Feeds the Succession & Risk
// roll-up's "ready vs. developing vs. exposed" coverage.
function SuccessionBench({ member, legacyBackfill, canWrite, onClearLegacy }: {
  member: TeamMember; legacyBackfill: string | null; canWrite: boolean; onClearLegacy: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["tp-successors", member.id], queryFn: () => fetchSuccessors(member.id) });
  const bench = q.data?.successors ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tp-successors", member.id] });
    qc.invalidateQueries({ queryKey: ["tp-succession"] });
  };

  const setReadiness = useMutation({
    mutationFn: ({ id, readiness }: { id: string; readiness: Readiness }) => updateSuccessor(id, { readiness }),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update.", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeSuccessor(id),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't remove.", "error"),
  });

  return (
    <Field label="Succession bench">
      {canWrite && !adding && (
        <button onClick={() => setAdding(true)}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk">
          <Plus className="h-3.5 w-3.5" />Add successor
        </button>
      )}
      {adding && <SuccessorForm member={member} onDone={() => setAdding(false)} onSaved={invalidate} />}

      {q.isLoading ? <Skeleton className="h-12 w-full" /> : bench.length === 0 && !legacyBackfill ? (
        !adding && <div className="text-sm text-ink-subtle">No successor identified yet.</div>
      ) : (
        <ol className="mt-1 flex flex-col gap-2">
          {bench.map((s, i) => {
            const rm = READINESS_META[s.readiness];
            return (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-sunk text-[11px] font-bold text-ink-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-heading">{s.name}</div>
                  {s.successor_role && <div className="text-[11px] text-ink-subtle">{LADDER_BY_KEY[s.successor_role]?.label}{s.successor_member_id ? "" : " · external"}</div>}
                  {!s.successor_role && <div className="text-[11px] text-ink-subtle">External candidate</div>}
                </div>
                {canWrite ? (
                  <select value={s.readiness} onChange={(e) => setReadiness.mutate({ id: s.id, readiness: e.target.value as Readiness })}
                    className={cn("rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset focus:outline-none", rm.chip)}>
                    {READINESS_ORDER.map((r) => <option key={r} value={r}>{READINESS_META[r].short}</option>)}
                  </select>
                ) : (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", rm.chip)}>{rm.short}</span>
                )}
                {canWrite && (
                  <button onClick={() => remove.mutate(s.id)} title="Remove"
                    className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
          {legacyBackfill && (
            <li className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-heading">{legacyBackfill}</div>
                <div className="text-[11px] text-ink-subtle">Legacy note · add above with a readiness to replace</div>
              </div>
              {canWrite && (
                <button onClick={onClearLegacy} title="Clear legacy note"
                  className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          )}
        </ol>
      )}
    </Field>
  );
}

function SuccessorForm({ member, onDone, onSaved }: { member: TeamMember; onDone: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"internal" | "external">("internal");
  const [memberId, setMemberId] = useState("");
  const [name, setName] = useState("");
  const [readiness, setReadiness] = useState<Readiness>("6mo");

  // Candidate pool: everyone else on the incumbent's store roster.
  const rosterQ = useQuery({ queryKey: ["tp-store-roster", member.store_id], queryFn: () => fetchStoreRoster(member.store_id) });
  const candidates = (rosterQ.data?.roster ?? []).filter((m) => m.id !== member.id);

  const create = useMutation({
    mutationFn: () => addSuccessor(member.id, mode === "internal"
      ? { successor_member_id: memberId, readiness }
      : { successor_name: name.trim(), readiness }),
    onSuccess: () => { toast.push("Successor added.", "success"); onSaved(); onDone(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't add.", "error"),
  });

  const canSave = mode === "internal" ? !!memberId : !!name.trim();

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-3">
      <div className="grid grid-cols-2 gap-1.5">
        <SegBtn on={mode === "internal"} onClick={() => setMode("internal")}>From roster</SegBtn>
        <SegBtn on={mode === "external"} onClick={() => setMode("external")}>External name</SegBtn>
      </div>
      {mode === "internal" ? (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading focus:border-accent focus:outline-none">
          <option value="">{rosterQ.isLoading ? "Loading roster…" : "Pick a team member…"}</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name} · {LADDER_BY_KEY[c.role]?.abbr}</option>)}
        </select>
      ) : (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate name"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none" />
      )}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-ink-muted">Readiness</div>
        <div className="grid grid-cols-3 gap-1.5">
          {READINESS_ORDER.map((r) => <SegBtn key={r} on={readiness === r} onClick={() => setReadiness(r)}>{READINESS_META[r].short}</SegBtn>)}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
        <button disabled={!canSave || create.isPending} onClick={() => create.mutate()}
          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {create.isPending ? "Adding…" : "Add to bench"}
        </button>
      </div>
    </div>
  );
}

const PDP_INPUT = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none disabled:opacity-60";
const PDP_TA = "w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none disabled:opacity-60";

// Partner Development Plan (PDP) — a career development map: a future-role
// header plus development goals (focus area → goal → actions → date →
// progress), modeled on the Sonic PDP template with Starbucks' coaching cues.
function DevPlan({ member, canWrite }: { member: TeamMember; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["tp-dev-plan", member.id], queryFn: () => fetchDevPlan(member.id) });
  const plan = q.data?.plan ?? null;
  const items = q.data?.items ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tp-dev-plan", member.id] });

  const saveHeader = useMutation({
    mutationFn: (patch: Partial<{ target_role: string | null; target_date: string | null }>) => saveDevPlan(member.id, patch),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't save.", "error"),
  });

  return (
    <Field label="Development plan (PDP)">
      <p className="mb-2.5 text-[11px] leading-snug text-ink-subtle">
        A career development map — the skills to grow toward a future role. Employee-driven; revisit each development conversation.
      </p>

      {q.isLoading ? <Skeleton className="h-20 w-full" /> : (
        <>
          {/* header — future role + target date */}
          <div key={plan?.id ?? "new"} className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-ink-muted">Future role
              <input defaultValue={plan?.target_role ?? ""} disabled={!canWrite} placeholder="e.g. General Manager"
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (plan?.target_role ?? "")) saveHeader.mutate({ target_role: v || null }); }}
                className={cn(PDP_INPUT, "mt-1")} />
            </label>
            <label className="text-[11px] font-semibold text-ink-muted">Ready by
              <input type="date" defaultValue={plan?.target_date ?? ""} disabled={!canWrite}
                onChange={(e) => saveHeader.mutate({ target_date: e.target.value || null })}
                className={cn(PDP_INPUT, "mt-1")} />
            </label>
          </div>

          {canWrite && !adding && (
            <button onClick={() => setAdding(true)}
              className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk">
              <Plus className="h-3.5 w-3.5" />Add development goal
            </button>
          )}
          {adding && <DevItemForm member={member} onDone={() => setAdding(false)} onSaved={invalidate} />}

          {items.length === 0 ? (
            !adding && <div className="text-sm text-ink-subtle">No development goals yet.</div>
          ) : (
            <ol className="flex flex-col gap-2">
              {items.map((it) => <DevItemCard key={it.id} item={it} canWrite={canWrite} onChanged={invalidate} />)}
            </ol>
          )}
        </>
      )}
    </Field>
  );
}

function DevItemForm({ member, onDone, onSaved }: { member: TeamMember; onDone: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [focus, setFocus] = useState("");
  const [goal, setGoal] = useState("");
  const [actions, setActions] = useState("");
  const [date, setDate] = useState("");

  const create = useMutation({
    mutationFn: () => addDevItem(member.id, {
      focus_area: focus.trim(), goal: goal.trim() || null, actions: actions.trim() || null, target_date: date || null,
    }),
    onSuccess: () => { toast.push("Development goal added.", "success"); onSaved(); onDone(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't add.", "error"),
  });

  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-xl border border-border bg-surface-muted p-3">
      <label className="text-[11px] font-semibold text-ink-muted">Behavior / skill to develop
        <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="A specific skill or behavior (not “get promoted”)" className={cn(PDP_INPUT, "mt-1")} />
      </label>
      <label className="text-[11px] font-semibold text-ink-muted">Goal — what does “great” look like?
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="Make it measurable." className={cn(PDP_TA, "mt-1")} />
      </label>
      <label className="text-[11px] font-semibold text-ink-muted">Development activities — experiences, people, training
        <textarea value={actions} onChange={(e) => setActions(e.target.value)} rows={2} placeholder="Who can help? What could they own?" className={cn(PDP_TA, "mt-1")} />
        <span className="mt-1 block text-[10px] text-ink-subtle">Tip: ~70% of growth is on-the-job, 20% from others, 10% formal training.</span>
      </label>
      <label className="text-[11px] font-semibold text-ink-muted">Target date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(PDP_INPUT, "mt-1 sm:w-48")} />
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-sunk">Cancel</button>
        <button disabled={!focus.trim() || create.isPending} onClick={() => create.mutate()}
          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {create.isPending ? "Adding…" : "Add goal"}
        </button>
      </div>
    </div>
  );
}

const DEV_STATUSES: DevItemStatus[] = ["open", "in_progress", "done"];

function DevItemCard({ item, canWrite, onChanged }: { item: DevItem; canWrite: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const patch = useMutation({
    mutationFn: (p: Parameters<typeof updateDevItem>[1]) => updateDevItem(item.id, p),
    onSuccess: onChanged,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't save.", "error"),
  });
  const remove = useMutation({
    mutationFn: () => removeDevItem(item.id),
    onSuccess: onChanged,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't remove.", "error"),
  });
  const sm = DEV_ITEM_META[item.status];

  return (
    <li className="rounded-xl border border-border bg-surface-muted">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-subtle transition", open && "rotate-180")} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-heading">{item.focus_area}</span>
        {item.target_date && <span className="shrink-0 text-[11px] text-ink-subtle">{new Date(item.target_date).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</span>}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", sm.chip)}>{sm.label}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
          <label className="text-[11px] font-semibold text-ink-muted">Goal — what does “great” look like?
            <textarea defaultValue={item.goal ?? ""} disabled={!canWrite} rows={2} placeholder="Make it measurable."
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.goal ?? "")) patch.mutate({ goal: v || null }); }}
              className={cn(PDP_TA, "mt-1")} />
          </label>
          <label className="text-[11px] font-semibold text-ink-muted">Development activities
            <textarea defaultValue={item.actions ?? ""} disabled={!canWrite} rows={2} placeholder="Experiences, people, training (70/20/10)."
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.actions ?? "")) patch.mutate({ actions: v || null }); }}
              className={cn(PDP_TA, "mt-1")} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-semibold text-ink-muted">Target date
              <input type="date" defaultValue={item.target_date ?? ""} disabled={!canWrite}
                onChange={(e) => patch.mutate({ target_date: e.target.value || null })}
                className={cn(PDP_INPUT, "mt-1 w-44")} />
            </label>
            <div className="min-w-[10rem] flex-1">
              <div className="mb-1 text-[11px] font-semibold text-ink-muted">Status</div>
              <div className="grid grid-cols-3 gap-1.5">
                {DEV_STATUSES.map((s) => <SegBtn key={s} on={item.status === s} disabled={!canWrite} onClick={() => patch.mutate({ status: s })}>{DEV_ITEM_META[s].label}</SegBtn>)}
              </div>
            </div>
          </div>
          <label className="text-[11px] font-semibold text-ink-muted">Progress / conversation notes
            <textarea defaultValue={item.progress ?? ""} disabled={!canWrite} rows={2} placeholder="Add progress before your next development conversation."
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (item.progress ?? "")) patch.mutate({ progress: v || null }); }}
              className={cn(PDP_TA, "mt-1")} />
          </label>
          <Milestones item={item} canWrite={canWrite} onChanged={onChanged} />
          {canWrite && (
            <div className="flex justify-end">
              <button onClick={() => remove.mutate()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />Remove goal
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const MILESTONE_STATUSES: MilestoneStatus[] = ["not_started", "in_progress", "done", "blocked"];

// Day 30/60/90 steps under a development goal. NLA-created plans seed these;
// leaders can add/edit/complete them.
function Milestones({ item, canWrite, onChanged }: { item: DevItem; canWrite: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const ms = item.milestones ?? [];
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");

  const add = useMutation({
    mutationFn: () => addDevMilestone(item.id, { title: title.trim(), due_date: date || null }),
    onSuccess: () => { setTitle(""); setDate(""); setAdding(false); onChanged(); },
    onError: err,
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; p: Parameters<typeof updateDevMilestone>[1] }) => updateDevMilestone(v.id, v.p),
    onSuccess: onChanged, onError: err,
  });
  const remove = useMutation({ mutationFn: (id: string) => removeDevMilestone(id), onSuccess: onChanged, onError: err });

  const done = ms.filter((m) => m.status === "done").length;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-ink-muted">Milestones{ms.length > 0 ? ` · ${done}/${ms.length} done` : ""}</span>
        {canWrite && !adding && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent"><Plus className="h-3 w-3" />Add step</button>}
      </div>
      {ms.length === 0 && !adding && <div className="text-[11px] text-ink-subtle">No milestones yet.</div>}
      <ol className="flex flex-col gap-1.5">
        {ms.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            {canWrite ? (
              <button onClick={() => patch.mutate({ id: m.id, p: { status: m.status === "done" ? "not_started" : "done" } })}
                className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", m.status === "done" ? "border-emerald-500 bg-emerald-500" : "border-border")}>
                {m.status === "done" && <Check className="h-2.5 w-2.5 text-white" />}
              </button>
            ) : (
              <span className={cn("h-2 w-2 shrink-0 rounded-full", m.status === "done" ? "bg-emerald-500" : "bg-zinc-300")} />
            )}
            <span className={cn("min-w-0 flex-1 truncate text-xs", m.status === "done" ? "text-ink-subtle line-through" : "text-heading")}>{m.title}</span>
            {m.due_date && <span className="shrink-0 text-[10px] text-ink-subtle">{new Date(m.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
            {canWrite && (
              <select value={m.status} onChange={(e) => patch.mutate({ id: m.id, p: { status: e.target.value as MilestoneStatus } })}
                className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset focus:outline-none", MILESTONE_META[m.status].chip)}>
                {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{MILESTONE_META[s].label}</option>)}
              </select>
            )}
            {canWrite && <button onClick={() => remove.mutate(m.id)} className="shrink-0 text-ink-subtle hover:text-red-600"><Trash2 className="h-3 w-3" /></button>}
          </li>
        ))}
      </ol>
      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone" className="min-w-[8rem] flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-heading focus:border-accent focus:outline-none" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-heading focus:border-accent focus:outline-none" />
          <button disabled={!title.trim() || add.isPending} onClick={() => add.mutate()} className="rounded-lg bg-midnight px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Add</button>
          <button onClick={() => { setAdding(false); setTitle(""); setDate(""); }} className="rounded-lg border border-border px-2 py-1 text-xs text-ink-2">Cancel</button>
        </div>
      )}
    </div>
  );
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

// Latest Next Level Assessment readiness for this member (if any acknowledged).
function ReadinessBadge({ memberId }: { memberId: string }) {
  const q = useQuery({ queryKey: ["tp-member-readiness", memberId], queryFn: () => fetchMemberReadiness(memberId) });
  const r = q.data?.readiness;
  if (!r) return null;
  const bm = READINESS_BAND_META[r.readiness_band];
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", bm.chip)}>
        NLA: {bm.label} for {r.target_role.toUpperCase()}
      </span>
      {r.snapshot_date && <span className="text-[11px] text-ink-subtle">{new Date(r.snapshot_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}
      {r.reassess_due && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Reassess due</span>}
    </div>
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
