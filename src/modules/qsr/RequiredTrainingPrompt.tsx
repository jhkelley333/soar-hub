// Login reminder for required SOAR QSR training. When the signed-in user has a
// course marked Required (quarterly/annual) for their role that they haven't
// completed in the current window, this pops up — dismissible, but reappears on
// the next login until it's done. Mounted in AppShell so it shows on any page.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Clock, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { fetchRequiredTraining } from "./api";

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
  if (!pending.length) return null;
  const course = pending[0];
  const dismiss = () => setDismissed((s) => new Set(s).add(course.id));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={dismiss}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-qsr-azure/10 text-qsr-azure"><BellRing className="h-6 w-6" /></span>
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1 text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-qsr-crimson">Required training · {course.cadence === "annual" ? "this year" : "this quarter"}</div>
          <h2 className="mt-0.5 font-qsr-display text-xl font-bold text-ink">{course.title}</h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            {course.category ? `${course.category} · ` : ""}You haven’t completed this {course.cadence === "annual" ? "year" : "quarter"} yet.
            {course.est_minutes != null && <> <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />~{course.est_minutes} min</span>.</>}
          </p>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={dismiss} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">Later</button>
          <button type="button" onClick={() => { dismiss(); navigate(`/qsr/course/${course.id}`); }} className="flex-1 rounded-lg bg-qsr-azure px-3 py-2.5 text-sm font-semibold text-white hover:brightness-110">Start training ▸</button>
        </div>
      </div>
    </div>
  );
}
