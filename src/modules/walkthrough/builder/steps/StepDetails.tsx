// Builder step 1 — template details.

import { Card, CardBody } from "@/shared/ui/Card";
import { Field, Select, TextInput, Toggle } from "../controls";
import { TEMPLATE_TYPES, type TemplateDraftStore } from "../useTemplateDraft";

export function StepDetails({ store }: { store: TemplateDraftStore }) {
  const { draft, setMeta } = store;
  if (!draft) return null;
  return (
    <Card>
      <CardBody className="space-y-5">
        <Field label="Template name" hint="What GMs and DOs will see in the list.">
          <TextInput
            value={draft.name}
            onChange={(e) => setMeta({ name: e.target.value })}
            placeholder="e.g. Weekly Walkthrough"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <Select
              value={draft.type}
              onChange={(v) => setMeta({ type: v as typeof draft.type })}
              options={TEMPLATE_TYPES.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Version" hint="Stamped on every submission.">
            <TextInput
              value={draft.version}
              onChange={(e) => setMeta({ version: e.target.value })}
              placeholder="1.0"
            />
          </Field>
        </div>

        <div className="border-t border-zinc-100 pt-4">
          <Toggle
            checked={draft.isPublic}
            onChange={(v) => setMeta({ isPublic: v })}
            label="Public — anyone can self-start this"
            hint="When published, anyone who runs walkthroughs sees it under My Walks → 'Available to pick up' and can do it at one of their stores, no assignment needed. Great for self-audits."
          />
        </div>
      </CardBody>
    </Card>
  );
}
