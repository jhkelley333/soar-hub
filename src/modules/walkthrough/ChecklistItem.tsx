// Walkthrough — single checklist row.
//
// The core field control: a big 3-state Pass / Watch / Fail segmented (44pt+
// tap targets, glove-tested) plus an optional N/A escape when the template
// allows it. Selecting Fail/Watch reveals the rule-driven follow-up inline.
// Tones tie to .bg-ok / .bg-warn / .bg-bad so each state reads with the right
// weight under field glare.
//
// Presentational: fed by the page that owns use-walkthrough-store.

import { Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import { ConditionalFollowup } from "./ConditionalFollowup";
import { effectiveRule, requirementStatus } from "./rules";
import type {
  ItemResponse,
  ItemValue,
  PhotoRecord,
  TemplateItem,
  WalkthroughTemplate,
} from "./types";

const OPTIONS: { value: Exclude<ItemValue, null | "na">; label: string; on: string }[] = [
  { value: "pass", label: "Pass", on: "bg-ok/15 ring-ok text-midnight-900" },
  { value: "watch", label: "Watch", on: "bg-warn/20 ring-warn text-midnight-900" },
  { value: "fail", label: "Fail", on: "bg-bad/15 ring-bad text-midnight-900" },
];

export interface ChecklistItemProps {
  item: TemplateItem;
  response: ItemResponse;
  globalRules: WalkthroughTemplate["globalRules"];
  /** Photos attached to this item (already filtered by itemCode). */
  photos: PhotoRecord[];
  photoUrls: Record<string, string>;
  onChange: (value: ItemValue) => void;
  onReason: (reason: string) => void;
  onNote: (note: string) => void;
  onAddPhoto: (file: Blob) => void;
  onRemovePhoto: (id: string) => void;
  onRetryPhoto: (id: string) => void;
}

export function ChecklistItem({
  item,
  response,
  globalRules,
  photos,
  photoUrls,
  onChange,
  onReason,
  onNote,
  onAddPhoto,
  onRemovePhoto,
  onRetryPhoto,
}: ChecklistItemProps) {
  const allowNa = !!globalRules.allowNa && item.allowNa !== false;
  const isNa = response.value === "na";
  const rule = effectiveRule(item, response.value, globalRules);
  const status = requirementStatus(rule, response);

  // An answered Fail/Watch whose required follow-ups aren't satisfied gets a
  // subtle attention ring so the GM (and the review gate) can see it's owed.
  const owed = rule != null && !status.satisfied;

  return (
    <div
      className={cn(
        "bg-surface rounded-xl shadow-card p-3.5 ring-1 transition-colors",
        owed ? "ring-bad/40" : "ring-midnight-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] font-mono text-midnight-400">{item.code}</div>
          <div className="text-[14px] font-medium text-midnight-900 leading-snug">
            {item.label}
          </div>
        </div>
        {allowNa && (
          <button
            type="button"
            onClick={() => onChange(isNa ? null : "na")}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium ring-1 transition",
              isNa
                ? "bg-midnight-900 text-white ring-midnight-900"
                : "bg-white text-midnight-500 ring-midnight-200 hover:ring-midnight-300",
            )}
            aria-pressed={isNa}
          >
            <Ban className="h-3 w-3" strokeWidth={2} />
            N/A
          </button>
        )}
      </div>

      {/* 3-state control — hidden while N/A so the row reads as parked. */}
      {!isNa && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {OPTIONS.map((opt) => {
            const active = response.value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(active ? null : opt.value)}
                className={cn(
                  "h-11 rounded-lg text-[14px] font-semibold transition ring-1",
                  active
                    ? opt.on
                    : "bg-white ring-midnight-200 text-midnight-500 hover:ring-midnight-300 active:bg-midnight-50",
                )}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      <ConditionalFollowup
        rule={rule}
        response={response}
        photos={photos}
        photoUrls={photoUrls}
        severity={item.severity}
        onReason={onReason}
        onNote={onNote}
        onAddPhoto={onAddPhoto}
        onRemovePhoto={onRemovePhoto}
        onRetryPhoto={onRetryPhoto}
      />
    </div>
  );
}
