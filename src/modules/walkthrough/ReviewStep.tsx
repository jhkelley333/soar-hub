// Walkthrough — review before submit.
//
// Read-only summary the GM sees last: structure, the computed score + tier
// (using the exact scoring map the server will apply), flag counts, photo
// count, and a blocker list (unanswered required items / unsatisfied Fail
// follow-ups) that deep-links back to the offending section and gates submit.
//
// The Submit button is intentionally inert here — the atomic submit
// transaction (+ migration, Netlify function, corrective-action emit, DO
// notify) is the next ticket. It renders disabled with a clear note.

import { AlertTriangle, ChevronRight, Flag, ImageIcon, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tier as TierType } from "./types";
import type { ScoreResult } from "./scoring";
import type { SectionStatus } from "./use-walkthrough-store";
import type { CheckIn, WalkthroughTemplate } from "./types";

const TIER_UI: Record<TierType, { label: string; text: string; ring: string }> = {
  green: { label: "Green", text: "text-tier-green", ring: "ring-tier-green/30 bg-tier-green/[0.06]" },
  yellow: { label: "Yellow", text: "text-tier-yellow", ring: "ring-tier-yellow/30 bg-tier-yellow/[0.06]" },
  red: { label: "Red", text: "text-tier-red", ring: "ring-tier-red/30 bg-tier-red/[0.06]" },
};

export interface ReviewStepProps {
  template: WalkthroughTemplate;
  score: ScoreResult;
  sections: SectionStatus[];
  checkIn: CheckIn | null;
  photoCount: number;
  onGoToSection: (index: number) => void;
}

export function ReviewStep({
  template,
  score,
  sections,
  checkIn,
  photoCount,
  onGoToSection,
}: ReviewStepProps) {
  const totalItems = template.sections.reduce((n, s) => n + s.items.length, 0);
  const blockers = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.hasUnanswered || s.incomplete);
  const tier = TIER_UI[score.tier];

  return (
    <div className="px-4 pt-5 pb-40 space-y-4">
      {/* Score + tier */}
      <div className={cn("rounded-xl ring-1 shadow-card p-4 flex items-center gap-4", tier.ring)}>
        <div className="text-center">
          <div className={cn("text-[34px] font-bold leading-none tabular-nums", tier.text)}>
            {score.score}
          </div>
          <div className="text-[11px] text-midnight-500 mt-0.5">score</div>
        </div>
        <div className="flex-1">
          <div className={cn("text-[15px] font-semibold", tier.text)}>{tier.label} tier</div>
          <div className="mt-1 flex items-center gap-3 text-[12px] text-midnight-600">
            <span className="inline-flex items-center gap-1">
              <Flag className="h-3.5 w-3.5 text-bad" strokeWidth={2} />
              {score.failCount} fail
            </span>
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-warn" strokeWidth={2} />
              {score.watchCount} watch
            </span>
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2} />
              {photoCount}
            </span>
          </div>
        </div>
      </div>

      {/* Summary rows */}
      <div className="bg-white rounded-xl ring-1 ring-midnight-100 shadow-card divide-y divide-midnight-100">
        <Row label="Name" value={template.name} />
        <Row label="Type · version" value={`${template.type} · v${template.version}`} />
        <Row label="Structure" value={`${template.sections.length} sections · ${totalItems} items`} />
        <Row
          label="Scoring"
          value={`Pass ${pct(template.scoring.pass)} / Watch ${pct(template.scoring.watch)} / Fail ${pct(template.scoring.fail)}`}
        />
        <Row label="Answered" value={`${score.answered} / ${score.total}`} />
        <Row
          label="Check-in"
          value={
            checkIn ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2} />
                {checkIn.geofenceResult === "on_site"
                  ? "On site"
                  : checkIn.exceptionReason
                  ? "Off-site exception"
                  : "Nearby"}
              </span>
            ) : (
              "—"
            )
          }
        />
      </div>

      {/* Blockers */}
      {blockers.length > 0 ? (
        <div className="bg-bad/[0.04] rounded-xl ring-1 ring-bad/25 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-bad uppercase tracking-wide">
            <AlertTriangle className="h-4 w-4" strokeWidth={2} />
            Needs attention before submit
          </div>
          {blockers.map(({ s, i }) => (
            <button
              key={s.code}
              type="button"
              onClick={() => onGoToSection(i)}
              className="w-full flex items-center justify-between gap-2 bg-white rounded-lg ring-1 ring-midnight-100 px-3 py-2.5 text-left hover:ring-bad/40 transition"
            >
              <div>
                <div className="text-[13px] font-medium text-midnight-900">{s.name}</div>
                <div className="text-[11.5px] text-midnight-500">
                  {[
                    s.hasUnanswered && "unanswered items",
                    s.incomplete && "missing required photo/reason",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-midnight-300 shrink-0" strokeWidth={2} />
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-ok/[0.06] rounded-xl ring-1 ring-ok/25 p-3 text-[12.5px] text-midnight-700">
          Everything required is filled in. Publishing notifies the assigned DO
          and raises a corrective action for each flagged Fail.
        </div>
      )}

      <p className="px-1 text-[10.5px] leading-snug text-midnight-400">
        Preview — the atomic submit transaction (score write, corrective
        actions, DO notify) is the next ticket. The Submit button is disabled
        until that lands.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-[12.5px] text-midnight-500">{label}</span>
      <span className="text-[13px] font-medium text-midnight-900 text-right">{value}</span>
    </div>
  );
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}`;
}
