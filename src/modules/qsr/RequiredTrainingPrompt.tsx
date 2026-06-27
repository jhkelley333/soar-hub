// Login reminder for required SOAR QSR training. When the signed-in user has a
// course marked Required (quarterly/annual) for their role that they haven't
// completed in the current window, this pops up — dismissible, but reappears
// on the next login until it's done. Mounted in AppShell so it shows on any
// page. Every render and terminal action is audited via qsr_training_events
// so leadership can see who saw it, who started, and who dismissed.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Clock, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { fetchRequiredTraining, logTrainingPopupEvent, type TrainingPopupAction } from "./api";

// Fire-and-forget — never block the UX on the audit write.
function log(courseId: string, action: TrainingPopupAction, via?: string) {
  logTrainingPopupEvent(courseId, action, via ? { via } : undefined).catch(() => {});
}

export function RequiredTrainingPrompt() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["qsr-required"],
    queryFn: fetchRequiredTraining,
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const pending = (q.data?.required ?? []).filter((c) => !dismissed.has(c.id));
  const course = pending[0] ?? null;

  // Log a "shown" event each time a (different) course actually surfaces. The
  // server dedups within 12h so a re-mount / re-fetch in the same session
  // doesn't spam the log. shownRef gates client-side per-render so the effect
  // fires once per course id.
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    if (course && shownRef.current !== course.id) {
      shownRef.current = course.id;
      log(course.id, "shown");
    }
  }, [course]);

  if (!course) return null;

  // Three dismissal entry points (X button, Later button, backdrop tap) all
  // log a "dismissed" event with the source recorded for breakdowns later.
  function recordDismiss(via: "x" | "later" | "backdrop") {
    // event_data.via lets reports break "dismissed" down by which control was
    // used — X button, Later button, or tap-outside the modal.
    log(course!.id, "dismissed", via);
    setDismissed((s) => new Set(s).add(course!.id));
  }

  function recordStart() {
    log(course!.id, "started");
    setDismissed((s) => new Set(s).add(course!.id));
    navigate(`/qsr/course/${course!.id}`);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={() => recordDismiss("backdrop")}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-qsr-azure/10 text-qsr-azure">
            <BellRing className="h-6 w-6" />
          </span>
          <button
            type="button"
            onClick={() => recordDismiss("x")}
            aria-label="Dismiss"
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-qsr-crimson">
            {course.source === "assigned"
              ? "Training assigned to you"
              : `Required training · ${course.cadence === "annual" ? "this year" : "this quarter"}`}
          </div>
          <h2 className="mt-0.5 font-qsr-display text-xl font-bold text-ink">{course.title}</h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            {course.category ? `${course.category} · ` : ""}
            {course.source === "assigned"
              ? "You haven’t completed this yet."
              : `You haven’t completed this ${course.cadence === "annual" ? "year" : "quarter"} yet.`}
            {course.est_minutes != null && (
              <>
                {" "}
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />~{course.est_minutes} min
                </span>
                .
              </>
            )}
          </p>
          {course.due_at && (
            <p className="mt-1 text-[12px] font-medium text-qsr-crimson">
              Due {new Date(course.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => recordDismiss("later")}
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
          >
            Later
          </button>
          <button
            type="button"
            onClick={recordStart}
            className="flex-1 rounded-lg bg-qsr-azure px-3 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            Start training &#9656;
          </button>
        </div>
      </div>
    </div>
  );
}
