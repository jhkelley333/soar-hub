// Builder step 5 — review, validation gate, and activation.

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Toggle } from "../controls";
import type { TemplateDraftStore } from "../useTemplateDraft";

export function StepReview({ store }: { store: TemplateDraftStore }) {
  const { draft, validation, setMeta } = store;
  if (!draft) return null;
  const itemCount = draft.sections.reduce((n, s) => n + s.items.length, 0);
  const ruleCount = draft.sections.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + (i.rules?.length ?? 0), 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="divide-y divide-zinc-100">
          <Row label="Name" value={draft.name || "—"} />
          <Row label="Type · version" value={`${draft.type} · v${draft.version}`} />
          <Row label="Structure" value={`${draft.sections.length} sections · ${itemCount} items`} />
          <Row label="Follow-up rules" value={`${ruleCount}`} />
          <Row
            label="Scoring"
            value={`Pass ${pct(draft.scoring.pass)} / Watch ${pct(draft.scoring.watch)} / Fail ${pct(draft.scoring.fail)}`}
          />
          <Row label="Tiers" value={`Green ≥ ${draft.tiers.green} · Yellow ≥ ${draft.tiers.yellow}`} />
          <Row
            label="Global rules"
            value={[
              draft.globalRules.photoOnEveryFail && "Photo on every Fail",
              draft.globalRules.allowNa ? "N/A allowed" : "N/A off",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </CardBody>
      </Card>

      {validation.ok ? (
        <Card>
          <CardBody className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            <div className="text-sm text-zinc-600">
              Ready to publish. Activate it below to make it available for assignments.
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-600">
              <AlertTriangle className="h-4 w-4" />
              Fix before publishing
            </div>
            <ul className="space-y-1">
              {validation.problems.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-zinc-600">
                  <Badge tone="danger">!</Badge>
                  {p}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <Toggle
            checked={draft.isActive}
            onChange={(v) => setMeta({ isActive: v })}
            label="Active"
            hint="Active templates can be assigned to GMs. Inactive saves as a draft."
          />
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-midnight text-right">{value}</span>
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}`;
}
