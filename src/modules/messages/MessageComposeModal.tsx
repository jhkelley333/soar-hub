// Compose a store message — GM and above. Title + body, an audience picker
// (which store positions can see it, default leaders + GM), optional
// attachments, and a pin toggle. Posts to the author's scope server-side.
import { useState } from "react";
import { Loader2, X, Paperclip, Pin } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { createMessage, fileToBase64 } from "./api";

// The store positions a message can be addressed to, ordered seniority-first.
const AUDIENCE_OPTIONS: UserRole[] = [
  "gm", "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop",
];
const DEFAULT_AUDIENCE: UserRole[] = ["crew_leader", "associate_manager", "first_assistant_manager", "shift_manager", "gm"];
const MAX_FILES = 8;

export function MessageComposeModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Set<UserRole>>(new Set(DEFAULT_AUDIENCE));
  const [files, setFiles] = useState<File[]>([]);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (r: UserRole) =>
    setAudience((prev) => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n; });

  async function post() {
    if (!title.trim()) { setErr("Add a title."); return; }
    if (audience.size === 0) { setErr("Pick at least one position to address."); return; }
    setBusy(true);
    setErr(null);
    try {
      const attachments = await Promise.all(
        files.slice(0, MAX_FILES).map(async (f) => ({ data: await fileToBase64(f), name: f.name, type: f.type || "application/octet-stream" })),
      );
      await createMessage({
        title: title.trim(),
        body: body.trim(),
        audienceRoles: [...audience],
        attachments,
        isPinned: pinned,
      });
      onPosted();
    } catch (e) {
      setErr((e as Error)?.message || "Couldn't post the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">New message</div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="msg-title">Title *</Label>
            <Input id="msg-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New fryer procedure" />
          </div>
          <div>
            <Label htmlFor="msg-body">Message</Label>
            <textarea
              id="msg-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Write your announcement…"
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <Label>Who should see this?</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AUDIENCE_OPTIONS.map((r) => {
                const on = audience.has(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggle(r)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-accent bg-accent/10 text-accent" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">Posts to your store(s). Defaults to hourly leaders and up — add crew/carhop if needed.</div>
          </div>

          <div>
            <Label htmlFor="msg-files">Attachments (optional)</Label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
              <Paperclip className="h-3.5 w-3.5" /> Add files
              <input
                id="msg-files"
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files || [])].slice(0, MAX_FILES)); e.target.value = ""; }}
              />
            </label>
            {files.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate font-mono">{f.name}</span>
                    <span>({(f.size / 1024).toFixed(0)} KB)</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-red-600 hover:underline">remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <Pin className="h-3.5 w-3.5" /> Pin to the top
          </label>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={post} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Post
          </Button>
        </div>
      </div>
    </div>
  );
}
