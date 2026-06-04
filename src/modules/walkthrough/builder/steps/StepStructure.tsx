// Builder step 2 — sections, items, and per-item follow-up rules.
//
// The structural heart of a template. Each section holds items; each item has
// a label, weight, severity, and an optional N/A escape, plus collapsible
// Fail / Watch follow-up rules that gate the field flow (require photo / reason
// / note; raise a corrective action).

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { cn } from "@/lib/cn";
import { ChipsEditor, Field, NumberInput, Select, TextInput, Toggle } from "../controls";
import { SEVERITIES, type TemplateDraftStore } from "../useTemplateDraft";
import type { FollowupRule, TemplateItem, TemplateSection } from "../../types";

export function StepStructure({ store }: { store: TemplateDraftStore }) {
  const { draft, addSection } = store;
  if (!draft) return null;

  return (
    <div className="space-y-4">
      {draft.sections.length === 0 && (
        <Card>
          <CardBody className="text-center text-sm text-zinc-500">
            No sections yet. Add one to start building the checklist.
          </CardBody>
        </Card>
      )}

      {draft.sections.map((section, i) => (
        <SectionCard
          key={section.code}
          store={store}
          section={section}
          index={i}
          total={draft.sections.length}
        />
      ))}

      <button
        type="button"
        onClick={addSection}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 py-3 text-sm font-medium text-zinc-600 hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        Add section
      </button>
    </div>
  );
}

function SectionCard({
  store,
  section,
  index,
  total,
}: {
  store: TemplateDraftStore;
  section: TemplateSection;
  index: number;
  total: number;
}) {
  const { setSectionName, removeSection, moveSection, addItem } = store;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{section.code}</Badge>
          <TextInput
            value={section.name}
            onChange={(e) => setSectionName(section.code, e.target.value)}
            placeholder="Section name (e.g. Fryer & line)"
            className="flex-1"
          />
          <div className="flex items-center">
            <IconBtn
              label="Move up"
              disabled={index === 0}
              onClick={() => moveSection(section.code, -1)}
            >
              <ChevronUp className="h-4 w-4" />
            </IconBtn>
            <IconBtn
              label="Move down"
              disabled={index === total - 1}
              onClick={() => moveSection(section.code, 1)}
            >
              <ChevronDown className="h-4 w-4" />
            </IconBtn>
            <IconBtn label="Remove section" danger onClick={() => removeSection(section.code)}>
              <Trash2 className="h-4 w-4" />
            </IconBtn>
          </div>
        </div>

        <div className="space-y-2">
          {section.items.map((item) => (
            <ItemRow key={item.code} store={store} sectionCode={section.code} item={item} />
          ))}
        </div>

        <button
          type="button"
          onClick={() => addItem(section.code)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add item
        </button>
      </CardBody>
    </Card>
  );
}

