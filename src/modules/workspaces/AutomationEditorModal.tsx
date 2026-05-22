// Create / edit an automation. The trigger/action DSL is rich enough
// that we surface the common shapes inline (with kind-specific fields)
// and let everything else fall back to a raw JSON textarea. Condition
// is always raw JSON since the worker accepts arbitrary { kind, ... }
// or { all/any: [...] } trees — full UI for that would be its own slice.

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import {
  createAutomation, updateAutomation, listTemplates,
} from "./api";
import type { WorkspaceAutomation, WorkspaceTemplate } from "./types";

type TriggerKind =
  | "on_submit"
  | "on_score_below"
  | "on_cap_overdue"
  | "on_cap_reopened"
  | "on_repeat_finding"
  | "scheduled";

type ActionKind =
  | "send_email"
  | "notify_in_app"
  | "create_assignment"
  | "create_cap"
  | "log_only";

const TRIGGER_KINDS: Array<{ value: TriggerKind; label: string; hint: string }> = [
  { value: "on_submit",         label: "On submit",        hint: "Fires when an audit/form submission lands." },
  { value: "on_score_below",    label: "On low score",     hint: "Fires when an audit submission scores below a threshold." },
  { value: "on_cap_overdue",    label: "On CAP overdue",   hint: "Fires when a corrective action plan passes its due date." },
  { value: "on_cap_reopened",   label: "On CAP reopened",  hint: "Fires when a CAP gets reopened by a verifier." },
  { value: "on_repeat_finding", label: "On repeat finding", hint: "Fires when the same question fails N+ times at one store." },
  { value: "scheduled",         label: "Scheduled (cron)",  hint: "Fires on a cron expression (the worker runs every 15 min)." },
];

const ACTION_KINDS: Array<{ value: ActionKind; label: string; hint: string }> = [
  { value: "send_email",        label: "Send email",         hint: "Send an email via Resend." },
  { value: "notify_in_app",     label: "Notify in-app",      hint: "In-app notification (no email)." },
  { value: "create_assignment", label: "Create assignment",  hint: "Spawn a follow-up assignment from a template." },
  { value: "create_cap",        label: "Create CAP",         hint: "Spawn a corrective action plan tied to the trigger context." },
  { value: "log_only",          label: "Log only (testing)", hint: "No side effect — just logs to activity. Useful for testing rules." },
];

const RECIPIENT_MODES = [
  { value: "to_role",     label: "Role (everyone matching)" },
  { value: "to_emails",   label: "Specific email address(es)" },
  { value: "to_user_ids", label: "Specific user(s) by uuid" },
] as const;
type RecipientMode = typeof RECIPIENT_MODES[number]["value"];

function defaultTrigger(kind: TriggerKind): Record<string, unknown> {
  if (kind === "on_score_below")    return { kind, threshold: 80 };
  if (kind === "on_cap_overdue")    return { kind, grace_hours: 0 };
  if (kind === "on_cap_reopened")   return { kind, min_reopens: 1 };
  if (kind === "on_repeat_finding") return { kind, min_occurrences: 2 };
  if (kind === "scheduled")          return { kind, cron: "0 8 * * 1" };
  return { kind };
}

function defaultAction(kind: ActionKind): Record<string, unknown> {
  if (kind === "send_email") {
    return { kind, to_role: "do", subject: "", body: "" };
  }
  if (kind === "notify_in_app") {
    return { kind, to_role: "do", message: "" };
  }
  if (kind === "create_assignment") {
    return {
      kind, template_id: "",
      assignee_rule: { kind: "role_relative", role: "gm", anchor: "spawned_store" },
    };
  }
  if (kind === "create_cap") {
    return { kind, due_days: 7 };
  }
  return { kind };
}

