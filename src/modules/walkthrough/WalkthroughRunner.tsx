// Walkthrough — the GM in-field runner.
//
// Orchestrates the whole session against use-walkthrough-store:
//   GPS check-in gate  →  sectioned checklist  →  review
// (Submit is the next ticket — the Review step renders it disabled.)
//
// PREVIEW: mounts the SAMPLE_* fixture since the walkthrough backend table
// doesn't exist yet. The store runs fully offline — rate items, add photos,
// switch sections, refresh mid-walk; nothing is lost. No server adapter is
// passed, so the pill settles on "Saved" (locally durable), never "Synced".

import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, WifiOff } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { BottomBar } from "@/shared/ui/BottomBar";
import { StatusPill, type StatusPillKind } from "@/shared/ui/StatusPill";
import { cn } from "@/lib/cn";
import { useWalkthroughStore } from "./use-walkthrough-store";
import { CheckIn } from "./CheckIn";
import { SectionPager } from "./SectionPager";
import { ChecklistItem } from "./ChecklistItem";
import { SectionNote } from "./SectionNote";
import { ReviewStep } from "./ReviewStep";
import {
  SAMPLE_ASSIGNMENT,
  SAMPLE_STORE,
  SAMPLE_TEMPLATE,
} from "./sample";
import type { SyncState } from "./types";

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

export function WalkthroughRunner() {
  const store = useWalkthroughStore(SAMPLE_TEMPLATE, SAMPLE_ASSIGNMENT);
  const [step, setStep] = useState<"sections" | "review">("sections");

  if (!store.ready || !store.draft) {
    return (
      <div className="mx-auto w-full max-w-md min-h-full grid place-items-center text-midnight-400 text-[13px]">
        Loading walkthrough…
      </div>
    );
  }

  // Gate: no check-in yet → show the GPS gate first.
  if (!store.checkIn) {
    return (
      <CheckIn
        assignmentId={SAMPLE_ASSIGNMENT.id}
        store={SAMPLE_STORE}
        onCheckIn={(ci) => void store.setCheckIn(ci)}
      />
    );
  }

  const { draft, score, sectionStatuses } = store;
  const activeIndex = store.activeSectionIndex;
  const activeSection = draft.sections[activeIndex];
  const tmplSection = SAMPLE_TEMPLATE.sections[activeIndex];
  const isLastSection = activeIndex === draft.sections.length - 1;
  const pill = pillFor(store.syncState, store.savedAt);

  function goNext() {
    if (step === "sections" && !isLastSection) {
      store.setActiveSectionIndex(activeIndex + 1);
      scrollTop();
    } else if (step === "sections" && isLastSection) {
      setStep("review");
      scrollTop();
    }
  }

  function goBack() {
    if (step === "review") {
      setStep("sections");
    } else if (activeIndex > 0) {
      store.setActiveSectionIndex(activeIndex - 1);
    }
    scrollTop();
  }

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full flex flex-col">
      <AppHeader
        title={SAMPLE_TEMPLATE.name}
        subtitle={`SDI ${SAMPLE_STORE.sdi} · ${SAMPLE_STORE.name}`}
        leading={
          <button
            type="button"
            onClick={goBack}
            className="-ml-1 p-1 text-midnight-700"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        trailing={<StatusPill kind={pill.kind}>{pill.label}</StatusPill>}
      />

      {!store.online && (
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
              store.setActiveSectionIndex(i);
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
                  globalRules={SAMPLE_TEMPLATE.globalRules}
                  photos={store.photos.filter((p) => p.itemCode === resp.itemCode)}
                  photoUrls={store.photoUrls}
                  onChange={(v) => store.setItemValue(activeSection.code, resp.itemCode, v)}
                  onReason={(r) => store.setItemReason(activeSection.code, resp.itemCode, r)}
                  onNote={(n) => store.setItemNote(activeSection.code, resp.itemCode, n)}
                  onAddPhoto={(f) => void store.addPhoto(activeSection.code, resp.itemCode, f)}
                  onRemovePhoto={(id) => void store.removePhoto(activeSection.code, resp.itemCode, id)}
                  onRetryPhoto={(id) => void store.retryPhoto(id)}
                />
              );
            })}

            <SectionNote
              value={activeSection.note ?? ""}
              onChange={(v) => store.setSectionNote(activeSection.code, v)}
            />
          </div>
        </>
      ) : (
        score && (
          <div className="flex-1">
            <AppHeader title="Review" subtitle="Before publishing" sticky={false} />
            <ReviewStep
              template={SAMPLE_TEMPLATE}
              score={score}
              sections={sectionStatuses}
              checkIn={store.checkIn}
              photoCount={store.photos.length}
              onGoToSection={(i) => {
                store.setActiveSectionIndex(i);
                setStep("sections");
                scrollTop();
              }}
            />
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
              {isLastSection
                ? "Next: Review"
                : `Next: ${SAMPLE_TEMPLATE.sections[activeIndex + 1].name}`}
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="Submit transaction is the next ticket"
              className="flex-[1.4] h-11 rounded-lg bg-midnight-200 text-white/80 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-not-allowed"
            >
              Publish · wiring next
            </button>
          )}
        </div>
      </BottomBar>
    </div>
  );
}

function scrollTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}
