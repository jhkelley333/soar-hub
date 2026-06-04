// GM "my walks" landing — the assignee's home for walkthroughs. Lists the
// walks assigned to them (to start / continue) and their recent submissions.
// Mobile-first: GMs live on phones. Reads the scoped my-assignments + list
// endpoints (the function filters to the caller).

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, ClipboardList, Flag } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { cn } from "@/lib/cn";
import {
  fetchMyAssignments,
  fetchMyRecentSubmissions,
  type LoadedAssignment,
  type MySubmissionRow,
} from "./api";

const TIER_TEXT: Record<string, string> = {
  green: "text-tier-green",
  yellow: "text-tier-yellow",
  red: "text-tier-red",
};
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  needs_revision: "Needs revision",
  approved: "Approved",
};

export function MyWalksPage() {
  const navigate = useNavigate();
  const assignments = useQuery({ queryKey: ["my-walk-assignments"], queryFn: fetchMyAssignments });
  const submissions = useQuery({ queryKey: ["my-walk-submissions"], queryFn: fetchMyRecentSubmissions });

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full flex flex-col">
      <AppHeader title="My walks" subtitle="Your assigned store walkthroughs" />

      <div className="flex-1 px-4 pt-4 pb-24 space-y-6">
        {/* To do */}
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-500">
            To do
          </h2>
          {assignments.isLoading ? (
            <SkeletonList />
          ) : assignments.error ? (
            <ErrorCard message={assignments.error instanceof Error ? assignments.error.message : "Failed to load."} />
          ) : !assignments.data?.length ? (
            <EmptyCard icon={<ClipboardList className="h-5 w-5" />} text="No walks assigned right now." />
          ) : (
            <div className="space-y-2">
              {assignments.data.map((a) => (
                <AssignmentCard
                  key={a.assignment.id}
                  a={a}
                  onOpen={() => navigate(`/walkthrough/run/${a.assignment.id}`)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recently submitted */}
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-500">
            Recently submitted
          </h2>
          {submissions.isLoading ? (
            <SkeletonList />
          ) : !submissions.data?.length ? (
            <EmptyCard text="Nothing submitted yet." />
          ) : (
            <div className="space-y-2">
              {submissions.data.map((s) => (
                <SubmissionCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AssignmentCard({ a, onOpen }: { a: LoadedAssignment; onOpen: () => void }) {
  const { assignment, template, store, revisionNotes } = a;
  const returned = !!revisionNotes;
  const overdue =
    assignment.dueAt && new Date(assignment.dueAt) < new Date() && assignment.status !== "submitted";
  const cta = returned ? "Revise" : assignment.status === "in_progress" ? "Continue" : "Start";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl bg-surface p-3.5 text-left shadow-card ring-1 transition active:bg-midnight-50",
        returned ? "ring-warn/40" : "ring-midnight-100",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-midnight-900 truncate">{template.name}</span>
          {returned && (
            <span className="shrink-0 rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-midnight-700">
              Returned
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-midnight-600 truncate">
          SDI {store.sdi} · {store.name}
        </div>
        {returned ? (
          <div className="mt-1 text-[11.5px] text-midnight-600">
            <span className="font-medium text-midnight-700">DO notes: </span>
            {revisionNotes}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-3 text-[11.5px]">
            <span className="text-midnight-500">{STATUS_LABEL[assignment.status] ?? assignment.status}</span>
            {assignment.dueAt && (
              <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-bad" : "text-midnight-500")}>
                <CalendarClock className="h-3 w-3" />
                {new Date(assignment.dueAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-midnight-900 px-3 py-2 text-[13px] font-semibold text-white">
        {cta}
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      </span>
    </button>
  );
}

function SubmissionCard({ s }: { s: MySubmissionRow }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface p-3.5 shadow-card ring-1 ring-midnight-100">
      <div className="w-10 text-center">
        <div className={cn("text-lg font-bold tabular-nums", TIER_TEXT[s.tier])}>{s.score}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-midnight-900">
          {STATUS_LABEL[s.status] ?? s.status}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-midnight-500">
          {s.submittedAt && <span>{new Date(s.submittedAt).toLocaleDateString()}</span>}
          <span>v{s.templateVersion}</span>
          {s.flagCount > 0 && (
            <span className="inline-flex items-center gap-1 text-bad">
              <Flag className="h-3 w-3" strokeWidth={2} />
              {s.flagCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 w-full animate-pulse rounded-xl bg-midnight-100/60" />
      ))}
    </div>
  );
}

function EmptyCard({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface p-4 text-[13px] text-midnight-500 ring-1 ring-midnight-100">
      {icon}
      {text}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-bad/[0.05] p-4 text-[13px] text-bad ring-1 ring-bad/20">{message}</div>
  );
}
