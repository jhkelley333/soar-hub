// Shared "new support ticket" modal — used by the board's New button and the
// global Support Ticket launcher in the header. Captures the page the reporter
// is on and lets them attach a screenshot/photo.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Modal } from "@/shared/ui/Modal";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { createHubTicket, uploadHubPhoto } from "./api";
import type { HubKind } from "./types";

export function NewTicketModal({ open, onClose, pagePath }: { open: boolean; onClose: () => void; pagePath: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<HubKind>("issue");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setKind("issue"); setTitle(""); setDescription("");
    setPhotoPath(null); setPreview(null); setUploading(false);
  };
  const close = () => { reset(); onClose(); };

  const onPhoto = async (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.push("Image must be under 10 MB.", "error"); return; }
    setUploading(true);
    setPreview(URL.createObjectURL(file));
    try {
      const path = await uploadHubPhoto(file);
      setPhotoPath(path);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't upload the photo.", "error");
      setPreview(null); setPhotoPath(null);
    } finally {
      setUploading(false);
    }
  };

  const mut = useMutation({
    mutationFn: () => createHubTicket({
      kind, title: title.trim(), description: description.trim(),
      page_path: pagePath || undefined, photo_path: photoPath,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-tickets"] });
      qc.invalidateQueries({ queryKey: ["hub-my-updates"] });
      toast.push("Thanks — your support ticket was submitted.", "success");
      close();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't submit.", "error"),
  });

  if (!open) return null;

  return (
    <Modal open onClose={close} title="New support ticket"
      footer={<>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={() => mut.mutate()} disabled={!title.trim() || uploading || mut.isPending}>
          {mut.isPending ? "Submitting…" : "Submit"}
        </Button>
      </>}>
      <div className="space-y-4">
        <Segmented value={kind} onChange={(v) => setKind(v as HubKind)}
          options={[{ value: "issue", label: "🐞 Issue" }, { value: "idea", label: "💡 Idea" }]} />

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
            placeholder={kind === "idea" ? "What should the Hub do?" : "What went wrong?"} autoFocus />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Details <span className="text-zinc-400">(optional)</span></label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none"
            placeholder="Steps to reproduce, or more about the idea…" />
        </div>

        {/* Photo attachment */}
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Screenshot / photo <span className="text-zinc-400">(optional)</span></label>
          {preview ? (
            <div className="relative inline-block">
              <img src={preview} alt="attachment" className="max-h-40 rounded-lg ring-1 ring-zinc-200" />
              <button type="button" onClick={() => { setPreview(null); setPhotoPath(null); }}
                className="absolute -right-2 -top-2 rounded-full bg-white p-0.5 text-zinc-500 shadow ring-1 ring-zinc-200 hover:text-red-500">
                <X className="h-4 w-4" />
              </button>
              {uploading && <span className="ml-2 text-xs text-zinc-400">Uploading…</span>}
            </div>
          ) : (
            <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 hover:border-accent hover:text-accent", uploading && "opacity-50")}>
              <ImagePlus className="h-4 w-4" /> Add a photo
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => onPhoto(e.target.files?.[0] ?? null)} disabled={uploading} />
            </label>
          )}
        </div>

        {pagePath && (
          <p className="text-[11px] text-zinc-400">
            Reporting from <span className="font-mono text-zinc-500">{pagePath}</span> — we'll include this with your ticket.
          </p>
        )}
      </div>
    </Modal>
  );
}
