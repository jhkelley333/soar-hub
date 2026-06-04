// Builder step 4 — template-wide rules.

import { Card, CardBody } from "@/shared/ui/Card";
import { Toggle } from "../controls";
import type { TemplateDraftStore } from "../useTemplateDraft";

export function StepRules({ store }: { store: TemplateDraftStore }) {
  const { draft, setGlobalRules } = store;
  if (!draft) return null;
  return (
    <Card>
      <CardBody className="space-y-5">
        <Toggle
          checked={draft.globalRules.photoOnEveryFail ?? false}
          onChange={(v) => setGlobalRules({ photoOnEveryFail: v })}
          label="Require a photo on every Fail"
          hint="Forces at least one photo whenever any item is failed, on top of per-item rules."
        />
        <Toggle
          checked={draft.globalRules.allowNa ?? false}
          onChange={(v) => setGlobalRules({ allowNa: v })}
          label="Allow N/A on items"
          hint="Lets GMs skip items that don't apply (per-item override still wins). Off = every item must be answered."
        />
      </CardBody>
    </Card>
  );
}
