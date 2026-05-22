// Single-question editor card. The "real" content of a template.
// Field-type-specific config (options for select_one/many, etc.) is
// surfaced as a JSON textarea for now — proper per-type pickers are a
// later UX polish. Audit-mode questions get weight, is_critical, and
// requires_cap_on_fail controls.

import { useState } from "react";
import { Trash2, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import type { FieldType, TemplateType } from "./types";

const FIELD_TYPES: Array<{ value: FieldType; label: string; hint: string }> = [
  { value: "short_text",   label: "Short text",   hint: "Single-line text input." },
  { value: "long_text",    label: "Long text",    hint: "Multi-line text area." },
  { value: "number",       label: "Number",       hint: "Numeric input." },
  { value: "select_one",   label: "Single choice", hint: "Pick one from a list. Provide options in field_config." },
  { value: "select_many",  label: "Multi choice", hint: "Pick any number from a list. Options in field_config." },
  { value: "checkbox",     label: "Yes/no",       hint: "Single checkbox." },
  { value: "date",         label: "Date",         hint: "Date picker." },
  { value: "photo",        label: "Photo",        hint: "Upload one or more images." },
  { value: "file",         label: "File",         hint: "Upload any file." },
  { value: "signature",    label: "Signature",    hint: "Capture a signature image." },
  { value: "pass_fail_na", label: "Pass / Fail / NA", hint: "Audit-style question. Contributes to scoring." },
];

type Q = {
  section_label: string | null;
  question_text: string;
  field_type: FieldType;
  is_required: boolean;
  weight: number | null;
  is_critical: boolean;
  requires_cap_on_fail: boolean;
  cap_assignee_rule: Record<string, unknown> | null;
  field_config: Record<string, unknown> | null;
  conditional_logic: Record<string, unknown> | null;
};

export function QuestionEditor({
  question, index, total, templateType, readOnly,
  onUpdate, onDelete, onMoveUp, onMoveDown,
}: {
  question: Q;
  index: number;
  total: number;
  templateType: TemplateType;
  readOnly: boolean;
  onUpdate: (patch: Partial<Q>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isAudit = templateType === "audit";
  const isPassFailNa = question.field_type === "pass_fail_na";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center pt-1 text-gray-400 shrink-0">
          <span className="text-xs font-mono">{index + 1}</span>
          {!readOnly && (
            <>
              <button
                onClick={onMoveUp}
                disabled={index === 0}
                className="p-0.5 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onMoveDown}
                disabled={index === total - 1}
                className="p-0.5 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          {/* Section label (optional) */}
          <div>
            <Label htmlFor={`q-section-${index}`} className="text-xs">Section (optional)</Label>
            <Input
              id={`q-section-${index}`}
              value={question.section_label ?? ""}
              onChange={(e) => onUpdate({ section_label: e.target.value || null })}
              placeholder="e.g. Open of day"
              disabled={readOnly}
            />
          </div>

          {/* Question text */}
          <div>
            <Label htmlFor={`q-text-${index}`}>Question</Label>
            <Input
              id={`q-text-${index}`}
              value={question.question_text}
              onChange={(e) => onUpdate({ question_text: e.target.value })}
              placeholder="What are you asking?"
              required
              disabled={readOnly}
            />
          </div>

          {/* Type + required */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3 items-end">
            <div>
              <Label htmlFor={`q-type-${index}`}>Type</Label>
              <select
                id={`q-type-${index}`}
                value={question.field_type}
                onChange={(e) => {
                  const ft = e.target.value as FieldType;
                  // Switching INTO pass_fail_na: keep audit flags + weight.
                  // Switching OUT of pass_fail_na: clear audit-specific
                  // settings since they no longer apply.
                  const wasAudit = question.field_type === "pass_fail_na";
                  const becomesAudit = ft === "pass_fail_na";
                  onUpdate({
                    field_type: ft,
                    ...(wasAudit && !becomesAudit && {
                      is_critical: false,
                      requires_cap_on_fail: false,
                      cap_assignee_rule: null,
                    }),
                  });
                }}
                disabled={readOnly}
                className="w-full text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {FIELD_TYPES.find((t) => t.value === question.field_type)?.hint}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={question.is_required}
                onChange={(e) => onUpdate({ is_required: e.target.checked })}
                disabled={readOnly}
                className="rounded"
              />
              <span className="text-sm">Required</span>
            </label>
          </div>

          {/* Audit-specific controls for pass_fail_na */}
          {isAudit && isPassFailNa && (
            <div className="p-3 rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                AUDIT SCORING
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`q-weight-${index}`}>Weight</Label>
                  <Input
                    id={`q-weight-${index}`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={question.weight ?? 1}
                    onChange={(e) => onUpdate({ weight: Number(e.target.value) || 0 })}
                    disabled={readOnly}
                  />
                  <p className="text-xs text-gray-500 mt-1">Points awarded for pass.</p>
                </div>
                <label className="flex items-start gap-2 cursor-pointer pt-6">
                  <input
                    type="checkbox"
                    checked={question.is_critical}
                    onChange={(e) => onUpdate({ is_critical: e.target.checked })}
                    disabled={readOnly}
                    className="rounded mt-0.5"
                  />
                  <div className="text-sm">
                    Critical
                    <div className="text-xs text-gray-500">
                      Fail flips audit_outcome to fail_critical.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 cursor-pointer pt-6">
                  <input
                    type="checkbox"
                    checked={question.requires_cap_on_fail}
                    onChange={(e) => onUpdate({ requires_cap_on_fail: e.target.checked })}
                    disabled={readOnly}
                    className="rounded mt-0.5"
                  />
                  <div className="text-sm">
                    Auto-CAP on fail
                    <div className="text-xs text-gray-500">
                      Spawns a corrective action plan when this fails.
                    </div>
                  </div>
                </label>
              </div>

              {question.requires_cap_on_fail && (
                <div>
                  <Label htmlFor={`q-cap-rule-${index}`} className="text-xs">CAP assignee rule (JSON)</Label>
                  <textarea
                    id={`q-cap-rule-${index}`}
                    value={JSON.stringify(question.cap_assignee_rule ?? { kind: "submitter" }, null, 2)}
                    onChange={(e) => {
                      try {
                        onUpdate({ cap_assignee_rule: JSON.parse(e.target.value) });
                      } catch { /* keep typing */ }
                    }}
                    rows={3}
                    disabled={readOnly}
                    className="w-full font-mono text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
                    placeholder='{ "kind": "submitter" }'
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Supported: {`{ "kind": "fixed", "user_id": "<uuid>" }`}, {`{ "kind": "submitter" }`},
                    {' '}{`{ "kind": "role_relative", "role": "gm", "anchor": "submission_store" }`}.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Advanced (field_config + conditional_logic) */}
          {!readOnly && (
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showAdvanced ? "Hide" : "Show"} advanced (field config, conditional logic)
            </button>
          )}

          {showAdvanced && (
            <div className="space-y-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
              <div>
                <Label htmlFor={`q-config-${index}`} className="text-xs">field_config (JSON)</Label>
                <textarea
                  id={`q-config-${index}`}
                  value={JSON.stringify(question.field_config ?? {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      onUpdate({ field_config: parsed && Object.keys(parsed).length ? parsed : null });
                    } catch { /* keep typing */ }
                  }}
                  rows={3}
                  disabled={readOnly}
                  className="w-full font-mono text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
                  placeholder='e.g. { "options": ["A", "B", "C"], "allow_other": false }'
                />
                <p className="text-xs text-gray-500 mt-1">
                  For select_one/many: {`{ "options": [...], "allow_other"?: bool }`}.
                  For photo: {`{ "geo_tag_required"?: bool, "max_count"?: 3 }`}.
                </p>
              </div>
              <div>
                <Label htmlFor={`q-cond-${index}`} className="text-xs">conditional_logic (JSON)</Label>
                <textarea
                  id={`q-cond-${index}`}
                  value={JSON.stringify(question.conditional_logic ?? {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      onUpdate({ conditional_logic: parsed && Object.keys(parsed).length ? parsed : null });
                    } catch { /* keep typing */ }
                  }}
                  rows={2}
                  disabled={readOnly}
                  className="w-full font-mono text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
                  placeholder='e.g. { "show_if": [{ "question_id": "<uuid>", "op": "eq", "value": "yes" }] }'
                />
              </div>
            </div>
          )}
        </div>

        {!readOnly && (
          <button
            onClick={() => {
              if (confirm(`Delete question "${question.question_text || `#${index + 1}`}"?`)) {
                onDelete();
              }
            }}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 shrink-0"
            title="Delete question"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </Card>
  );
}
