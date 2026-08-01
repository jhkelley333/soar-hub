// Preliminary Review — auto-flags each store's prelim against the budget +
// its own trend, and lets the team log Root Cause + 21-day Action Steps per
// flag. Each author edits only their own note, so a GM's and their DO's notes
// never overwrite each other; everyone sees everyone's.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp, HelpCircle, FileWarning, LineChart, Repeat } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchPlReview, savePlReviewNote, type PlReviewFlag, type PlReviewNote } from "./api";
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
  const canNote = !!profile && ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"].includes(profile.role);
  const qc = useQueryClient();
  const toast = useToast();
  const Icon = TYPE_ICON[flag.type] ?? AlertTriangle;

  const mine = useMemo(() => notes.find((n) => n.author_id === myAuthorId) ?? null, [notes, myAuthorId]);
  const others = notes.filter((n) => n.author_id !== myAuthorId);
  const [rootCause, setRootCause] = useState(mine?.root_cause ?? "");
  const [actionSteps, setActionSteps] = useState(mine?.action_steps ?? "");
  const [trendOpen, setTrendOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => savePlReviewNote({ store, period, line_key: flag.line_key, root_cause: rootCause, action_steps: actionSteps }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pl-review", store, period] });
      toast.push("Note saved.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const dirty = rootCause !== (mine?.root_cause ?? "") || actionSteps !== (mine?.action_steps ?? "");

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
        {others.length > 0 && (
          <div className="space-y-1.5">
            {others.map((n) => (
              <div key={n.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-xs ring-1 ring-zinc-100">
                <div className="font-semibold text-zinc-700">{n.author_name ?? "—"} <span className="font-normal uppercase text-zinc-400">{n.author_role}</span></div>
                {n.root_cause && <div className="mt-0.5"><span className="font-medium text-zinc-500">Root cause:</span> {n.root_cause}</div>}
                {n.action_steps && <div className="mt-0.5"><span className="font-medium text-zinc-500">Action (21 days):</span> {n.action_steps}</div>}
              </div>
            ))}
          </div>
        )}
        {canNote ? (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Root cause (yours)</label>
              <textarea
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                rows={2}
                placeholder="Why is this line off?"
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Action steps — next 21 days (yours)</label>
              <textarea
                value={actionSteps}
                onChange={(e) => setActionSteps(e.target.value)}
                rows={2}
                placeholder="What will you do, and by when?"
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              {mine?.updated_at && !dirty && <span className="text-[11px] text-zinc-400">Saved</span>}
              <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : mine ? "Update note" : "Save note"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">You don't have a role that can add review notes.</p>
        )}
      </div>
    </div>
  );
}
