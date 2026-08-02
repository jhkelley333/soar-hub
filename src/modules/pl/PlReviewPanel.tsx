// Preliminary Review — auto-flags each store's prelim against the budget + its
// own trend, and lets the team log Root Cause + 21-day Action Steps per flag.
// Notes are an append-only log: each save is its own timestamped, attributed
// entry (authors edit/delete only their own), and everyone sees everyone's. A
// DO (or above) signs off per store once they've reviewed the notes; the
// sign-off goes stale if a note changes after it, prompting a re-sign.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp, HelpCircle, FileWarning, LineChart, Repeat, CheckCircle2, Clock, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchPlReview, savePlReviewNote, updatePlReviewNote, deletePlReviewNote, savePlReviewSignoff,
  type PlReviewFlag, type PlReviewNote, type PlReviewSignoff,
} from "./api";
import { LineTrendModal } from "./PlPage";

const SEV: Record<string, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  med: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const TYPE_ICON: Record<string, typeof AlertTriangle> = {
  over_budget: AlertTriangle,
  anomaly: TrendingUp,
  verify_zero: HelpCircle,
  missing: FileWarning,
  run_rate: Repeat,
};
const TYPE_LABEL: Record<string, string> = {
  over_budget: "Over budget",
  anomaly: "Anomaly",
  verify_zero: "Verify",
  missing: "Missing?",
  run_rate: "Run-rate",
};

const NOTE_ROLES = ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"];
const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PlReviewPanel({ store, period }: { store: string; period: string }) {
  const q = useQuery({
    queryKey: ["pl-review", store, period],
    queryFn: () => fetchPlReview(store, period),
    staleTime: 30_000,
  });

  if (q.isLoading) return <div className="mt-6 text-sm text-zinc-500">Loading review…</div>;
  if (q.isError) return null; // review is additive — never block the statement
  const data = q.data;
  if (!data) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-midnight">
          Preliminary Review
          <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
            {data.flags.length} flag{data.flags.length === 1 ? "" : "s"}
          </span>
        </h3>
      </div>
      {data.flags.length === 0 ? (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          No flags — every controllable is within budget and in line with this store's trend.
        </div>
      ) : (
        <div className="space-y-3">
          {data.flags.map((f) => (
            <FlagCard
              key={`${f.line_key}:${f.type}`}
              flag={f}
              store={store}
              period={period}
              notes={data.notes.filter((n) => n.line_key === f.line_key)}
              myAuthorId={data.my_author_id}
            />
          ))}
        </div>
      )}

      <SignoffCard store={store} period={period} signoff={data.signoff} canSign={data.can_sign} />
    </div>
  );
}

// ── DO sign-off (store-level) ────────────────────────────────────────
function SignoffCard({ store, period, signoff, canSign }: {
  store: string;
  period: string;
  signoff: PlReviewSignoff | null;
  canSign: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const sign = useMutation({
    mutationFn: () => savePlReviewSignoff({ store, period }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pl-review", store, period] });
      qc.invalidateQueries({ queryKey: ["pl-rollup"] });
      toast.push("Signed off — review recorded.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Sign-off failed.", "error"),
  });

  const who = signoff ? `${signoff.signed_by_name ?? "—"}${signoff.signed_by_role ? ` · ${signoff.signed_by_role.toUpperCase()}` : ""}` : "";

  // Signed and current.
  if (signoff && !signoff.stale) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="font-semibold">Reviewed &amp; signed off</span>
        <span>by {who} · {fmtTime(signoff.signed_at)}</span>
        {canSign && (
          <button type="button" onClick={() => sign.mutate()} disabled={sign.isPending}
            className="ml-auto text-[11px] font-semibold text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-900 disabled:opacity-50">
            {sign.isPending ? "Signing…" : "Re-sign"}
          </button>
        )}
      </div>
    );
  }

  // Signed but a note changed after — prompt a re-sign.
  if (signoff && signoff.stale) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <Clock className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="font-semibold">Notes changed since sign-off</span>
        <span>— last signed by {who} · {fmtTime(signoff.signed_at)}</span>
        {canSign && (
          <Button variant="primary" size="sm" className="ml-auto" disabled={sign.isPending} onClick={() => sign.mutate()}>
            {sign.isPending ? "Signing…" : "Re-sign"}
          </Button>
        )}
      </div>
    );
  }

  // Not yet signed.
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200">
      <Clock className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={2} />
      <span>Not yet signed off by a DO.</span>
      {canSign && (
        <Button variant="primary" size="sm" className="ml-auto" disabled={sign.isPending} onClick={() => sign.mutate()}>
          {sign.isPending ? "Signing…" : "Sign off — I've reviewed the notes"}
        </Button>
      )}
    </div>
  );
}

