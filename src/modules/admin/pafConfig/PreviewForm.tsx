import { useMemo, useState } from "react";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import type { FieldConfig, PafFormConfig, SectionKey } from "./types";

// Read-only mirror of the bindCat() logic in Index.html. Kept here so the
// preview shows the right sections per category. The real submit-side
// version lives in the (future) PAF form code; this is purely visual.
function visibleSections(category: string): Set<SectionKey> {
  const out = new Set<SectionKey>(["notes"]);
  const c = category.toLowerCase();

  const isBonus =
    c.includes("bonus") || c === "training" || c === "referral";
  const isPTO = c === "pto";
  const isIllness = c === "illness";
  const isTerm = c === "termination" || c === "final check";
  const isDemotion = c === "demotion";
  const isStore = c === "cross store work" || c === "transfer";
  const isTips =
    c === "pos adjustment" || c === "backpay" || c === "other";

  if (!isBonus && !isPTO && !isIllness && !isDemotion) out.add("pay");
  if (isTips || isStore) out.add("tips");
  if (isPTO) out.add("leave");
  if (isIllness) out.add("illness");
  if (isStore) out.add("store");
  if (isTerm) out.add("term");
  if (isDemotion) out.add("demotion");
  if (isBonus) out.add("bonus");
  return out;
}

export function PreviewForm({ draft }: { draft: PafFormConfig }) {
  const [category, setCategory] = useState(
    draft.lists.categories[0] ?? ""
  );

  const visible = useMemo(() => visibleSections(category), [category]);

  // Group fields by section.
  const fieldsBySection = useMemo(() => {
    const out: Partial<Record<SectionKey, [string, FieldConfig][]>> = {};
    for (const [key, cfg] of Object.entries(draft.fields)) {
      if (!cfg.visible) continue;
      const sec = (cfg.section ?? "top") as SectionKey;
      (out[sec] ||= []).push([key, cfg]);
    }
    return out;
  }, [draft.fields]);

  const orderedSections = [...draft.sections].sort((a, b) => a.order - b.order);

  return (
    <div>
      <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
        Preview reflects your <strong>unsaved draft</strong>. The actual PAF
        form is migrated separately and will pick up the saved config.
      </div>

      {/* Category picker drives which sections show. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="prev-cat">PAF Category</Label>
          <select
            id="prev-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {draft.lists.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-end gap-2">
          <span className="text-xs text-zinc-500">Sections that will show:</span>
          <div className="flex flex-wrap gap-1.5">
            {orderedSections
              .filter((s) => visible.has(s.key))
              .map((s) => (
                <Badge key={s.key} tone="info">
                  {s.title}
                </Badge>
              ))}
          </div>
        </div>
      </div>

      {/* Top fields (always shown) */}
      <PreviewSection title="Top of form">
        {fieldsBySection.top?.map(([k, f]) => (
          <PreviewField key={k} fieldKey={k} cfg={f} />
        ))}
      </PreviewSection>

      {/* Conditional sections in their configured order */}
      {orderedSections
        .filter((s) => s.key !== "notes" && visible.has(s.key))
        .map((s) => (
          <PreviewSection
            key={s.key}
            title={s.title}
            description={s.description}
          >
            {fieldsBySection[s.key]?.length ? (
              fieldsBySection[s.key]!.map(([k, f]) => (
                <PreviewField key={k} fieldKey={k} cfg={f} />
              ))
            ) : (
              <div className="text-xs text-zinc-400">(no visible fields)</div>
            )}
          </PreviewSection>
        ))}

      {/* Notes always last */}
      <PreviewSection
        title={
          orderedSections.find((s) => s.key === "notes")?.title ?? "Notes"
        }
      >
        {fieldsBySection.notes?.map(([k, f]) => (
          <PreviewField key={k} fieldKey={k} cfg={f} />
        ))}
      </PreviewSection>
    </div>
  );
}

function PreviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold tracking-tight text-midnight">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function PreviewField({
  fieldKey,
  cfg,
}: {
  fieldKey: string;
  cfg: FieldConfig;
}) {
  return (
    <div>
      <Label htmlFor={`prev-${fieldKey}`}>
        {cfg.label}
        {cfg.required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      <Input
        id={`prev-${fieldKey}`}
        placeholder={cfg.placeholder}
        disabled
        readOnly
        className="bg-zinc-50"
      />
      {cfg.helpText && (
        <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>
      )}
    </div>
  );
}
