// Hand-create an ad-hoc assignment. Pins to the template's currently
// published version (backend enforces). Store is optional — used for
// "submission's store" approver-rule resolution downstream.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { listTemplates, createAssignment } from "./api";
import type { WorkspaceMember } from "./types";

export function CreateAssignmentModal({
  workspaceId, members, open, onClose, onCreated,
}: {
  workspaceId: string;
  members: WorkspaceMember[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tplQuery = useQuery({
    queryKey: ["workspace-templates", workspaceId, false],
    queryFn: () => listTemplates(workspaceId, false),
    enabled: open,
  });

  const templates = (tplQuery.data?.templates ?? []).filter((t) => !t.is_archived);

  function reset() {
    setTemplateId(""); setAssigneeId(""); setStoreId(""); setDueAt("");
    setError(null); setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId || !assigneeId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAssignment({
        workspace_id: workspaceId,
        template_id: templateId,
        assignee_id: assigneeId,
        store_id: storeId.trim() || undefined,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      reset();
      onCreated();
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to create assignment.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Assign work"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-asn-form"
            disabled={submitting || !templateId || !assigneeId}
          >
            {submitting ? "Assigning..." : "Assign"}
          </Button>
        </div>
      }
    >
      <form id="create-asn-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="asn-template">Template</Label>
          <select
            id="asn-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
            disabled={tplQuery.isLoading}
            className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
          >
            <option value="">{tplQuery.isLoading ? "Loading…" : "Pick a template"}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.type})
              </option>
            ))}
          </select>
          {templates.length === 0 && !tplQuery.isLoading && (
            <p className="text-xs text-amber-700 mt-1">
              No published templates yet. Create one and publish a version first.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="asn-assignee">Assignee</Label>
          <select
            id="asn-assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            required
            className="w-full text-sm rounded border border-gray-300 bg-white px-2 py-2"
          >
            <option value="">Pick a workspace member</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profiles?.full_name || m.profiles?.email || m.user_id}
                {" — "}
                {m.workspace_role}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Only current workspace members are pickable. Add the user under
            Members first if they're not in the list.
          </p>
        </div>

        <div>
          <Label htmlFor="asn-due">Due (optional)</Label>
          <Input
            id="asn-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="asn-store">Store ID (optional, uuid)</Label>
          <Input
            id="asn-store"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <p className="text-xs text-gray-500 mt-1">
            Used when sign-off rules need "the submission's store" — e.g. DO
            sign-off where the DO is the one over this specific store.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
