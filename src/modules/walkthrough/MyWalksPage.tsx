// GM "my walks" landing — the assignee's home for walkthroughs. Lists the
// walks assigned to them (to start / continue) and their recent submissions.
// Mobile-first: GMs live on phones. Reads the scoped my-assignments + list
// endpoints (the function filters to the caller).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, ClipboardList, Flag, Globe, Loader2, MapPin } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { cn } from "@/lib/cn";
import {
  claimPublicWalk,
  fetchAvailableWalks,
  fetchMyAssignments,
  fetchMyPickStores,
  fetchMyRecentSubmissions,
  setAssignmentStore,
  type AvailableWalk,
  type LoadedAssignment,
  type MySubmissionRow,
  type PickStore,
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
  const available = useQuery({ queryKey: ["my-walk-available"], queryFn: fetchAvailableWalks });
  // Stores the assignee can pick for a store-less walk — fetched when an
  // assignment, or an available public walk, needs one.
  const hasStoreless =
    !!assignments.data?.some((a) => a.needsStore) ||
    !!available.data?.some((w) => w.needsStore);
  const pickStores = useQuery({
    queryKey: ["my-walk-pick-stores"],
    queryFn: fetchMyPickStores,
    enabled: hasStoreless,
  });

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
                  pickStores={pickStores.data ?? []}
                  onOpen={() => navigate(`/walkthrough/run/${a.assignment.id}`)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Available — public/self-serve walks anyone in scope can pick up */}
        {!!available.data?.length && (
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-midnight-500">
              <Globe className="h-3 w-3" />
              Available to pick up
            </h2>
            <div className="space-y-2">
              {available.data.map((w) => (
                <AvailableWalkCard
                  key={w.id}
                  w={w}
                  pickStores={pickStores.data ?? []}
                  onStarted={(newId) => navigate(`/walkthrough/run/${newId}`)}
                />
              ))}
            </div>
          </section>
        )}

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

function AssignmentCard({
  a,
  pickStores,
  onOpen,
}: {
  a: LoadedAssignment;
  pickStores: PickStore[];
  onOpen: () => void;
}) {
  const { assignment, template, store, revisionNotes, needsStore } = a;
  const returned = !!revisionNotes;
  const overdue =
    assignment.dueAt && new Date(assignment.dueAt) < new Date() && assignment.status !== "submitted";
  const cta = returned ? "Revise" : assignment.status === "in_progress" ? "Continue" : "Start";

  // Store-less walk: the assignee picks a store, which is stamped onto the
  // assignment before the runner opens.
  const qc = useQueryClient();
  const [pickedStore, setPickedStore] = useState("");
  const start = useMutation({
    mutationFn: () => setAssignmentStore(assignment.id, pickedStore),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-walk-assignments"] });
      onOpen();
    },
  });

  if (needsStore) {
    return (
      <div
        className={cn(
          "rounded-xl bg-surface p-3.5 shadow-card ring-1",
          returned ? "ring-warn/40" : "ring-midnight-100",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-midnight-900 truncate">{template.name}</span>
          <span className="shrink-0 rounded bg-midnight-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-midnight-600">
            Pick store
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11.5px] text-midnight-500">
          <MapPin className="h-3 w-3" />
          Choose which store you're walking
          {assignment.dueAt && (
            <span className={cn("ml-2 inline-flex items-center gap-1", overdue ? "font-medium text-bad" : "")}>
              <CalendarClock className="h-3 w-3" />
              {new Date(assignment.dueAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <select
            value={pickedStore}
            onChange={(e) => setPickedStore(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-midnight-200 bg-white px-2 text-[13px] text-midnight-900 focus:border-accent focus:outline-none"
          >
            <option value="">Select a store…</option>
            {pickStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} · {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => start.mutate()}
            disabled={!pickedStore || start.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-midnight-900 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start"}
            {!start.isPending && <ChevronRight className="h-4 w-4" strokeWidth={2} />}
          </button>
        </div>
        {start.isError && (
          <div className="mt-1.5 text-[11px] text-bad">
            {start.error instanceof Error ? start.error.message : "Couldn't start. Try again."}
          </div>
        )}
      </div>
    );
  }

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

function AvailableWalkCard({
  w,
  pickStores,
  onStarted,
}: {
  w: AvailableWalk;
  pickStores: PickStore[];
  onStarted: (newAssignmentId: string) => void;
}) {
  const qc = useQueryClient();
  const [pickedStore, setPickedStore] = useState("");
  const overdue = w.dueAt && new Date(w.dueAt) < new Date();
  const start = useMutation({
    mutationFn: () => claimPublicWalk(w.id, w.needsStore ? pickedStore : null),
    onSuccess: async (newId) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-walk-available"] }),
        qc.invalidateQueries({ queryKey: ["my-walk-assignments"] }),
      ]);
      onStarted(newId);
    },
  });

  return (
    <div className="rounded-xl bg-surface p-3.5 shadow-card ring-1 ring-midnight-100">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold text-midnight-900 truncate">{w.templateName}</span>
        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Public
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11.5px] text-midnight-500">
        <span>{w.needsStore ? "Choose a store" : `${w.storeNumber} · ${w.storeName}`}</span>
        {w.dueAt && (
          <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-bad" : "")}>
            <CalendarClock className="h-3 w-3" />
            {new Date(w.dueAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {w.needsStore && (
          <select
            value={pickedStore}
            onChange={(e) => setPickedStore(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-midnight-200 bg-white px-2 text-[13px] text-midnight-900 focus:border-accent focus:outline-none"
          >
            <option value="">Select a store…</option>
            {pickStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} · {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => start.mutate()}
          disabled={(w.needsStore && !pickedStore) || start.isPending}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg bg-midnight-900 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50",
            w.needsStore ? "" : "ml-auto",
          )}
        >
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start"}
          {!start.isPending && <ChevronRight className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
      {start.isError && (
        <div className="mt-1.5 text-[11px] text-bad">
          {start.error instanceof Error ? start.error.message : "Couldn't start. Try again."}
        </div>
      )}
    </div>
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
