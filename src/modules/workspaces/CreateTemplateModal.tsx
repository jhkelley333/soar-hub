// Create a new template. Audit type gets two extra knobs:
// audit_pass_threshold (0-100%) and critical_fails_audit (default on).
// Backend auto-spawns v1 as a draft; user lands on the editor.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { createTemplate } from "./api";
import type { TemplateType } from "./types";

export function CreateTemplateModal({
  workspaceId, open, onClose, onCreated,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TemplateType>("form");
  const [passThreshold, setPassThreshold] = useState("80");
  const [criticalFails, setCriticalFails] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(""); setDescription(""); setType("form");
    setPassThreshold("80"); setCriticalFails(true);
    setError(null); setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createTemplate({
        workspace_id: workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        ...(type === "audit" && {
          audit_pass_threshold: Number(passThreshold) || undefined,
          critical_fails_audit: criticalFails,
        }),
      });
      reset();
      onCreated();
      navigate(`/workspaces/${workspaceId}/templates/${res.template.id}`);
    } catch (err) {
      setError((err as Error)?.message ?? "Failed.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="New template"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="create-tpl-form" disabled={submitting || !name.trim()}>
            {submitting ? "Creating..." : "Create + open editor"}
          </Button>
        </div>
      }
    >
      <form id="create-tpl-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="tpl-name">Name</Label>
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily Open Checklist"
            required
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="tpl-desc">Description (optional)</Label>
          <textarea
            id="tpl-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <Label>Type</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <label className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${type === "form" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-gray-700"}`}>
              <input type="radio" name="type" value="form" checked={type === "form"} onChange={() => setType("form")} className="mt-1" />
              <div>
                <div className="font-medium text-sm">Form</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Information capture. No scoring.
                </div>
              </div>
            </label>
            <label className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${type === "audit" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-gray-700"}`}>
              <input type="radio" name="type" value="audit" checked={type === "audit"} onChange={() => setType("audit")} className="mt-1" />
              <div>
                <div className="font-medium text-sm">Audit</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Pass/fail/NA questions, weighted scoring, auto-CAPs on fail.
                </div>
              </div>
            </label>
          </div>
        </div>

        {type === "audit" && (
          <div className="space-y-3 p-3 rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10">
            <div>
              <Label htmlFor="audit-thresh">Pass threshold (% of weighted points)</Label>
              <Input
                id="audit-thresh"
                type="number"
                min={0}
                max={100}
                value={passThreshold}
                onChange={(e) => setPassThreshold(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Submissions scoring at or above this percent pass; below this, fail.
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={criticalFails}
                onChange={(e) => setCriticalFails(e.target.checked)}
                className="mt-1 rounded"
              />
              <div>
                <div className="text-sm font-medium">Any critical-question failure fails the whole audit</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  When on, a single fail on a critical question = audit_outcome: fail_critical,
                  regardless of percent score.
                </div>
              </div>
            </label>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
