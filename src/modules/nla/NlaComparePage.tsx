// Compare + align (CompareAlignScreen, restyled). Renders the self-vs-leader
// gap per competency and lets the pair select 2-3 focus areas that roll into
// the development plan (Phase 4). Only unlocks once both sides have submitted.
import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronLeft, Info, Plus, Target, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchNlaComparison, removeNlaFocus, setNlaFocus } from "./api";
import { GAP_META, RATING_META, RATING_SCORE, type ComparisonRow, type Rating } from "./types";

// Gap track: hollow marker = self, filled = leader. Distance between = the gap.
function Track({ self, leader, color }: { self: Rating; leader: Rating; color: string }) {
  const x = (r: Rating) => 12 + ((RATING_SCORE[r] - 1) / 2) * 132;
  const xs = x(self), xl = x(leader);
  return (
    <svg width="156" height="40" className="shrink-0" aria-hidden="true">
      <line x1="12" y1="20" x2="144" y2="20" stroke="currentColor" className="text-border" strokeWidth="2" strokeLinecap="round" />
      {[12, 78, 144].map((tx) => <line key={tx} x1={tx} y1="15" x2={tx} y2="25" stroke="currentColor" className="text-border" strokeWidth="1.5" />)}
      <line x1={xs} y1="11" x2={xl} y2="29" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={xl} cy="29" r="5" fill={color} />
      <circle cx={xs} cy="11" r="5" fill="#fff" stroke="#0f172a" strokeWidth="2" />
    </svg>
  );
}

export function NlaComparePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["nla-comparison", id], queryFn: () => fetchNlaComparison(id), enabled: !!id });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["nla-comparison", id] });
    qc.invalidateQueries({ queryKey: ["nla-list"] });
  };
  const setFocus = useMutation({
    mutationFn: (v: { competency_key: string; note?: string | null; suggested_resource?: string | null }) => setNlaFocus({ assessment_id: id, ...v }),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not update.", "error"),
  });
  const removeFocus = useMutation({
    mutationFn: (key: string) => removeNlaFocus({ assessment_id: id, competency_key: key }),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not update.", "error"),
  });

  const groups = useMemo(() => {
    const m = new Map<string, ComparisonRow[]>();
    for (const r of q.data?.rows ?? []) { if (!m.has(r.category)) m.set(r.category, []); m.get(r.category)!.push(r); }
    return Array.from(m.entries());
  }, [q.data]);

  if (q.isLoading) return <div className="mx-auto max-w-5xl space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return (
    <div className="mx-auto max-w-2xl">
      <BackLink onClick={() => navigate("/nla")} />
      <EmptyState title="Comparison not ready" description={(q.error as Error)?.message ?? "Both sides must submit first."} />
    </div>
  );

  const data = q.data!;
  const focusKeys = new Set(data.focus_areas.map((f) => f.competency_key));
  const atLimit = focusKeys.size >= 3;
  const canEdit = data.can_edit && !data.locked;
  const byKey = new Map((data.rows).map((r) => [r.competency_key, r]));

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink onClick={() => navigate("/nla")} />
      {/* header */}
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">SOAR Hub · Next Level Assessment</div>
        <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold text-heading">{data.assessment.subject_name}</h1>
          <span className="text-sm text-ink-muted">to {data.assessment.target_role.toUpperCase()}</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">Self-assessment and leader assessment complete · {data.assessment.leader_name}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* comparison */}
        <div className="space-y-5 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            {(["aligned", "blind_spot", "confidence_gap"] as const).map((k) => (
              <div key={k} className="rounded-xl border border-border bg-surface p-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: GAP_META[k].color }} />
                  <span className="text-2xl font-bold tabular-nums text-heading">{data.summary[k]}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-muted">{GAP_META[k].label}{data.summary[k] === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <svg width="42" height="16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="#fff" stroke="#0f172a" strokeWidth="2" /><circle cx="34" cy="8" r="4.5" fill="#0f172a" /></svg>
              Self / Leader
            </span>
            <span>Opportunity → Aspiring → Modeling</span>
            <span className="flex items-center gap-1.5 text-ink-subtle"><Info className="h-3 w-3" /> Distance between markers = the gap to discuss</span>
          </div>

          {groups.map(([cat, rows]) => (
            <div key={cat} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle">{cat}</div>
              <div className="divide-y divide-border">
                {rows.map((r) => {
                  const gm = r.gap_type in GAP_META ? GAP_META[r.gap_type as keyof typeof GAP_META] : null;
                  const sel = focusKeys.has(r.competency_key);
                  const disabled = !canEdit || (!sel && atLimit);
                  return (
                    <div key={r.competency_key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-[130px] flex-1">
                        <div className="text-sm font-semibold text-heading">{r.name}</div>
                        <div className="mt-0.5 text-xs text-ink-subtle">
                          You: {r.self_rating ? RATING_META[r.self_rating].label : "—"} · Leader: {r.leader_rating ? RATING_META[r.leader_rating].label : "—"}
                        </div>
                      </div>
                      {r.self_rating && r.leader_rating && gm && <Track self={r.self_rating} leader={r.leader_rating} color={gm.color} />}
                      {gm && (
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", gm.chip)}>
                          {r.gap_type === "blind_spot" && <AlertTriangle className="mr-1 -mt-0.5 inline h-2.5 w-2.5" />}{gm.label}
                        </span>
                      )}
                      <button disabled={disabled} onClick={() => sel ? removeFocus.mutate(r.competency_key) : setFocus.mutate({ competency_key: r.competency_key })}
                        className={cn("inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
                          sel ? "border-midnight bg-midnight text-white"
                            : disabled ? "cursor-not-allowed border-border text-ink-subtle"
                            : "border-border text-ink-2 hover:border-accent")}>
                        {sel ? <><Check className="h-3 w-3" /> Focus</> : <><Plus className="h-3 w-3" /> Focus</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* focus panel */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-heading"><Target className="h-4 w-4" /> Focus areas</h2>
              <span className="text-xs tabular-nums text-ink-subtle">{focusKeys.size} of 3</span>
            </div>
            <p className="mt-1 text-xs text-ink-subtle">Pick 2-3 areas to roll into the development plan. Start with the blind spots.</p>

            {data.focus_areas.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-subtle">
                Nothing selected yet. Add a focus from any competency on the left.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {data.focus_areas.map((f) => {
                  const row = byKey.get(f.competency_key);
                  const gm = f.gap_type && f.gap_type in GAP_META ? GAP_META[f.gap_type as keyof typeof GAP_META] : null;
                  return (
                    <div key={f.competency_key} className="rounded-xl border border-border p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-heading">{row?.name ?? f.competency_key}</div>
                          {gm && <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", gm.chip)}>{gm.label}</span>}
                        </div>
                        {canEdit && <button onClick={() => removeFocus.mutate(f.competency_key)} className="shrink-0 text-ink-subtle hover:text-red-600"><X className="h-4 w-4" /></button>}
                      </div>
                      <textarea defaultValue={f.note ?? ""} disabled={!canEdit} rows={2} placeholder="What good looks like / first step…"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (f.note ?? "")) setFocus.mutate({ competency_key: f.competency_key, note: v || null }); }}
                        className="mt-2.5 w-full resize-none rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none disabled:opacity-60" />
                    </div>
                  );
                })}
              </div>
            )}

            <button disabled className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-surface-sunk py-2.5 text-sm font-semibold text-ink-subtle">
              Sign-off &amp; create plan <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-subtle">Dual sign-off and the auto-built plan ship in the next release.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted transition hover:text-heading">
      <ChevronLeft className="h-4 w-4" /> Assessments
    </button>
  );
}
