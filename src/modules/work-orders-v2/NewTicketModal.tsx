// New Ticket modal. Opens from the Work Orders V2 page header. Loads
// the issue library lazily for the typeahead and lets the admin
// optionally attach photos that get uploaded immediately after the
// ticket row is created.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import {
  createTicket,
  fetchIssueLibrary,
  fileToBase64,
  uploadPhoto,
} from "./api";
import {
  TICKET_PRIORITIES,
  type CreateTicketBody,
  type IssueLibraryItem,
  type TicketPriority,
} from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (woNumber: string) => void;
  onError: (msg: string) => void;
}

const MAX_PHOTOS = 5;

export function NewTicketModal({ open, onClose, onCreated, onError }: Props) {
  const issueLibrary = useQuery({
    queryKey: ["wo2", "issueLibrary"],
    queryFn: fetchIssueLibrary,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Form state.
  const [storeNumber, setStoreNumber] = useState("");
  const [issueText, setIssueText] = useState("");
  const [category, setCategory] = useState("");
  const [assetType, setAssetType] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("Standard");
  const [businessCritical, setBusinessCritical] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [costEstimate, setCostEstimate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open/close so a re-open starts clean.
  useEffect(() => {
    if (!open) return;
    setStoreNumber("");
    setIssueText("");
    setCategory("");
    setAssetType("");
    setModelNumber("");
    setDescription("");
    setPriority("Standard");
    setBusinessCritical(false);
    setVendorName("");
    setCostEstimate("");
    setFiles([]);
  }, [open]);

  // Filter issue library by current typeahead text.
  const suggestions = useMemo(() => {
    const items = issueLibrary.data?.items ?? [];
    const q = issueText.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) =>
        i.display_name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.asset_type.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [issueText, issueLibrary.data]);

  function pickIssue(item: IssueLibraryItem) {
    setIssueText(item.display_name);
    setCategory(item.category);
    setAssetType(item.display_name);
  }

  function handleFiles(input: HTMLInputElement) {
    const arr = Array.from(input.files ?? []).slice(0, MAX_PHOTOS);
    setFiles(arr);
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!storeNumber.trim()) throw new Error("Store number is required.");
      if (!description.trim()) throw new Error("Issue description is required.");
      const body: CreateTicketBody = {
        storeNumber: storeNumber.trim(),
        category: category || undefined,
        assetType: assetType || issueText || undefined,
        modelNumber: modelNumber || undefined,
        issueDescription: description.trim(),
        priority,
        isBusinessCritical: businessCritical,
        vendorContacted: !!vendorName.trim(),
        vendorName: vendorName || undefined,
        costEstimate: costEstimate ? Number(costEstimate) : null,
      };
      const created = await createTicket(body);
      // Upload any attached photos sequentially so failures are obvious.
      for (const f of files) {
        const photoData = await fileToBase64(f);
        await uploadPhoto({
          id: created.ticket.id,
          photoData,
          photoType: f.type || "image/jpeg",
          photoName: f.name,
          uploadType: "submission",
        });
      }
      return created;
    },
    onSuccess: (data) => {
      onCreated(data.woNumber);
    },
    onError: (e: unknown) => {
      onError(e instanceof Error ? e.message : "Failed to create ticket.");
    },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            New Service Request
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="nt-store">Store Number *</Label>
              <Input
                id="nt-store"
                value={storeNumber}
                onChange={(e) => setStoreNumber(e.target.value)}
                placeholder="e.g. 1082"
              />
            </div>
            <div>
              <Label htmlFor="nt-priority">Priority</Label>
              <select
                id="nt-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {TICKET_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="relative">
            <Label htmlFor="nt-issue">Issue / Asset Type *</Label>
            <Input
              id="nt-issue"
              value={issueText}
              onChange={(e) => {
                setIssueText(e.target.value);
                setAssetType(e.target.value);
              }}
              placeholder="Start typing — e.g. fryer, roof, HVAC…"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-md">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => pickIssue(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        {s.category} · {s.asset_type}
                      </div>
                      <div className="text-midnight">{s.display_name}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {category && (
              <div className="mt-1 text-[11px] text-zinc-500">
                Selected: <span className="font-medium text-zinc-700">{category}</span> · {assetType}
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="nt-model">Model Number</Label>
            <Input
              id="nt-model"
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
              placeholder="If known"
            />
          </div>

          <div>
            <Label htmlFor="nt-desc">Issue Description *</Label>
            <textarea
              id="nt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the issue in detail…"
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="nt-vendor">Vendor Name</Label>
              <Input
                id="nt-vendor"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label htmlFor="nt-cost">Cost Estimate ($)</Label>
              <Input
                id="nt-cost"
                value={costEstimate}
                onChange={(e) => setCostEstimate(e.target.value)}
                placeholder="0.00"
                type="number"
                step="0.01"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-midnight">
            <input
              type="checkbox"
              checked={businessCritical}
              onChange={(e) => setBusinessCritical(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Business Critical
          </label>

          <div>
            <Label htmlFor="nt-photos">Photos (up to {MAX_PHOTOS})</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-zinc-200 bg-white py-3 text-sm text-zinc-600 transition hover:border-accent hover:bg-accent/5 hover:text-midnight"
            >
              <Upload className="h-4 w-4" strokeWidth={1.75} />
              {files.length === 0
                ? "Tap to add photos"
                : `${files.length} file${files.length === 1 ? "" : "s"} selected`}
            </button>
            <input
              ref={fileInputRef}
              id="nt-photos"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target)}
            />
            {files.length > 0 && (
              <div className="mt-2 text-[11px] text-zinc-500">
                {files.map((f) => f.name).join(", ")}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
          >
            {submit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {submit.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </div>
      </div>
    </div>
  );
}
