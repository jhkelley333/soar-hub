// The rating instrument (AssessmentScreen, restyled to our design system).
// Self/leader is resolved from identity by the backend; each rating autosaves;
// Submit locks the response. Neither side sees the other until both submit.
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, ChevronLeft, Info, User, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchNlaAssessment, saveNlaRating, submitNla } from "./api";
import { RATING_META, RATING_ORDER, type NlaTemplateItem, type Rating } from "./types";

export function NlaTakePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["nla-assessment", id], queryFn: () => fetchNlaAssessment(id), enabled: !!id });

  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  useEffect(() => {
    if (q.data) setRatings(Object.fromEntries(q.data.my_ratings.map((r) => [r.competency_key, r.rating])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: (v: { competency_key: string; rating: Rating }) => saveNlaRating({ assessment_id: id, ...v }),
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error"),
  });
  const submit = useMutation({
    mutationFn: () => submitNla(id),
    onSuccess: (r) => {
      toast.push(r.both_submitted ? "Submitted. Comparison is ready." : "Submitted. Awaiting the other rater.", "success");
      qc.invalidateQueries({ queryKey: ["nla-assessment", id] });
      qc.invalidateQueries({ queryKey: ["nla-list"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not submit.", "error"),
  });

  const items = q.data?.items ?? [];
  const groups = useMemo(() => {
    const m = new Map<string, NlaTemplateItem[]>();
    for (const it of (q.data?.items ?? [])) { if (!m.has(it.category)) m.set(it.category, []); m.get(it.category)!.push(it); }
    return Array.from(m.entries());
  }, [q.data]);

  if (q.isLoading) return <div className="mx-auto max-w-3xl space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <EmptyState title="Could not load assessment" description={(q.error as Error)?.message ?? "Try again."} />;
  const data = q.data!;
  const isSelf = data.my_role === "self";
  const locked = !!data.my_response?.locked;
  const total = items.length;
  const done = Object.keys(ratings).length;
  const complete = done === total && total > 0;
  const subject = isSelf ? "you" : data.assessment.subject_name;

  const pick = (key: string, r: Rating) => {
    setRatings((prev) => ({ ...prev, [key]: r }));
    save.mutate({ competency_key: key, rating: r });
  };

  // ── Submitted / read-only ──
  if (locked) {
    const tally = RATING_ORDER.map((k) => ({ k, n: data.my_ratings.filter((r) => r.rating === k).length }));
    return (
      <div className="mx-auto max-w-lg">
        <BackLink onClick={() => navigate("/training?tab=assessments")} />
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            <h2 className="text-lg font-bold text-heading">{isSelf ? "Self-assessment submitted" : "Leader assessment submitted"}</h2>
          </div>
          <p className="mt-1.5 text-sm text-ink-muted">
            {data.assessment.subject_name} · {data.assessment.target_role.toUpperCase()} · {total} competencies rated. Responses lock once both sides submit.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {tally.map(({ k, n }) => (
              <div key={k} className="rounded-xl border border-border p-3.5">
                <div className="text-2xl font-bold tabular-nums text-heading">{n}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{RATING_META[k].label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-border bg-surface-muted p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-2">{isSelf ? "Self-assessment" : "Leader assessment"}</span>
              <span className="flex items-center gap-1 font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Complete</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-ink-subtle">
              <span>{isSelf ? "Leader assessment" : "Self-assessment"}</span>
              <span>{data.counterpart_submitted ? "Complete" : "Awaiting submission"}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-subtle">
            {data.both_submitted ? "Both are in — the comparison is ready to review together." : "When both are in, the comparison unlocks for the sit-down."}
          </p>
          {data.both_submitted && (
            <button onClick={() => navigate(`/nla/${id}/compare`)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-midnight px-4 py-2 text-sm font-semibold text-white transition hover:bg-midnight/90">
              View comparison <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Rating (main) ──
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink onClick={() => navigate("/training?tab=assessments")} />
      {/* header */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">Next Level Assessment · {data.assessment.target_role.toUpperCase()}</div>
            <div className="truncate text-sm font-semibold text-heading">
              {isSelf ? "Self-assessment" : `Leader assessment · ${data.assessment.subject_name}`}
            </div>
          </div>
          <button disabled={!complete || submit.isPending} onClick={() => submit.mutate()}
            className={cn("inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              complete ? "bg-midnight text-white hover:bg-midnight/90" : "cursor-not-allowed bg-surface-sunk text-ink-subtle")}>
            {submit.isPending ? "Submitting…" : "Submit"} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunk">
            <div className="h-full rounded-full bg-midnight transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">{done} / {total}</span>
        </div>
      </div>

      {/* who / key */}
      <div className="mb-4 flex items-center gap-2">
        <span className="mr-1 text-xs text-ink-subtle">Rating as</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-surface px-3 py-1.5 text-xs font-semibold text-heading">
          {isSelf ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}{isSelf ? "Team member" : "Leader"}
        </span>
      </div>
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        <span>For each competency, choose how consistently {subject} demonstrate{isSelf ? "" : "s"} it today — <span className="text-ink-2">Modeling</span>, <span className="text-ink-2">Aspiring</span>, or <span className="text-ink-2">Opportunity</span>. Be honest; the gap between both assessments is what makes the conversation useful.</span>
      </div>

      {groups.map(([cat, its]) => (
        <div key={cat} className="mb-6">
          <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle">{cat}</div>
          <div className="space-y-3">
            {its.map((it) => {
              const rated = !!ratings[it.competency_key];
              return (
                <div key={it.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-heading">{it.name}</h3>
                      {it.description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{it.description}</p>}
                      {it.example && <p className="mt-1.5 text-xs italic text-ink-subtle">e.g. {it.example}</p>}
                    </div>
                    {rated && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-200"><Check className="h-3 w-3 text-emerald-600" /></span>}
                  </div>
                  <div className="mt-3.5 grid grid-cols-3 gap-2">
                    {RATING_ORDER.map((r) => {
                      const on = ratings[it.competency_key] === r;
                      return (
                        <button key={r} onClick={() => pick(it.competency_key, r)}
                          className={cn("rounded-lg border px-3 py-2.5 text-left transition",
                            on ? "border-midnight bg-midnight text-white" : "border-border bg-surface hover:border-accent")}>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", on ? "border-white bg-white" : "border-border")}>
                              {on && <Check className="h-2.5 w-2.5 text-midnight" />}
                            </span>
                            <span className="text-sm font-medium">{RATING_META[r].label}</span>
                          </div>
                          <div className={cn("mt-1 text-[11px] leading-snug", on ? "text-white/80" : "text-ink-subtle")}>{RATING_META[r].hint}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        {complete ? (
          <button disabled={submit.isPending} onClick={() => submit.mutate()}
            className="inline-flex items-center gap-2 rounded-lg bg-midnight px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-50">
            Submit assessment <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <span className="text-sm text-ink-subtle">{total - done} more to rate before you can submit.</span>
        )}
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
