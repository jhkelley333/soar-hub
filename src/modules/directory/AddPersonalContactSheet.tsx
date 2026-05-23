// Add / edit a personal contact. Drives the "+ Add" affordance on the
// Directory page's "Mine" tab. Same component handles create and edit:
// pass `editing` to prefill, omit to start blank.
//
// Photo upload is intentionally not here yet — Phase 2 PR adds the
// storage bucket + picker. The form already has a photo_url field
// shape ready for that.

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Camera, X } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Avatar } from "@/shared/ui/Avatar";
import {
  createPersonalContact,
  updatePersonalContact,
  uploadPersonalContactPhoto,
  PHOTO_MIME,
  PHOTO_MAX_BYTES,
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

  // Photo state. `photoUrl` is the already-saved/uploaded URL (or the
  // freshly-uploaded one); `pendingFile` is a locally-picked file not yet
  // uploaded (we upload on save so a cancelled edit leaves no orphan).
  // `localPreview` is an object URL for instant preview of pendingFile.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the sheet opens (or the editing target changes).
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPhone(editing?.phone ?? "");
    setEmail(editing?.email ?? "");
    setCategory(editing?.category ?? "");
    setNotes(editing?.notes ?? "");
    setPhotoUrl(editing?.photo_url ?? null);
    setPendingFile(null);
    setLocalPreview(null);
    setError(null);
  }, [open, editing]);

  // Revoke the object URL when it changes / unmounts to avoid leaks.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!PHOTO_MIME.includes(file.type)) {
      setError("Photo must be JPG, PNG, or WEBP.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError("Photo must be 5 MB or smaller.");
      return;
    }
    setError(null);
    setPendingFile(file);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPendingFile(null);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setPhotoUrl(null);
  }

  const previewUrl = localPreview ?? photoUrl;

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
      // Upload a freshly-picked photo first so its URL goes in with the
      // save. If the user cleared the photo, photoUrl is null and we
      // persist that (removes it from the contact).
      let finalPhotoUrl = photoUrl;
      if (pendingFile) {
        finalPhotoUrl = await uploadPersonalContactPhoto(pendingFile);
      }
      const payload: PersonalContactInput = {
        name: trimmed,
        phone: phone.trim() || null,
        email: email.trim() || null,
        category: category.trim() || null,
        notes: notes.trim() || null,
        photo_url: finalPhotoUrl,
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
        {/* Photo picker */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label="Choose contact photo"
          >
            <Avatar name={name || "?"} photoUrl={previewUrl} size={56} />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white ring-2 ring-white">
              <Camera className="h-3 w-3" strokeWidth={2.25} />
            </span>
          </button>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-[13px] font-medium text-accent hover:underline"
            >
              {previewUrl ? "Change photo" : "Add a photo"}
            </button>
            {previewUrl && (
              <button
                type="button"
                onClick={clearPhoto}
                className="ml-3 inline-flex items-center gap-1 text-[12px] text-midnight-500 hover:text-cherry"
              >
                <X className="h-3 w-3" strokeWidth={2} /> Remove
              </button>
            )}
            <p className="mt-0.5 text-[10.5px] text-midnight-400">
              JPG, PNG, or WEBP · up to 5 MB
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_MIME.join(",")}
            className="hidden"
            onChange={onPickPhoto}
          />
        </div>

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