function FlagCard({
  flag,
  store,
  period,
  notes,
  myAuthorId,
}: {
  flag: PlReviewFlag;
  store: string;
  period: string;
  notes: PlReviewNote[];
  myAuthorId: string;
}) {
  const { profile } = useAuth();
  const canNote = !!profile && NOTE_ROLES.includes(profile.role);
  const qc = useQueryClient();
  const toast = useToast();
  const Icon = TYPE_ICON[flag.type] ?? AlertTriangle;

  const [rootCause, setRootCause] = useState("");
  const [actionSteps, setActionSteps] = useState("");
  const [trendOpen, setTrendOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pl-review", store, period] });

  // Append a new entry, then clear the compose box (notes never stay in it).
  const save = useMutation({
    mutationFn: () => savePlReviewNote({ store, period, line_key: flag.line_key, root_cause: rootCause, action_steps: actionSteps }),
    onSuccess: () => {
      setRootCause("");
      setActionSteps("");
      invalidate();
      qc.invalidateQueries({ queryKey: ["pl-rollup"] });
      toast.push("Note added.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const canSubmit = rootCause.trim().length > 0 || actionSteps.trim().length > 0;

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <button
        type="button"
        onClick={() => setTrendOpen(true)}
        title="See this line's trend across periods"
        className="group flex w-full flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-left hover:bg-zinc-50"
      >
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1", SEV[flag.severity])}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />{TYPE_LABEL[flag.type]}
        </span>
        <span className="text-sm font-semibold text-midnight">{flag.label}</span>
        <span className="text-sm text-zinc-600">{flag.message}</span>
        <LineChart className="ml-auto h-4 w-4 shrink-0 text-zinc-300 group-hover:text-accent" strokeWidth={2} />
      </button>
      <LineTrendModal open={trendOpen} onClose={() => setTrendOpen(false)} store={store} label={flag.stmt_label} />
      <div className="space-y-3 px-4 py-3">
        {flag.context.length > 0 && (
          <ul className="space-y-1">
            {flag.context.map((c, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-zinc-600">
                <span className="mt-0.5 text-zinc-400">•</span>{c}
              </li>
            ))}
          </ul>
        )}

        {canNote ? (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Root cause</label>
              <textarea
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                rows={2}
                placeholder="Why is this line off?"
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Action steps — next 21 days</label>
              <textarea
                value={actionSteps}
                onChange={(e) => setActionSteps(e.target.value)}
                rows={2}
                placeholder="What will you do, and by when?"
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-center justify-end">
              <Button variant="primary" size="sm" disabled={!canSubmit || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Adding…" : "Add note"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">You don't have a role that can add review notes.</p>
        )}

        {/* Saved notes — a stamped, attributed log below the compose box. */}
        {notes.length > 0 && (
          <div className="space-y-1.5 border-t border-zinc-100 pt-3">
            {notes.map((n) => (
              <NoteEntry key={n.id} note={n} mine={n.author_id === myAuthorId} onChanged={() => { invalidate(); qc.invalidateQueries({ queryKey: ["pl-rollup"] }); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One saved note in the log — read-only card, with edit/delete for the author.
function NoteEntry({ note, mine, onChanged }: { note: PlReviewNote; mine: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [rootCause, setRootCause] = useState(note.root_cause ?? "");
  const [actionSteps, setActionSteps] = useState(note.action_steps ?? "");

  const edited = note.updated_at !== note.created_at;

  const update = useMutation({
    mutationFn: () => updatePlReviewNote({ id: note.id, root_cause: rootCause, action_steps: actionSteps }),
    onSuccess: () => { setEditing(false); onChanged(); toast.push("Note updated.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Update failed.", "error"),
  });
  const remove = useMutation({
    mutationFn: () => deletePlReviewNote({ id: note.id }),
    onSuccess: () => { onChanged(); toast.push("Note deleted.", "info"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  if (editing) {
    return (
      <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-accent/40">
        <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2}
          placeholder="Root cause" className="block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent" />
        <textarea value={actionSteps} onChange={(e) => setActionSteps(e.target.value)} rows={2}
          placeholder="Action steps — next 21 days" className="mt-1.5 block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent" />
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setRootCause(note.root_cause ?? ""); setActionSteps(note.action_steps ?? ""); }}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={update.isPending || (!rootCause.trim() && !actionSteps.trim())} onClick={() => update.mutate()}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs ring-1 ring-zinc-100">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-zinc-700">{note.author_name ?? "—"}</span>
        <span className="font-normal uppercase text-zinc-400">{note.author_role}</span>
        <span className="text-zinc-400">· {fmtTime(note.created_at)}{edited ? " · edited" : ""}</span>
        {mine && (
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" title="Edit" onClick={() => setEditing(true)} className="text-zinc-400 hover:text-accent">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button type="button" title="Delete" onClick={() => { if (window.confirm("Delete this note?")) remove.mutate(); }} disabled={remove.isPending} className="text-zinc-400 hover:text-red-600 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </span>
        )}
      </div>
      {note.root_cause && <div className="mt-1"><span className="font-medium text-zinc-500">Root cause:</span> {note.root_cause}</div>}
      {note.action_steps && <div className="mt-0.5"><span className="font-medium text-zinc-500">Action (21 days):</span> {note.action_steps}</div>}
    </div>
  );
}
