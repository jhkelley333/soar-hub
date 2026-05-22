// Single approval-step editor. Each step has a label + an approver_rule
// (DSL JSON). For the common cases we surface inline pickers; the
// raw JSON textarea is always available as an escape hatch.
//
// Supported approver_rule kinds:
//   { kind: "fixed",          user_id }
//   { kind: "role_relative",  role, anchor: "scope_anchor" | "submission_store" }
//   { kind: "role_any",       role }
//   { kind: "any_of_roles",   roles: [...] }

import { useState } from "react";
import { Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";

type S = {
  label: string;
  approver_rule: Record<string, unknown>;
  any_can_approve: boolean;
};

const RULE_KINDS = [
  { value: "role_relative", label: "Role at the store/scope" },
  { value: "fixed",         label: "A specific user" },
  { value: "role_any",      label: "Anyone with a role (no scope filter)" },
  { value: "any_of_roles",  label: "Anyone matching any of N roles" },
] as const;

const ANCHORS = [
  { value: "submission_store", label: "Submission's store" },
  { value: "scope_anchor",     label: "Workspace anchor" },
] as const;

export function ApprovalStepEditor({
  step, index, total, readOnly,
  onUpdate, onDelete, onMoveUp, onMoveDown,
}: {
  step: S;
  index: number;
  total: number;
  readOnly: boolean;
  onUpdate: (patch: Partial<S>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const rule = step.approver_rule as Record<string, unknown>;
  const kind = (rule.kind as string) || "role_relative";

  function updateRule(patch: Record<string, unknown>) {
    onUpdate({ approver_rule: { ...rule, ...patch } });
  }

  function changeKind(newKind: string) {
    // Reset rule shape to a sensible default for the chosen kind so
    // we don't carry stale fields between shapes.
    let next: Record<string, unknown>;
    switch (newKind) {
      case "fixed":         next = { kind: "fixed", user_id: "" }; break;
      case "role_relative": next = { kind: "role_relative", role: "do", anchor: "submission_store" }; break;
      case "role_any":      next = { kind: "role_any", role: "rvp" }; break;
      case "any_of_roles":  next = { kind: "any_of_roles", roles: ["rvp", "vp"] }; break;
      default:              next = { kind: newKind };
    }
    onUpdate({ approver_rule: next });
  }

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
          <div>
            <Label htmlFor={`step-label-${index}`}>Step label</Label>
            <Input
              id={`step-label-${index}`}
              value={step.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="e.g. DO sign-off"
              required
              disabled={readOnly}
            />
          </div>

          <div>
            <Label htmlFor={`step-kind-${index}`}>Who can approve?</Label>
            <select
              id={`step-kind-${index}`}
              value={kind}
              onChange={(e) => changeKind(e.target.value)}
              disabled={readOnly}
              className="w-full text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2"
            >
              {RULE_KINDS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Kind-specific controls */}
          {kind === "fixed" && (
            <div>
              <Label htmlFor={`step-fixed-${index}`}>User ID (uuid)</Label>
              <Input
                id={`step-fixed-${index}`}
                value={String(rule.user_id ?? "")}
                onChange={(e) => updateRule({ user_id: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
                disabled={readOnly}
              />
            </div>
          )}

          {kind === "role_relative" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`step-role-${index}`}>Role</Label>
                <Input
                  id={`step-role-${index}`}
                  value={String(rule.role ?? "")}
                  onChange={(e) => updateRule({ role: e.target.value })}
                  placeholder="do, sdo, rvp..."
                  disabled={readOnly}
                />
              </div>
              <div>
                <Label htmlFor={`step-anchor-${index}`}>Anchor</Label>
                <select
                  id={`step-anchor-${index}`}
                  value={String(rule.anchor ?? "submission_store")}
                  onChange={(e) => updateRule({ anchor: e.target.value })}
                  disabled={readOnly}
                  className="w-full text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2"
                >
                  {ANCHORS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  "Submission's store" finds the role-holder at the store the
                  form was filled out at. "Workspace anchor" uses the workspace's
                  configured anchor.
                </p>
              </div>
            </div>
          )}

          {kind === "role_any" && (
            <div>
              <Label htmlFor={`step-roleany-${index}`}>Role</Label>
              <Input
                id={`step-roleany-${index}`}
                value={String(rule.role ?? "")}
                onChange={(e) => updateRule({ role: e.target.value })}
                placeholder="rvp"
                disabled={readOnly}
              />
              <p className="text-xs text-gray-500 mt-1">
                ANY active user with this role can approve (no scope filter).
              </p>
            </div>
          )}

          {kind === "any_of_roles" && (
            <div>
              <Label htmlFor={`step-roles-${index}`}>Roles (comma-separated)</Label>
              <Input
                id={`step-roles-${index}`}
                value={
                  Array.isArray(rule.roles) ? (rule.roles as string[]).join(", ") : ""
                }
                onChange={(e) =>
                  updateRule({
                    roles: e.target.value.split(",").map((r) => r.trim()).filter(Boolean),
                  })
                }
                placeholder="rvp, vp, coo"
                disabled={readOnly}
              />
              <p className="text-xs text-gray-500 mt-1">
                ANY active user with one of these roles can approve.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={step.any_can_approve}
              onChange={(e) => onUpdate({ any_can_approve: e.target.checked })}
              disabled={readOnly}
              className="rounded mt-0.5"
            />
            <div className="text-sm">
              Any candidate can approve
              <div className="text-xs text-gray-500">
                When ON: the first matching person to approve advances the
                submission. When OFF: every matching person must approve.
                (V1 always behaves as ON; OFF reserved for future "all required"
                semantics.)
              </div>
            </div>
          </label>

          {!readOnly && (
            <button
              onClick={() => setShowJson((v) => !v)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showJson ? "Hide" : "Show"} raw approver_rule JSON
            </button>
          )}

          {showJson && (
            <div>
              <textarea
                value={JSON.stringify(rule, null, 2)}
                onChange={(e) => {
                  try {
                    onUpdate({ approver_rule: JSON.parse(e.target.value) });
                  } catch { /* keep typing */ }
                }}
                rows={5}
                disabled={readOnly}
                className="w-full font-mono text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
              />
            </div>
          )}
        </div>

        {!readOnly && (
          <button
            onClick={() => {
              if (confirm(`Delete approval step "${step.label || `#${index + 1}`}"?`)) {
                onDelete();
              }
            }}
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 shrink-0"
            title="Delete step"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </Card>
  );
}