function ItemRow({
  store,
  sectionCode,
  item,
}: {
  store: TemplateDraftStore;
  sectionCode: string;
  item: TemplateItem;
}) {
  const { setItem, removeItem } = store;
  const [open, setOpen] = useState(false);
  const ruleCount = (item.rules ?? []).length;

  return (
    <div className="rounded-lg ring-1 ring-zinc-200 bg-zinc-50/50">
      {/* Two rows on mobile (label gets full width); one row from sm up. */}
      <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
        {/* Line 1: code + label */}
        <div className="flex items-center gap-2 sm:flex-1 sm:min-w-0">
          <GripVertical className="hidden h-4 w-4 shrink-0 text-zinc-300 sm:block" />
          <span className="shrink-0 font-mono text-[11px] text-zinc-400">{item.code}</span>
          <TextInput
            value={item.label}
            onChange={(e) => setItem(sectionCode, item.code, { label: e.target.value })}
            placeholder="Item label"
            className="h-8 flex-1"
          />
        </div>
        {/* Line 2 (mobile): weight + severity + actions */}
        <div className="flex items-center gap-2">
          <div className="w-16 shrink-0">
            <NumberInput
              value={item.weight}
              min={0}
              step={1}
              onChange={(e) =>
                setItem(sectionCode, item.code, { weight: Number(e.target.value) || 0 })
              }
              className="h-8"
              aria-label="Weight"
              title="Weight"
            />
          </div>
          <div className="w-24 shrink-0">
            <Select
              value={item.severity ?? "med"}
              onChange={(v) => setItem(sectionCode, item.code, { severity: v as TemplateItem["severity"] })}
              options={SEVERITIES.map((s) => ({ value: s, label: s }))}
              className="h-8"
            />
          </div>
          <div className="ml-auto flex items-center sm:ml-0">
            <IconBtn
              label="Follow-up rules"
              active={open || ruleCount > 0}
              onClick={() => setOpen((o) => !o)}
            >
              <Settings2 className="h-4 w-4" />
            </IconBtn>
            <IconBtn label="Remove item" danger onClick={() => removeItem(sectionCode, item.code)}>
              <Trash2 className="h-4 w-4" />
            </IconBtn>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-200 p-3 space-y-4">
          <Toggle
            checked={item.allowNa ?? false}
            onChange={(v) => setItem(sectionCode, item.code, { allowNa: v })}
            label="Allow N/A on this item"
            hint="GMs can skip it; excluded from the score."
          />
          <RuleEditor store={store} sectionCode={sectionCode} item={item} trigger="fail" />
          <RuleEditor store={store} sectionCode={sectionCode} item={item} trigger="watch" />
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  store,
  sectionCode,
  item,
  trigger,
}: {
  store: TemplateDraftStore;
  sectionCode: string;
  item: TemplateItem;
  trigger: "fail" | "watch";
}) {
  const rule = (item.rules ?? []).find((r) => r.trigger === trigger) ?? null;
  const on = !!rule;
  const set = (next: FollowupRule | null) =>
    store.setItemRule(sectionCode, item.code, trigger, next);

  const patch = (p: Partial<FollowupRule>) =>
    set({
      ...(rule ?? { trigger, require: {} }),
      ...p,
      trigger,
      require: { ...(rule?.require ?? {}), ...(p.require ?? {}) },
    });

  return (
    <div className={cn("rounded-md ring-1 p-3", trigger === "fail" ? "ring-red-200 bg-red-50/40" : "ring-amber-200 bg-amber-50/40")}>
      <Toggle
        checked={on}
        onChange={(v) =>
          set(
            v
              ? {
                  trigger,
                  require: trigger === "fail" ? { photo: 1, reason: true } : { reason: true },
                  raiseCorrectiveAction: trigger === "fail",
                }
              : null,
          )
        }
        label={trigger === "fail" ? "On Fail…" : "On Watch…"}
        hint={trigger === "fail" ? "What's required when this item fails." : "What's required when flagged to watch."}
      />

      {on && rule && (
        <div className="mt-3 space-y-3 sm:pl-12">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Photos required">
              <NumberInput
                value={rule.require.photo ?? 0}
                min={0}
                max={6}
                onChange={(e) => patch({ require: { photo: Number(e.target.value) || 0 } })}
                className="h-8"
              />
            </Field>
            <div className="flex items-end gap-4 pb-1 sm:col-span-2">
              <Toggle
                checked={!!rule.require.reason}
                onChange={(v) => patch({ require: { reason: v } })}
                label="Reason"
              />
              <Toggle
                checked={!!rule.require.note}
                onChange={(v) => patch({ require: { note: v } })}
                label="Note"
              />
            </div>
          </div>

          {rule.require.reason && (
            <Field label="Reason options" hint="Quick-pick chips; leave empty for free text only.">
              <ChipsEditor
                values={rule.reasonOptions ?? []}
                onChange={(next) => patch({ reasonOptions: next })}
              />
            </Field>
          )}

          {trigger === "fail" && (
            <Toggle
              checked={rule.raiseCorrectiveAction !== false}
              onChange={(v) => patch({ raiseCorrectiveAction: v })}
              label="Raise a corrective action on submit"
              hint="Creates a tracked fix assigned to the GM."
            />
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition",
        disabled && "opacity-30 cursor-not-allowed",
        !disabled && danger && "hover:bg-red-50 hover:text-red-600",
        !disabled && !danger && "hover:bg-zinc-100",
        active && "bg-accent/10 text-accent",
      )}
    >
      {children}
    </button>
  );
}
