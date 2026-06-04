// Builder step 3 — scoring. Three plain-card sections matching the
// simplified mobile design:
//   • How answers score — Pass / Watch / Fail as a % of item weight.
//   • Tiers — Green / Yellow / Red bands on the 0–100 score.
//   • Global rules — template-wide toggles (folded in from the old
//     standalone Rules step).

import { cn } from "@/lib/cn";
import { NumberInput, Toggle } from "../controls";
import type { TemplateDraftStore } from "../useTemplateDraft";

export function StepScoring({ store }: { store: TemplateDraftStore }) {
  const { draft, setScoring, setTiers, setGlobalRules } = store;
  if (!draft) return null;
  const { scoring, tiers, globalRules } = draft;

  return (
    <div className="space-y-6">
      {/* How answers score */}
      <section>
        <SectionLabel>How answers score</SectionLabel>
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <AnswerRow tone="green" label="Pass" value={scoring.pass} onPct={(p) => setScoring({ pass: pctToFrac(p) })} />
          <AnswerRow tone="amber" label="Watch" value={scoring.watch} onPct={(p) => setScoring({ watch: pctToFrac(p) })} />
          <AnswerRow tone="red" label="Fail" value={scoring.fail} onPct={(p) => setScoring({ fail: pctToFrac(p) })} />
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-zinc-500">
          The percent of an item's weight each answer earns. N/A items are excluded from the score.
        </p>
      </section>

      {/* Tiers */}
      <section>
        <SectionLabel>Tiers</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="divide-y divide-zinc-100">
            <TierRow dot="bg-tier-green" label="Green">
              <span className="text-sm text-zinc-400">≥</span>
              <PctBox value={tiers.green} onChange={(v) => setTiers({ green: clamp100(v) })} />
            </TierRow>
            <TierRow dot="bg-tier-yellow" label="Yellow">
              <PctBox value={tiers.yellow} onChange={(v) => setTiers({ yellow: clamp100(v) })} />
              <span className="text-sm text-zinc-400">– {Math.max(tiers.yellow, tiers.green - 1)}</span>
            </TierRow>
            <TierRow dot="bg-tier-red" label="Red">
              <span className="text-sm text-zinc-500">&lt; {tiers.yellow}</span>
            </TierRow>
          </div>
          {/* Band preview */}
          <div className="flex h-7 text-[11px] font-medium text-white">
            <Band cls="bg-tier-red" label={`0–${Math.max(tiers.yellow - 1, 0)}`} grow={tiers.yellow} />
            <Band
              cls="bg-tier-yellow"
              label={`${tiers.yellow}–${Math.max(tiers.green - 1, tiers.yellow)}`}
              grow={Math.max(tiers.green - tiers.yellow, 0)}
            />
            <Band cls="bg-tier-green" label={`${tiers.green}–100`} grow={100 - tiers.green} />
          </div>
        </div>
      </section>

      {/* Global rules */}
      <section>
        <SectionLabel>Global rules</SectionLabel>
        <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-4">
          <Toggle
            checked={globalRules.photoOnEveryFail ?? false}
            onChange={(v) => setGlobalRules({ photoOnEveryFail: v })}
            label="Require a photo on every Fail"
            hint="Overrides the per-item setting — forces at least one photo whenever any item is failed."
          />
          <Toggle
            checked={globalRules.allowNa ?? false}
            onChange={(v) => setGlobalRules({ allowNa: v })}
            label="Allow N/A on items"
            hint="Lets GMs mark items not applicable (a per-item override still wins). Off = every item must be answered."
          />
        </div>
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h3>
  );
}

function AnswerRow({
  tone,
  label,
  value,
  onPct,
}: {
  tone: "green" | "amber" | "red";
  label: string;
  value: number;
  onPct: (pct: string) => void;
}) {
  const chip =
    tone === "green"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn("inline-flex w-16 justify-center rounded-md px-2 py-1 text-xs font-semibold", chip)}>
        {label}
      </span>
      <div className="flex items-center gap-1.5 text-sm text-zinc-700">
        <span>Earns</span>
        <NumberInput
          value={fracToPct(value)}
          min={0}
          max={100}
          step={5}
          onChange={(e) => onPct(e.target.value)}
          className="h-8 w-16 text-center"
          aria-label={`${label} percent of item weight`}
        />
        <span>% of item weight</span>
      </div>
    </div>
  );
}

function TierRow({
  dot,
  label,
  children,
}: {
  dot: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
        <span className="text-sm font-medium text-midnight">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function PctBox({ value, onChange }: { value: number; onChange: (v: string) => void }) {
  return (
    <NumberInput
      value={value}
      min={0}
      max={100}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-16 text-center"
      aria-label="Threshold"
    />
  );
}

function Band({ cls, label, grow }: { cls: string; label: string; grow: number }) {
  return (
    <div
      className={cn("flex items-center justify-center whitespace-nowrap px-2", cls)}
      style={{ flexGrow: Math.max(grow, 6) }}
    >
      {label}
    </div>
  );
}

function pctToFrac(v: string): number {
  return Math.min(1, Math.max(0, (Number(v) || 0) / 100));
}
function fracToPct(f: number): number {
  return Math.round((f ?? 0) * 100);
}
function clamp100(v: string): number {
  return Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
}
