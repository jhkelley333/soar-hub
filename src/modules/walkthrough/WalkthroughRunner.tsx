// Walkthrough — the GM in-field runner.
//
// Orchestrates the whole session against use-walkthrough-store:
//   GPS check-in gate  →  sectioned checklist  →  review  →  publish
//
// Two modes:
//   • /walkthrough/run            — offline PREVIEW on the SAMPLE_* fixture.
//     No backend, no adapter; the pill settles on "Saved" (locally durable),
//     Publish is disabled.
//   • /walkthrough/run/:id        — LIVE against a real assignment. Drafts +
//     photos flush through the adapter (pill reaches "Synced"); Publish calls
//     the submit transaction (score + corrective actions + DO notify).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  WifiOff,
} from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { BottomBar } from "@/shared/ui/BottomBar";
import { StatusPill, type StatusPillKind } from "@/shared/ui/StatusPill";
import { cn } from "@/lib/cn";
import { useWalkthroughStore, type WalkthroughAdapter } from "./use-walkthrough-store";
import { CheckIn, type CheckInStore } from "./CheckIn";
import { SectionPager } from "./SectionPager";
import { ChecklistItem } from "./ChecklistItem";
import { SectionNote } from "./SectionNote";
import { ReviewStep } from "./ReviewStep";
import { SAMPLE_ASSIGNMENT, SAMPLE_STORE, SAMPLE_TEMPLATE } from "./sample";
import {
  fetchAssignment,
  makeWalkthroughAdapter,
  submitWalkthrough,
  type LoadedAssignment,
  type SubmitResult,
} from "./api";
import type { SyncState, WalkthroughAssignment, WalkthroughTemplate } from "./types";

function pillFor(sync: SyncState, savedAt: string | null): {
  kind: StatusPillKind;
  label: string;
} {
  switch (sync) {
    case "saving":
      return { kind: "saving", label: "Saving" };
    case "queued":
      return { kind: "pending", label: "Queued" };
    case "syncing":
      return { kind: "saving", label: "Syncing" };
    case "synced":
      return { kind: "synced", label: "Synced" };
    case "error":
      return { kind: "error", label: "Retrying" };
    case "saved":
    case "idle":
    default:
      return { kind: "saved", label: savedAt ? `Saved ${savedAt}` : "Saved" };
  }
}

// ---------------------------------------------------------------------------
// Loader: resolves which mode to run, then mounts the inner runner (which
// owns the store hook).
// ---------------------------------------------------------------------------

export function WalkthroughRunner() {
  const { assignmentId } = useParams<{ assignmentId?: string }>();

  // Preview mode — no id in the URL.
  if (!assignmentId) {
    return (
      <RunnerInner
        template={SAMPLE_TEMPLATE}
        assignment={SAMPLE_ASSIGNMENT}
        store={SAMPLE_STORE}
        live={false}
      />
    );
  }

  return <LiveLoader assignmentId={assignmentId} />;
}

function LiveLoader({ assignmentId }: { assignmentId: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: LoadedAssignment }
  >({ status: "loading" });

  useEffect(() => {
    let alive = true;
    fetchAssignment(assignmentId)
      .then((data) => {
        if (!alive) return;
        if (!data) setState({ status: "error", message: "Assignment not found or not assigned to you." });
        else setState({ status: "ready", data });
      })
      .catch((e) => alive && setState({ status: "error", message: e?.message ?? "Failed to load." }));
    return () => {
      alive = false;
    };
  }, [assignmentId]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-md min-h-full grid place-items-center text-midnight-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto w-full max-w-md min-h-full grid place-items-center px-6 text-center text-[13px] text-midnight-500">
        {state.message}
      </div>
    );
  }
  return (
    <RunnerInner
      template={state.data.template}
      assignment={state.data.assignment}
      store={state.data.store}
      adapter={makeWalkthroughAdapter(assignmentId)}
      live
    />
  );
}

// ---------------------------------------------------------------------------
// Inner runner — owns the store hook + all the field UI.
// ---------------------------------------------------------------------------

interface RunnerInnerProps {
  template: WalkthroughTemplate;
  assignment: WalkthroughAssignment;
  store: CheckInStore;
  adapter?: WalkthroughAdapter;
  live: boolean;
}

