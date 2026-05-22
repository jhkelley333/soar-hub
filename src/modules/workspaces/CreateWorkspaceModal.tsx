// Create a new workspace. Caller becomes the owner automatically.
// Anchor (region/area/district/store) is omitted in v1 — user can
// edit later if they want scope-based access. Keeps the form short.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { createWorkspace } from "./api";
import type { Workspace } from "./types";

const VISIBILITY_OPTIONS: Array<{
  value: Workspace["visibility"];
  label: string;
  hint: string;
}> = [
  {
    value: "private",
    label: "Private",
    hint: "Only members you explicitly add can see it.",
  },
  {
    value: "scoped",
    label: "Scoped (recommended)",
    hint: "Visible to members + anyone in the org-chart whose scope covers the anchor (set later in workspace settings).",
  },
  {
    value: "organization",
    label: "Organization-wide",
    hint: "Visible to every active user.",
  },
];

export function CreateWorkspaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Workspace["visibility"]>("scoped");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setVisibility("scoped");
    setError(null);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createWorkspace({
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
      });
      reset();
      onCreated();
      navigate(`/workspaces/${res.workspace.id}`);
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to create workspace.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="New workspace"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-ws-form"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating..." : "Create workspace"}
          </Button>
        </div>
      }
    >
      <form id="create-ws-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="ws-name">Name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily Open Checklist"
            required
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="ws-desc">Description (optional)</Label>
          <textarea
            id="ws-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this workspace is for, who should fill it out, etc."
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <Label>Visibility</Label>
          <div className="space-y-2 mt-1">
            {VISIBILITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-2 p-2 rounded border border-gray-200 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="visibility"
                  value={opt.value}
                  checked={visibility === opt.value}
                  onChange={() => setVisibility(opt.value)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
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
