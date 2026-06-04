// Builder step 3 — scoring weights + tier thresholds.

import { Card, CardBody } from "@/shared/ui/Card";
import { cn } from "@/lib/cn";
import { Field, NumberInput } from "../controls";
import type { TemplateDraftStore } from "../useTemplateDraft";

export function StepScoring({ store }: { store: TemplateDraftStore }) {
  const { draft, setScoring, setTiers } = store;
  if (!draft) return null;
  const { scoring, tiers } = draft;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-midnight">Answer values</h3>
            <p className="text-xs text-zinc-500">
              Fraction of an item's weight each answer earns (0–1). N/A is excluded.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Pass">
              <NumberInput
                value={scoring.pass}
                min={0}
                max={1}
                step={0.05}
                onChange={(e) => setScoring({ pass: clamp01(e.target.value) })}
              />
            </Field>
            <Field label="Watch">
              <NumberInput
                value={scoring.watch}
                min={0}
                max={1}
                step={0.05}
                onChange={(e) => setScoring({ watch: clamp01(e.target.value) })}
              />
            </Field>
            <Field label="Fail">
              <NumberInput
                value={scoring.fail}
                min={0}
                max={1}
                step={0.05}
                onChange={(e) => setScoring({ fail: clamp01(e.target.value) })}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-midnight">Tier thresholds</h3>
            <p className="text-xs text-zinc-500">Lower bound of each band, on the 0–100 score.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Green ≥" hint="Top band.">
              <NumberInput
                value={tiers.green}
                min={0}
                max={100}
                onChange={(e) => setTiers({ green: clamp100(e.target.value) })}
              />
            </Field>
            <Field label="Yellow ≥" hint="Below this is Red.">
              <NumberInput
                value={tiers.yellow}
                min={0}
                max={100}
                onChange={(e) => setTiers({ yellow: clamp100(e.target.value) })}
              />
            </Field>
          </div>

          {/* Band preview */}
          <div className="flex h-7 overflow-hidden rounded-md text-[11px] font-medium text-white">
            <Band cls="bg-tier-red" label={`Red 0–${tiers.yellow - 1}`} grow={tiers.yellow} />
            <Band
              cls="bg-tier-yellow"
              label={`Yellow ${tiers.yellow}–${tiers.green - 1}`}
              grow={tiers.green - tiers.yellow}
            />
            <Band cls="bg-tier-green" label={`Green ${tiers.green}–100`} grow={100 - tiers.green} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Band({ cls, label, grow }: { cls: string; label: string; grow: number }) {
  return (
    <div
      className={cn("flex items-center justify-center px-2 whitespace-nowrap", cls)}
      style={{ flexGrow: Math.max(grow, 6) }}
    >
      {label}
    </div>
  );
}

function clamp01(v: string): number {
  return Math.min(1, Math.max(0, Number(v) || 0));
}
function clamp100(v: string): number {
  return Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
}