function RunnerInner({ template, assignment, store, adapter, live }: RunnerInnerProps) {
  const wt = useWalkthroughStore(template, assignment, adapter);
  const [step, setStep] = useState<"sections" | "review">("sections");
  const [submitState, setSubmitState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "done"; result: SubmitResult } | { status: "error"; message: string }
  >({ status: "idle" });

  if (!wt.ready || !wt.draft) {
    return (
      <div className="mx-auto w-full max-w-md min-h-full grid place-items-center text-midnight-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Gate: check-in first.
  if (!wt.checkIn) {
    return (
      <CheckIn
        assignmentId={assignment.id}
        store={store}
        onCheckIn={(ci) => void wt.setCheckIn(ci)}
      />
    );
  }

  // Post-submit confirmation.
  if (submitState.status === "done") {
    return <SubmittedScreen result={submitState.result} storeName={store.name} />;
  }

  const { draft, score, sectionStatuses } = wt;
  const activeIndex = wt.activeSectionIndex;
  const activeSection = draft.sections[activeIndex];
  const tmplSection = template.sections[activeIndex];
  const isLastSection = activeIndex === draft.sections.length - 1;
  const pill = pillFor(wt.syncState, wt.savedAt);
  const blockers = sectionStatuses.filter((s) => s.hasUnanswered || s.incomplete).length;
  const canPublish = live && blockers === 0 && submitState.status !== "submitting";

  function goNext() {
    if (step === "sections" && !isLastSection) wt.setActiveSectionIndex(activeIndex + 1);
    else if (step === "sections" && isLastSection) setStep("review");
    scrollTop();
  }
  function goBack() {
    if (step === "review") setStep("sections");
    else if (activeIndex > 0) wt.setActiveSectionIndex(activeIndex - 1);
    scrollTop();
  }

  async function publish() {
    setSubmitState({ status: "submitting" });
    try {
      const result = await submitWalkthrough({
        assignmentId: assignment.id,
        checkInId: wt.checkIn?.id ?? null,
        sections: draft.sections,
      });
      setSubmitState({ status: "done", result });
    } catch (e) {
      setSubmitState({ status: "error", message: e instanceof Error ? e.message : "Submit failed." });
    }
  }

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full flex flex-col">
      <AppHeader
        title={template.name}
        subtitle={`SDI ${store.sdi} · ${store.name}`}
        leading={
          <button type="button" onClick={goBack} className="-ml-1 p-1 text-midnight-700" aria-label="Back">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        trailing={<StatusPill kind={pill.kind}>{pill.label}</StatusPill>}
      />

      {!wt.online && (
        <div className="bg-midnight-900 text-white px-4 py-2 text-[12px] flex items-center gap-2">
          <WifiOff className="h-3.5 w-3.5" strokeWidth={2} />
          Offline — saved on this device. Syncs when you're back online.
        </div>
      )}

      {step === "sections" ? (
        <>
          <SectionPager
            sections={sectionStatuses}
            activeIndex={activeIndex}
            onJump={(i) => {
              wt.setActiveSectionIndex(i);
              scrollTop();
            }}
          />
          <div className="flex-1 px-4 pt-4 pb-40 space-y-2.5">
            {activeSection.items.map((resp) => {
              const item = tmplSection.items.find((i) => i.code === resp.itemCode);
              if (!item) return null;
              return (
                <ChecklistItem
                  key={resp.itemCode}
                  item={item}
                  response={resp}
                  globalRules={template.globalRules}
                  photos={wt.photos.filter((p) => p.itemCode === resp.itemCode)}
                  photoUrls={wt.photoUrls}
                  onChange={(v) => wt.setItemValue(activeSection.code, resp.itemCode, v)}
                  onReason={(r) => wt.setItemReason(activeSection.code, resp.itemCode, r)}
                  onNote={(n) => wt.setItemNote(activeSection.code, resp.itemCode, n)}
                  onAddPhoto={(f) => void wt.addPhoto(activeSection.code, resp.itemCode, f)}
                  onRemovePhoto={(id) => void wt.removePhoto(activeSection.code, resp.itemCode, id)}
                  onRetryPhoto={(id) => void wt.retryPhoto(id)}
                />
              );
            })}
            <SectionNote
              value={activeSection.note ?? ""}
              onChange={(v) => wt.setSectionNote(activeSection.code, v)}
            />
          </div>
        </>
      ) : (
        score && (
          <div className="flex-1">
            <AppHeader title="Review" subtitle="Before publishing" sticky={false} />
            <ReviewStep
              template={template}
              score={score}
              sections={sectionStatuses}
              checkIn={wt.checkIn}
              photoCount={wt.photos.length}
              onGoToSection={(i) => {
                wt.setActiveSectionIndex(i);
                setStep("sections");
                scrollTop();
              }}
            />
            {submitState.status === "error" && (
              <div className="px-4 -mt-2 pb-2 text-[12px] text-bad">{submitState.message}</div>
            )}
          </div>
        )
      )}

      <BottomBar>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === "sections" && activeIndex === 0}
            className={cn(
              "flex-1 h-11 rounded-lg ring-1 text-[14px] font-medium inline-flex items-center justify-center gap-1.5 transition",
              step === "sections" && activeIndex === 0
                ? "ring-midnight-100 text-midnight-300 cursor-not-allowed bg-white"
                : "ring-midnight-200 text-midnight-800 bg-white hover:bg-surface-muted",
            )}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            Back
          </button>

          {step === "sections" ? (
            <button
              type="button"
              onClick={goNext}
              className="flex-[1.4] h-11 rounded-lg bg-midnight-900 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-midnight-800 transition"
            >
              {isLastSection ? "Next: Review" : `Next: ${template.sections[activeIndex + 1].name}`}
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canPublish}
              onClick={publish}
              title={live ? (blockers ? "Resolve blockers first" : "") : "Submit is live only on a real assignment"}
              className={cn(
                "flex-[1.4] h-11 rounded-lg text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 transition",
                canPublish
                  ? "bg-midnight-900 text-white hover:bg-midnight-800"
                  : "bg-midnight-200 text-white/80 cursor-not-allowed",
              )}
            >
              {submitState.status === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}
              {live ? "Publish" : "Publish · preview"}
            </button>
          )}
        </div>
      </BottomBar>
    </div>
  );
}

function SubmittedScreen({ result, storeName }: { result: SubmitResult; storeName: string }) {
  return (
    <div className="mx-auto w-full max-w-md min-h-full grid place-items-center px-6 text-center">
      <div>
        <CheckCircle2 className="h-12 w-12 text-ok mx-auto" strokeWidth={1.75} />
        <h2 className="mt-3 text-[18px] font-semibold text-midnight-900">Walkthrough submitted</h2>
        <p className="mt-1 text-[13px] text-midnight-600">
          {storeName} · score {result.submission.score} ({result.submission.tier})
        </p>
        <p className="mt-3 text-[12.5px] text-midnight-500">
          {result.correctiveActions > 0
            ? `${result.correctiveActions} corrective action${result.correctiveActions === 1 ? "" : "s"} raised`
            : "No corrective actions"}
          {result.notified ? " · DO notified" : ""}
        </p>
      </div>
    </div>
  );
}

function scrollTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}