export function AutomationEditorModal({
  workspaceId, existing, open, onClose, onSaved,
}: {
  workspaceId: string;
  existing: WorkspaceAutomation | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;

  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("on_submit");
  const [trigger, setTrigger] = useState<Record<string, unknown>>(defaultTrigger("on_submit"));
  const [actionKind, setActionKind] = useState<ActionKind>("notify_in_app");
  const [action, setAction] = useState<Record<string, unknown>>(defaultAction("notify_in_app"));
  const [hasCondition, setHasCondition] = useState(false);
  const [conditionJson, setConditionJson] = useState("");
  const [recipMode, setRecipMode] = useState<RecipientMode>("to_role");

  const [showTriggerJson, setShowTriggerJson] = useState(false);
  const [showActionJson, setShowActionJson] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Templates for the create_assignment + on_submit/on_score_below
  // template_id pickers.
  const tplQuery = useQuery({
    queryKey: ["workspace-templates", workspaceId, false],
    queryFn: () => listTemplates(workspaceId, false),
    enabled: open,
  });
  const templates: WorkspaceTemplate[] =
    (tplQuery.data?.templates ?? []).filter((t) => !t.is_archived);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setIsActive(existing.is_active);
      const tk = String(existing.trigger?.kind ?? "on_submit") as TriggerKind;
      setTriggerKind(TRIGGER_KINDS.some((k) => k.value === tk) ? tk : "on_submit");
      setTrigger(existing.trigger ?? defaultTrigger("on_submit"));
      const ak = String(existing.action?.kind ?? "notify_in_app") as ActionKind;
      setActionKind(ACTION_KINDS.some((k) => k.value === ak) ? ak : "notify_in_app");
      setAction(existing.action ?? defaultAction("notify_in_app"));
      // Recipient mode inference for send_email / notify_in_app
      const a = existing.action ?? {};
      if (Array.isArray((a as Record<string, unknown>).to_emails))  setRecipMode("to_emails");
      else if (Array.isArray((a as Record<string, unknown>).to_user_ids)) setRecipMode("to_user_ids");
      else                                                          setRecipMode("to_role");
      setHasCondition(!!existing.condition);
      setConditionJson(existing.condition ? JSON.stringify(existing.condition, null, 2) : "");
    } else {
      setName("");
      setIsActive(true);
      setTriggerKind("on_submit");
      setTrigger(defaultTrigger("on_submit"));
      setActionKind("notify_in_app");
      setAction(defaultAction("notify_in_app"));
      setRecipMode("to_role");
      setHasCondition(false);
      setConditionJson("");
    }
    setShowTriggerJson(false);
    setShowActionJson(false);
    setError(null);
  }, [open, existing]);

  function changeTriggerKind(k: TriggerKind) {
    setTriggerKind(k);
    setTrigger(defaultTrigger(k));
  }
  function changeActionKind(k: ActionKind) {
    setActionKind(k);
    setAction(defaultAction(k));
    // Reset recipient mode to role for the actions that use one
    setRecipMode("to_role");
  }
  function updateTrigger(patch: Record<string, unknown>) {
    setTrigger((prev) => ({ ...prev, ...patch }));
  }
  function updateAction(patch: Record<string, unknown>) {
    setAction((prev) => ({ ...prev, ...patch }));
  }
  function changeRecipMode(mode: RecipientMode) {
    setRecipMode(mode);
    // Reset recipient fields based on mode
    setAction((prev) => {
      const next = { ...prev };
      delete next.to_role;
      delete next.to_emails;
      delete next.to_user_ids;
      if (mode === "to_role")     next.to_role = "do";
      if (mode === "to_emails")   next.to_emails = [];
      if (mode === "to_user_ids") next.to_user_ids = [];
      return next;
    });
  }

  const saveMut = useMutation({
    mutationFn: () => {
      // Parse the optional condition JSON; surface errors to the user.
      let condition: Record<string, unknown> | undefined = undefined;
      if (hasCondition && conditionJson.trim()) {
        try {
          const parsed = JSON.parse(conditionJson);
          condition = parsed;
        } catch {
          throw new Error("Condition JSON is invalid — fix it before saving.");
        }
      }
      const payload = {
        workspace_id: workspaceId,
        name: name.trim(),
        trigger,
        action,
        condition,
        is_active: isActive,
      };
      if (isEdit) return updateAutomation({ id: existing!.id, ...payload });
      return createAutomation(payload);
    },
    onSuccess: () => { setError(null); onSaved(); },
    onError: (e) => setError((e as Error)?.message ?? "Save failed."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    saveMut.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit automation" : "New automation"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saveMut.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="automation-editor-form"
            disabled={saveMut.isPending || !name.trim()}
          >
            {saveMut.isPending ? "Saving..." : isEdit ? "Save changes" : "Create automation"}
          </Button>
        </div>
      }
    >
      <form id="automation-editor-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="auto-name">Name</Label>
          <Input
            id="auto-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Email DO on critical audit fail"
            required
          />
        </div>

        {/* Trigger */}
        <section className="space-y-3 p-3 rounded border border-gray-200 bg-gray-50/50">
          <div>
            <Label htmlFor="auto-trigger-kind">Trigger</Label>
            <select
              id="auto-trigger-kind"
              value={triggerKind}
              onChange={(e) => changeTriggerKind(e.target.value as TriggerKind)}
              className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
            >
              {TRIGGER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {TRIGGER_KINDS.find((k) => k.value === triggerKind)?.hint}
            </p>
          </div>

          {(triggerKind === "on_submit" || triggerKind === "on_score_below") && (
            <div>
              <Label htmlFor="auto-trigger-tpl">Template (optional — leave blank for all)</Label>
              <select
                id="auto-trigger-tpl"
                value={String(trigger.template_id ?? "")}
                onChange={(e) => updateTrigger({ template_id: e.target.value || undefined })}
                className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
              >
                <option value="">Any template in this workspace</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
                ))}
              </select>
            </div>
          )}

          {triggerKind === "on_score_below" && (
            <div>
              <Label htmlFor="auto-trigger-threshold">Threshold (% — fires when below)</Label>
              <Input
                id="auto-trigger-threshold"
                type="number"
                min={0}
                max={100}
                value={Number(trigger.threshold ?? 80)}
                onChange={(e) => updateTrigger({ threshold: Number(e.target.value) || 0 })}
              />
            </div>
          )}

          {triggerKind === "on_cap_overdue" && (
            <div>
              <Label htmlFor="auto-trigger-grace">Grace hours (delay after due_at)</Label>
              <Input
                id="auto-trigger-grace"
                type="number"
                min={0}
                value={Number(trigger.grace_hours ?? 0)}
                onChange={(e) => updateTrigger({ grace_hours: Number(e.target.value) || 0 })}
              />
            </div>
          )}

          {triggerKind === "on_cap_reopened" && (
            <div>
              <Label htmlFor="auto-trigger-reopens">Minimum reopens (fires at or above)</Label>
              <Input
                id="auto-trigger-reopens"
                type="number"
                min={1}
                value={Number(trigger.min_reopens ?? 1)}
                onChange={(e) => updateTrigger({ min_reopens: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          )}

          {triggerKind === "on_repeat_finding" && (
            <div>
              <Label htmlFor="auto-trigger-occ">Minimum occurrences (fires at or above)</Label>
              <Input
                id="auto-trigger-occ"
                type="number"
                min={2}
                value={Number(trigger.min_occurrences ?? 2)}
                onChange={(e) => updateTrigger({ min_occurrences: Math.max(2, Number(e.target.value) || 2) })}
              />
            </div>
          )}

          {triggerKind === "scheduled" && (
            <div>
              <Label htmlFor="auto-trigger-cron">Cron (5 fields)</Label>
              <Input
                id="auto-trigger-cron"
                value={String(trigger.cron ?? "")}
                onChange={(e) => updateTrigger({ cron: e.target.value })}
                placeholder="0 8 * * 1"
              />
              <p className="text-xs text-gray-500 mt-1">
                Worker runs every 15 min — cron resolution is no finer.
                Example: <code>0 8 * * 1</code> = every Monday 08:00 UTC.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowTriggerJson((v) => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showTriggerJson ? "Hide" : "Show"} raw trigger JSON
          </button>
          {showTriggerJson && (
            <textarea
              value={JSON.stringify(trigger, null, 2)}
              onChange={(e) => {
                try { setTrigger(JSON.parse(e.target.value)); } catch { /* keep typing */ }
              }}
              rows={4}
              className="w-full font-mono text-xs rounded border border-gray-300 bg-white px-2 py-1.5"
            />
          )}
        </section>

        {/* Condition (optional) */}
        <section className="space-y-3 p-3 rounded border border-gray-200 bg-gray-50/50">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={hasCondition}
              onChange={(e) => setHasCondition(e.target.checked)}
              className="rounded"
            />
            Add a condition (filter when the trigger fires)
          </label>
          {hasCondition && (
            <div>
              <Label htmlFor="auto-condition">Condition (JSON)</Label>
              <textarea
                id="auto-condition"
                value={conditionJson}
                onChange={(e) => setConditionJson(e.target.value)}
                rows={5}
                placeholder='e.g. { "kind": "audit_outcome", "value": "fail_critical" }'
                className="w-full font-mono text-xs rounded border border-gray-300 bg-white px-2 py-1.5"
              />
              <p className="text-xs text-gray-500 mt-1">
                Shapes: <code>{`{ "kind": ..., ... }`}</code>, <code>{`{ "all": [{...}, {...}] }`}</code>,
                or <code>{`{ "any": [{...}, {...}] }`}</code>. The worker interprets the tree.
                A proper UI for this is a future polish.
              </p>
            </div>
          )}
        </section>

        {/* Action */}
        <section className="space-y-3 p-3 rounded border border-gray-200 bg-gray-50/50">
          <div>
            <Label htmlFor="auto-action-kind">Action</Label>
            <select
              id="auto-action-kind"
              value={actionKind}
              onChange={(e) => changeActionKind(e.target.value as ActionKind)}
              className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
            >
              {ACTION_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {ACTION_KINDS.find((k) => k.value === actionKind)?.hint}
            </p>
          </div>

          {(actionKind === "send_email" || actionKind === "notify_in_app") && (
            <RecipientPicker
              actionKind={actionKind}
              mode={recipMode}
              setMode={changeRecipMode}
              action={action}
              updateAction={updateAction}
            />
          )}

          {actionKind === "send_email" && (
            <>
              <div>
                <Label htmlFor="auto-email-subject">Subject</Label>
                <Input
                  id="auto-email-subject"
                  value={String(action.subject ?? "")}
                  onChange={(e) => updateAction({ subject: e.target.value })}
                  placeholder="Critical audit failure at store {{store_number}}"
                  required
                />
              </div>
              <div>
                <Label htmlFor="auto-email-body">Body</Label>
                <textarea
                  id="auto-email-body"
                  value={String(action.body ?? "")}
                  onChange={(e) => updateAction({ body: e.target.value })}
                  rows={5}
                  placeholder="A submission triggered this automation. Open the link in Soar Hub to review."
                  required
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Variables like <code>{`{{store_number}}`}</code> are interpolated by the worker when available.
                </p>
              </div>
            </>
          )}

          {actionKind === "notify_in_app" && (
            <div>
              <Label htmlFor="auto-notify-msg">Message</Label>
              <textarea
                id="auto-notify-msg"
                value={String(action.message ?? "")}
                onChange={(e) => updateAction({ message: e.target.value })}
                rows={3}
                placeholder="A critical audit failure needs your attention."
                required
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {actionKind === "create_assignment" && (
            <>
              <div>
                <Label htmlFor="auto-act-tpl">Template to assign</Label>
                <select
                  id="auto-act-tpl"
                  value={String(action.template_id ?? "")}
                  onChange={(e) => updateAction({ template_id: e.target.value })}
                  required
                  className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
                >
                  <option value="">Pick a template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="auto-act-rule">Assignee rule (JSON)</Label>
                <textarea
                  id="auto-act-rule"
                  value={JSON.stringify(action.assignee_rule ?? {}, null, 2)}
                  onChange={(e) => {
                    try { updateAction({ assignee_rule: JSON.parse(e.target.value) }); }
                    catch { /* keep typing */ }
                  }}
                  rows={4}
                  className="w-full font-mono text-xs rounded border border-gray-300 bg-white px-2 py-1.5"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Same shapes as in the Schedules editor: <code>{`{ "kind": "role_relative", "role": "gm", "anchor": "spawned_store" }`}</code>,
                  <code>{`{ "kind": "fixed", "user_id": "<uuid>" }`}</code>, etc.
                </p>
              </div>
            </>
          )}

          {actionKind === "create_cap" && (
            <div>
              <Label htmlFor="auto-cap-due">Due in (days)</Label>
              <Input
                id="auto-cap-due"
                type="number"
                min={1}
                value={Number(action.due_days ?? 7)}
                onChange={(e) => updateAction({ due_days: Math.max(1, Number(e.target.value) || 7) })}
              />
              <p className="text-xs text-gray-500 mt-1">
                Other CAP fields (assignee, instructions) inherit from the trigger context.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowActionJson((v) => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showActionJson ? "Hide" : "Show"} raw action JSON
          </button>
          {showActionJson && (
            <textarea
              value={JSON.stringify(action, null, 2)}
              onChange={(e) => {
                try { setAction(JSON.parse(e.target.value)); } catch { /* keep typing */ }
              }}
              rows={5}
              className="w-full font-mono text-xs rounded border border-gray-300 bg-white px-2 py-1.5"
            />
          )}
        </section>

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

function RecipientPicker({
  actionKind, mode, setMode, action, updateAction,
}: {
  actionKind: ActionKind;
  mode: RecipientMode;
  setMode: (m: RecipientMode) => void;
  action: Record<string, unknown>;
  updateAction: (patch: Record<string, unknown>) => void;
}) {
  // notify_in_app only supports to_role + to_user_ids (no plain emails)
  const modes = actionKind === "notify_in_app"
    ? RECIPIENT_MODES.filter((r) => r.value !== "to_emails")
    : RECIPIENT_MODES;

  return (
    <div className="space-y-2">
      <Label htmlFor="auto-recip-mode">Recipients</Label>
      <select
        id="auto-recip-mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as RecipientMode)}
        className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
      >
        {modes.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>

      {mode === "to_role" && (
        <Input
          value={String(action.to_role ?? "")}
          onChange={(e) => updateAction({ to_role: e.target.value })}
          placeholder="do, rvp, vp..."
          required
        />
      )}

      {mode === "to_emails" && (
        <Input
          value={Array.isArray(action.to_emails) ? (action.to_emails as string[]).join(", ") : ""}
          onChange={(e) =>
            updateAction({
              to_emails: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="user1@example.com, user2@example.com"
          required
        />
      )}

      {mode === "to_user_ids" && (
        <Input
          value={Array.isArray(action.to_user_ids) ? (action.to_user_ids as string[]).join(", ") : ""}
          onChange={(e) =>
            updateAction({
              to_user_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="<uuid>, <uuid>"
          required
        />
      )}
    </div>
  );
}
