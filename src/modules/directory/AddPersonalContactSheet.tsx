// Add / edit a personal contact. Drives the "+ Add" affordance on the
// Directory page's "Mine" tab. Same component handles create and edit:
// pass `editing` to prefill, omit to start blank.
//
// Photo upload is intentionally not here yet — Phase 2 PR adds the
// storage bucket + picker. The form already has a photo_url field
// shape ready for that.

import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import {
  createPersonalContact,
  updatePersonalContact,
  type PersonalContact,
  type PersonalContactInput,
} from "./personalContactsApi";

// Common categories surfaced as quick-pick chips. Free text still works.
const SUGGESTED_CATEGORIES = [
  "Vendor",
  "Contractor",
  "Corporate",
  "Friend",
  "Personal",
];

export function AddPersonalContactSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: PersonalContact | null;
  onClose: () => void;
  onSaved: (saved: PersonalContact) => void;
}) {
  const isEdit = !!editing;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the sheet opens (or the editing target changes).
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPhone(editing?.phone ?? "");
    setEmail(editing?.email ?? "");
    setCategory(editing?.category ?? "");
    setNotes(editing?.notes ?? "");
    setError(null);
  }, [open, editing]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: PersonalContactInput = {
        name: trimmed,
        phone: phone.trim() || null,
        email: email.trim() || null,
        category: category.trim() || null,
        notes: notes.trim() || null,
      };
      const res = isEdit
        ? await updatePersonalContact(editing!.id, payload)
        : await createPersonalContact(payload);
      onSaved(res.contact);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit contact" : "New contact"}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="personal-contact-form"
            disabled={saving}
          >
            {saving ? "Saving…" : isEdit ? "Save" : "Add contact"}
          </Button>
        </div>
      }
    >
      <form id="personal-contact-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="pc-name">Name *</Label>
          <Input
            id="pc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            autoFocus
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pc-phone">Phone</Label>
            <Input
              id="pc-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-1234"
            />
          </div>
          <div>
            <Label htmlFor="pc-email">Email</Label>
            <Input
              id="pc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="pc-category">Category</Label>
          <Input
            id="pc-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Vendor, Contractor, Friend…"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTED_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="text-[11px] rounded-full px-2.5 py-1 bg-midnight-50 text-midnight-700 ring-1 ring-midnight-100 hover:bg-midnight-100 transition"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="pc-notes">Notes</Label>
          <textarea
            id="pc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to remember about them."
            rows={3}
            className="w-full rounded-md border border-midnight-200 bg-white px-3 py-2 text-sm text-midnight-900 placeholder:text-midnight-400 focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {error && (
          <div className="rounded-md bg-cherry/10 px-3 py-2 text-[12px] text-cherry">
            {error}
          </div>
        )}

        <p className="text-[11px] text-midnight-500">
          Personal contacts are private to you — no one else can see them.
        </p>
      </form>
    </Modal>
  );
}
