// Create / edit a schedule. Surfaces the most-common assignee_rule
// shapes inline (fixed user, role_relative, per_store) and a raw JSON
// escape hatch for anything else.

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { createSchedule, updateSchedule } from "./api";
import type { WorkspaceSchedule, WorkspaceTemplate, Cadence } from "./types";

const CADENCES: Array<{ value: Cadence; label: string }> = [
  { value: "daily",     label: "Daily" },
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Every other week" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const RULE_KINDS = [
  { value: "role_relative", label: "Role at scope/store" },
  { value: "fixed",         label: "Specific user (uuid)" },
  { value: "per_store",     label: "Role at each store under a scope" },
] as const;

type RuleKind = typeof RULE_KINDS[number]["value"];

function defaultRule(kind: RuleKind): Record<string, unknown> {
  if (kind === "fixed") return { kind: "fixed", user_id: "" };
  if (kind === "role_relative") {
    return { kind: "role_relative", role: "gm", anchor: "spawned_store" };
  }
  return { kind: "per_store", scope_kind: "district", scope_id: "", role_in_store: "gm" };
}

export function ScheduleEditorModal({
  workspaceId, templates, existing, open, onClose, onSaved,
}: {
  workspaceId: string;
  templates: WorkspaceTemplate[];
  existing: WorkspaceSchedule | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;

  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1); // Mon
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [spawnTime, setSpawnTime] = useState("08:00");
  const [spawnTz, setSpawnTz] = useState("America/Chicago");
  const [dueAfter, setDueAfter] = useState(24);
  const [isActive, setIsActive] = useState(true);
  const [ruleKind, setRuleKind] = useState<RuleKind>("role_relative");
  const [rule, setRule] = useState<Record<string, unknown>>(defaultRule("role_relative"));
  const [showJson, setShowJson] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Hydrate the editor when opening on an existing row.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTemplateId(existing.template_id);
      setCadence(existing.cadence);
      setDayOfWeek(existing.day_of_week ?? 1);
      setDayOfMonth(existing.day_of_month ?? 1);
      setSpawnTime((existing.spawn_time ?? "08:00").slice(0, 5));
      setSpawnTz(existing.spawn_tz ?? "America/Chicago");
      setDueAfter(existing.due_after_hours ?? 24);
      setIsActive(existing.is_active);
      const k = String(existing.assignee_rule?.kind ?? "role_relative") as RuleKind;
      setRuleKind(RULE_KINDS.some((r) => r.value === k) ? k : "role_relative");
      setRule(existing.assignee_rule ?? defaultRule("role_relative"));
    } else {
      setTemplateId("");
      setCadence("weekly");
      setDayOfWeek(1);
      setDayOfMonth(1);
      setSpawnTime("08:00");
      setSpawnTz("America/Chicago");
      setDueAfter(24);
      setIsActive(true);
      setRuleKind("role_relative");
      setRule(defaultRule("role_relative"));
    }
    setShowJson(false);
    setError(null);
  }, [open, existing]);

  function changeRuleKind(k: RuleKind) {
    setRuleKind(k);
    setRule(defaultRule(k));
  }

  function updateRule(patch: Record<string, unknown>) {
    setRule((prev) => ({ ...prev, ...patch }));
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const base: Record<string, unknown> = {
        workspace_id: workspaceId,
        template_id: templateId,
        cadence,
        spawn_time: spawnTime,
        spawn_tz: spawnTz,
        assignee_rule: rule,
        due_after_hours: dueAfter,
        is_active: isActive,
      };
      if (cadence === "weekly" || cadence === "biweekly") {
        base.day_of_week = dayOfWeek;
      }
      if (cadence === "monthly" || cadence === "quarterly") {
        base.day_of_month = dayOfMonth;
      }
      if (isEdit) {
        return updateSchedule({ id: existing!.id, ...base });
      }
      return createSchedule(base);
    },
    onSuccess: () => { setError(null); onSaved(); },
    onError: (e) => setError((e as Error)?.message ?? "Save failed."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setError("Pick a template first.");
      return;
    }
    saveMut.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit schedule" : "New schedule"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="schedule-editor-form"
            disabled={saveMut.isPending || !templateId}
          >
            {saveMut.isPending ? "Saving..." : isEdit ? "Save changes" : "Create schedule"}
          </Button>
        </div>
      }
    >
      <form id="schedule-editor-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="sch-template">Template</Label>
          <select
            id="sch-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
            disabled={isEdit}
            className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2 disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="">Pick a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
            ))}
          </select>
          {isEdit && (
            <p className="text-xs text-gray-500 mt-1">
              Template can't be changed on an existing schedule — delete and create a new one if you need to swap.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sch-cadence">Cadence</Label>
            <select
              id="sch-cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sch-time">Spawn time (24h, in TZ)</Label>
            <Input
              id="sch-time"
              type="time"
              value={spawnTime}
              onChange={(e) => setSpawnTime(e.target.value || "08:00")}
            />
          </div>
        </div>

        {(cadence === "weekly" || cadence === "biweekly") && (
          <div>
            <Label htmlFor="sch-dow">Day of week</Label>
            <select
              id="sch-dow"
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
            >
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        )}

        {(cadence === "monthly" || cadence === "quarterly") && (
          <div>
            <Label htmlFor="sch-dom">Day of month (1–28)</Label>
            <Input
              id="sch-dom"
              type="number"
              min={1}
              max={28}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
            />
            <p className="text-xs text-gray-500 mt-1">
              Capped at 28 to avoid month-edge cases (Feb has 28 days).
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="sch-tz">Timezone (IANA)</Label>
          <Input
            id="sch-tz"
            value={spawnTz}
            onChange={(e) => setSpawnTz(e.target.value)}
            placeholder="America/Chicago"
          />
        </div>

        <div>
          <Label htmlFor="sch-due">Due after (hours from spawn)</Label>
          <Input
            id="sch-due"
            type="number"
            min={1}
            value={dueAfter}
            onChange={(e) => setDueAfter(Math.max(1, Number(e.target.value) || 24))}
          />
        </div>

        <div className="space-y-3 p-3 rounded border border-gray-200 bg-gray-50/50">
          <div>
            <Label htmlFor="sch-rule-kind">Who gets the assignment?</Label>
            <select
              id="sch-rule-kind"
              value={ruleKind}
              onChange={(e) => changeRuleKind(e.target.value as RuleKind)}
              className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
            >
              {RULE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>

          {ruleKind === "fixed" && (
            <div>
              <Label htmlFor="sch-rule-uid">User ID (uuid)</Label>
              <Input
                id="sch-rule-uid"
                value={String(rule.user_id ?? "")}
                onChange={(e) => updateRule({ user_id: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
          )}

          {ruleKind === "role_relative" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sch-rule-role">Role</Label>
                <Input
                  id="sch-rule-role"
                  value={String(rule.role ?? "")}
                  onChange={(e) => updateRule({ role: e.target.value })}
                  placeholder="gm, do, sdo..."
                />
              </div>
              <div>
                <Label htmlFor="sch-rule-anchor">Anchor</Label>
                <Input
                  id="sch-rule-anchor"
                  value={String(rule.anchor ?? "")}
                  onChange={(e) => updateRule({ anchor: e.target.value })}
                  placeholder="spawned_store / scope_anchor"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use <code>spawned_store</code> for per-store schedules and
                  {" "}<code>scope_anchor</code> when the workspace pins to a region/area/district.
                </p>
              </div>
            </div>
          )}

          {ruleKind === "per_store" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="sch-rule-scope-kind">Scope kind</Label>
                  <select
                    id="sch-rule-scope-kind"
                    value={String(rule.scope_kind ?? "district")}
                    onChange={(e) => updateRule({ scope_kind: e.target.value })}
                    className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
                  >
                    <option value="region">Region</option>
                    <option value="area">Area</option>
                    <option value="district">District</option>
                    <option value="store">Store</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="sch-rule-role-in-store">Role at each store</Label>
                  <Input
                    id="sch-rule-role-in-store"
                    value={String(rule.role_in_store ?? "")}
                    onChange={(e) => updateRule({ role_in_store: e.target.value })}
                    placeholder="gm"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="sch-rule-scope-id">Scope ID (uuid)</Label>
                <Input
                  id="sch-rule-scope-id"
                  value={String(rule.scope_id ?? "")}
                  onChange={(e) => updateRule({ scope_id: e.target.value })}
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Spawns one assignment for every store under this scope.
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showJson ? "Hide" : "Show"} raw assignee_rule JSON
          </button>
          {showJson && (
            <textarea
              value={JSON.stringify(rule, null, 2)}
              onChange={(e) => {
                try { setRule(JSON.parse(e.target.value)); } catch { /* keep typing */ }
              }}
              rows={5}
              className="w-full font-mono text-xs rounded border border-gray-300 bg-white px-2 py-1.5"
            />
          )}
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded"
          />
          Active (uncheck to pause without deleting)
        </label>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
        )}
      </form>
    </Modal>
  );
}
