import { useMemo } from "react";
import { Lock } from "lucide-react";
import { Input } from "@/shared/ui/Input";
import { LOCKED_FIELD_KEYS, COST_FIELD_KEYS } from "./defaults";
import type { FieldConfig, PafFormConfig, SectionKey } from "./types";

const SECTION_ORDER: SectionKey[] = [
  "top",
  "pay",
  "tips",
  "leave",
  "illness",
  "store",
  "term",
  "demotion",
  "bonus",
  "notes",
];

const SECTION_LABEL: Record<SectionKey, string> = {
  top: "Top of form",
  pay: "Position & Pay",
  tips: "Tips",
  leave: "PTO",
  illness: "Illness",
  store: "Store Routing",
  term: "Termination / Final Check",
  demotion: "Demotion",
  bonus: "Bonus Details",
  notes: "Notes",
};

export function FieldsEditor({
  draft,
  onChange,
}: {
  draft: PafFormConfig;
  onChange: (next: PafFormConfig) => void;
}) {
  // Group fields by section so the table reads naturally.
  const grouped = useMemo(() => {
    const out: Partial<Record<SectionKey, [string, FieldConfig][]>> = {};
    for (const [key, cfg] of Object.entries(draft.fields)) {
      const sec = (cfg.section ?? "top") as SectionKey;
      (out[sec] ||= []).push([key, cfg]);
    }
    return out;
  }, [draft.fields]);

  function patchField(key: string, patch: Partial<FieldConfig>) {
    const current = draft.fields[key];
    if (!current) return;
    onChange({
      ...draft,
      fields: { ...draft.fields, [key]: { ...current, ...patch } },
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Locked fields (
        <Lock className="inline h-3 w-3 align-text-bottom" strokeWidth={2} />)
        cannot be hidden or made optional, and their internal name can't
        change. You can still edit their visible label and help text. Cost-
        calculation fields are listed under their section.
      </p>

      {SECTION_ORDER.filter((s) => grouped[s] && grouped[s]!.length > 0).map(
        (sec) => (
          <div key={sec}>
            <h3 className="mb-2 text-sm font-semibold tracking-tight text-midnight">
              {SECTION_LABEL[sec]}
            </h3>
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 text-left text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium">Placeholder</th>
                    <th className="px-3 py-2 font-medium">Help text</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Visible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {grouped[sec]!.map(([key, cfg]) => (
                    <FieldRow
                      key={key}
                      fieldKey={key}
                      cfg={cfg}
                      onPatch={(p) => patchField(key, p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function FieldRow({
  fieldKey,
  cfg,
  onPatch,
}: {
  fieldKey: string;
  cfg: FieldConfig;
  onPatch: (patch: Partial<FieldConfig>) => void;
}) {
  const locked = LOCKED_FIELD_KEYS.has(fieldKey);
  const isCostField = COST_FIELD_KEYS.has(fieldKey);

  return (
    <tr>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1 font-mono text-zinc-700">
          {locked && <Lock className="h-3 w-3 text-zinc-400" strokeWidth={2} />}
          {fieldKey}
        </div>
        {isCostField && (
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-700">
            cost calc
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={cfg.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={cfg.placeholder}
          onChange={(e) => onPatch({ placeholder: e.target.value })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          value={cfg.helpText}
          onChange={(e) => onPatch({ helpText: e.target.value })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.required}
            disabled={locked}
            onChange={(e) => onPatch({ required: e.target.checked })}
            className="h-4 w-4 accent-accent disabled:opacity-50"
          />
          {locked && <span className="text-[10px] text-zinc-400">locked</span>}
        </label>
      </td>
      <td className="px-3 py-2 align-top">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.visible}
            disabled={locked}
            onChange={(e) => onPatch({ visible: e.target.checked })}
            className="h-4 w-4 accent-accent disabled:opacity-50"
          />
          {locked && <span className="text-[10px] text-zinc-400">locked</span>}
        </label>
      </td>
    </tr>
  );
}
