// My Training — the learner-facing home for SOAR QSR training, open to every
// signed-in user. Two sections: required training the caller still owes this
// period (surfaced first, since the login pop-up is the only other place it
// shows), then the full catalog of published courses with the caller's status.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap, Clock, Play, CheckCircle2, CircleDashed, Loader2, AlertCircle, BookOpen,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { fetchMyTraining, type MyTrainingCourse } from "./api";

const cadenceLabel = (c: string | null) =>
  c === "annual" ? "Once a year" : c === "quarterly" ? "Every quarter" : null;
const windowLabel = (c: string | null) => (c === "annual" ? "this year" : "this quarter");

function StatusChip({ c }: { c: MyTrainingCourse }) {
  if (c.outstanding) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-qsr-crimson/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-qsr-crimson">
        <AlertCircle className="h-3 w-3" /> Due {windowLabel(c.cadence)}
      </span>
    );
  }
  if (c.status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Completed
      </span>
    );
  }
  if (c.status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
        <Loader2 className="h-3 w-3" /> In progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
      <CircleDashed className="h-3 w-3" /> Not started
    </span>
  );
}

function CourseCard({ c }: { c: MyTrainingCourse }) {
  const cta =
    c.status === "completed" && !c.outstanding ? "Review ▸" : c.status === "in_progress" ? "Continue ▸" : "Start ▸";
  return (
    <Link
      to={`/qsr/course/${c.id}`}
      className="group flex flex-col rounded-2xl border border-border bg-surface p-4 transition hover:border-qsr-azure hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {c.category && (
            <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-qsr-crimson">{c.category}</div>
          )}
          <h3 className="mt-0.5 font-qsr-display text-base font-semibold text-ink">{c.title}</h3>
        </div>
        <StatusChip c={c} />
      </div>
      {c.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-muted">{c.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-qsr-mono text-[11px] text-ink-muted">
        {c.est_minutes != null && (
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />~{c.est_minutes} min</span>
        )}
        <span>+{c.points} pts</span>
        {cadenceLabel(c.cadence) && c.required && <span className="text-qsr-azure">Required · {cadenceLabel(c.cadence)}</span>}
      </div>
      <div className="mt-3 inline-flex items-center gap-1.5 font-qsr-ui text-sm font-semibold text-qsr-azure">
        <Play className="h-3.5 w-3.5 fill-qsr-azure" /> {cta}
      </div>
    </Link>
  );
}

export function MyTrainingPage() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ["qsr-my-training"],
    queryFn: fetchMyTraining,
    enabled: !!session,
    staleTime: 60_000,
  });

  const courses = useMemo(() => q.data?.courses ?? [], [q.data]);
  const due = courses.filter((c) => c.outstanding);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-qsr-azure/10 text-qsr-azure">
          <GraduationCap className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-qsr-display text-2xl font-bold text-ink">My Training</h1>
          <p className="text-sm text-ink-muted">Required courses and the full Soar MyLearning catalog.</p>
        </div>
      </div>

      {/* Required / due section */}
      {due.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-qsr-crimson">
            <AlertCircle className="h-4 w-4" /> Required of you — {due.length} outstanding
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {due.map((c) => (
              <CourseCard key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* Full catalog */}
      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-qsr-azure" /> All courses
        </div>
        {q.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-32 animate-pulse rounded-2xl bg-surface-sunk" />
            <div className="h-32 animate-pulse rounded-2xl bg-surface-sunk" />
          </div>
        ) : q.isError ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm text-ink-muted">
            Couldn’t load training right now. Refresh to try again.
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm text-ink-muted">
            No published courses yet. Check back soon.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {courses.map((c) => (
              <CourseCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
