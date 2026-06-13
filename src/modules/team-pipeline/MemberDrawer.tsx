// Member profile drawer — the editable detail for one roster member, opened
// from any layout (roster, bench ladder, 9-box, GM bench). Talent fields
// auto-save on change; notes are a running thread that also feeds the GM
// bench's "latest comment". Exposed through a context so every card/row can
// open it without prop-drilling.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Phone, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { addNote, fetchNotes, updateMember } from "./api";
import {
  ASPIRATION_META, LADDER_BY_KEY, RISK_META, RISK_REASONS,
  type Aspiration, type FlightRisk, type MemberPatch, type TeamMember,
} from "./types";

type Ctx = { open: (m: TeamMember) => void; canWrite: boolean };
const MemberDrawerCtx = createContext<Ctx>({ open: () => {}, canWrite: false });
export const useMemberDrawer = () => useContext(MemberDrawerCtx);

export function MemberDrawerProvider({ canWrite, children }: { canWrite: boolean; children: ReactNode }) {
  const [member, setMember] = useState<TeamMember | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = (m: TeamMember) => { setMember(m); setIsOpen(true); };
  return (
    <MemberDrawerCtx.Provider value={{ open, canWrite }}>
      {children}
      <Drawer open={isOpen} onClose={() => setIsOpen(false)} title="Team member" width="w-full sm:max-w-lg">
        {member && <MemberBody key={member.id} member={member} canWrite={canWrite} />}
      </Drawer>
    </MemberDrawerCtx.Provider>
  );
}

function MemberBody({ member, canWrite }: { member: TeamMember; canWrite: boolean }) {
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
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold text-heading">{member.full_name}</h3>
            {draft.status === "loa" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">On LOA</span>}
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

      {/* flight risk */}
      <Field label="Flight risk">
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
          <div className="grid grid-cols-2 gap-1.5">
            <SegBtn on={draft.status === "active"} onClick={() => set({ status: "active" })}>Active</SegBtn>
            <SegBtn on={draft.status === "loa"} onClick={() => set({ status: "loa" })}>On LOA</SegBtn>
          </div>
        </Field>
      )}

      <NotesThread memberId={member.id} canWrite={canWrite} />
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
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} disabled={disabled} onClick={() => onPick(n)} aria-label={`${n} of 5`}
          className={cn("grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-50",
            value != null && n <= value ? "bg-amber-100 text-amber-600" : "bg-surface-sunk text-ink-subtle hover:text-ink-muted")}>
          <Star className="h-4 w-4" fill={value != null && n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}
