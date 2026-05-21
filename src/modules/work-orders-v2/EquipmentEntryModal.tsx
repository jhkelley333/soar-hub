// Add / edit a manual equipment-register entry. Used by the
// Replacements view in two places:
//   * WO2 admin Replacements tab — caller picks any store they have
//     access to from the store dropdown
//   * My Stores store-detail Replacements section — store is locked
//     to the page's store (storeIdLock + storeNumberLock props set)
//
// Form mirrors the Order Replacement modal's fields minus the
// transition / receipt-upload bits — manual entries don't move a
// ticket. Receipt upload happens here directly via the same
// uploadPhoto endpoint, but with a synthetic ticket_id = null path...
// actually no, ticket_photos requires a ticket_id, so we punt and
// have the user paste a URL for v1. Most receipts already live in
// Drive / cloud storage anyway.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import {
  fetchCallerStores,
  saveEquipment,
  uploadEquipmentReceipt,
  type ReplacementRow,
  type SaveEquipmentBody,
} from "./api";

// Same helper used elsewhere — reads a File as base64 (without the
// data: prefix) so it can ride along on JSON bodies.
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

interface Props {
  open: boolean;
  onClose: () => void;
  // When editing an existing entry, the parent passes the current
  // row. We seed the form from it. `equipment_id` must be set on the
  // row for save to update vs insert.
  existing?: ReplacementRow | null;
  // When the entry point already knows the store (e.g. embed on a
  // single-store My Stores page), lock the modal to it and hide the
  // picker. Both must be supplied together.
  storeIdLock?: string | null;
  storeNumberLock?: string | null;
}

export function EquipmentEntryModal({
  open, onClose, existing, storeIdLock, storeNumberLock,
}: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  const isEdit = !!existing?.equipment_id;
  const [storeId, setStoreId] = useState<string>("");
  const [source, setSource] = useState<"manual_legacy" | "manual_direct">("manual_direct");
  const [assetTag, setAssetTag] = useState("");
  const [model, setModel] = useState("");
  const [supplier, setSupplier] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [cost, setCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [warrLabor, setWarrLabor] = useState("");
  const [warrParts, setWarrParts] = useState("");
  const [warrSource, setWarrSource] = useState<"" | "vendor" | "manufacturer" | "none">("");
  // Receipt is a real file upload (PDF or image). Existing URL is
  // shown as a "current receipt" link with a Replace affordance;
  // picking a file marks it for upload after save.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Caller's accessible stores for the dropdown — only fetched when
  // there's no lock (i.e. the modal renders the picker).
  const storesQ = useQuery({
    queryKey: ["wo2", "callerStores"],
    queryFn: fetchCallerStores,
    enabled: open && !storeIdLock,
    staleTime: 5 * 60_000,
  });
  const stores = useMemo(
    () => storesQ.data?.stores ?? [],
    [storesQ.data],
  );

  // Seed / reset the form whenever the modal opens or the existing
  // row changes. Locked store wins over any existing.store mismatch.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (existing) {
      setSource((existing.source === "manual_legacy" ? "manual_legacy" : "manual_direct"));
      setAssetTag(existing.asset_tag || "");
      setModel(existing.model || "");
      setSupplier(existing.supplier || "");
      setPoNumber(existing.po_number || "");
      setCost(existing.cost == null ? "" : String(existing.cost));
      setPurchasedAt(existing.purchased_at || "");
      setInstalledAt(existing.installed_at || "");
      setWarrLabor(existing.warranty_labor_days == null ? "" : String(existing.warranty_labor_days));
      setWarrParts(existing.warranty_parts_days == null ? "" : String(existing.warranty_parts_days));
      setWarrSource(existing.warranty_parts_source || "");
      setExistingReceiptUrl(existing.receipt_url || null);
      setReceiptFile(null);
      setNotes(existing.notes || "");
    } else {
      setSource("manual_direct");
      setAssetTag("");
      setModel("");
      setSupplier("");
      setPoNumber("");
      setCost("");
      setPurchasedAt("");
      setInstalledAt("");
      setWarrLabor("");
      setWarrParts("");
      setWarrSource("");
      setExistingReceiptUrl(null);
      setReceiptFile(null);
      setNotes("");
    }
    if (storeIdLock) {
      setStoreId(storeIdLock);
    } else if (!existing) {
      setStoreId("");
    }
    // For an EDIT with no lock, resolve store_id from existing row.
    // The row only carries store_number; look it up from the caller's
    // stores once that query resolves (handled in a separate effect).
  }, [open, existing, storeIdLock]);

  // Edit path: resolve store_id from store_number once the caller's
  // store list has loaded. Only runs if we don't already have a
  // store_id set (avoids overriding the lock).
  useEffect(() => {
    if (!isEdit || storeIdLock || storeId) return;
    if (!existing?.store_number || stores.length === 0) return;
    const match = stores.find((s) => s.number === existing.store_number);
    if (match) setStoreId(match.id);
  }, [isEdit, storeIdLock, storeId, existing, stores]);

  const mut = useMutation({
    mutationFn: () => {
      const payload: SaveEquipmentBody = {
        store_id: storeId,
        source,
        model: model.trim(),
      };
      if (existing?.equipment_id) payload.id = existing.equipment_id;
      if (assetTag.trim()) payload.asset_tag = assetTag.trim();
      if (supplier.trim()) payload.supplier = supplier.trim();
      if (poNumber.trim()) payload.po_number = poNumber.trim();
      if (cost.trim()) {
        const n = Number(cost);
        if (Number.isFinite(n)) payload.cost = n;
      }
      if (purchasedAt) payload.purchased_at = purchasedAt;
      if (installedAt) payload.installed_at = installedAt;
      if (warrLabor.trim()) {
        const n = Number(warrLabor);
        if (Number.isFinite(n)) payload.warranty_labor_days = Math.round(n);
      }
      if (warrParts.trim()) {
        const n = Number(warrParts);
        if (Number.isFinite(n)) payload.warranty_parts_days = Math.round(n);
      }
      if (warrSource) payload.warranty_parts_source = warrSource;
      if (notes.trim()) payload.notes = notes.trim();
      return saveEquipment(payload);
    },
    onSuccess: async (res) => {
      const id = (res as { equipment?: { id?: string } }).equipment?.id || existing?.equipment_id;
      // Best-effort receipt upload. Failure surfaces a toast but
      // does NOT roll back the save — the row is in; the user can
      // re-attach via the edit modal.
      if (id && receiptFile) {
        try {
          const base64 = await fileToBase64(receiptFile);
          await uploadEquipmentReceipt({
            id,
            fileData: base64,
            fileName: receiptFile.name,
            fileType: receiptFile.type || "application/octet-stream",
          });
        } catch (upErr) {
          toast.push(
            "Equipment saved but receipt upload failed. Edit the row to retry.",
            "error",
          );
          console.error("equipment receipt upload failed:", upErr);
        }
      }
      toast.push(isEdit ? "Equipment updated." : "Equipment added.", "success");
      qc.invalidateQueries({ queryKey: ["wo2", "replacements"] });
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Save failed.");
    },
  });

  if (!open) return null;

  const canSubmit = !!storeId && model.trim().length > 0 && !mut.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !mut.isPending) onClose(); }}
    >
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            {isEdit ? "Edit equipment" : "Add equipment"}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
            Use this for legacy purchases that predate SOAR Hub or new equipment
            bought outside the work-order flow. To order replacement equipment
            for an active ticket, use the <strong>Order Replacement</strong>
            action on the ticket instead.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eq-store">Store *</Label>
              {storeIdLock ? (
                <div className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-midnight">
                  {storeNumberLock ? `#${storeNumberLock}` : "—"}
                </div>
              ) : (
                <select
                  id="eq-store"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  disabled={storesQ.isLoading}
                  className="block h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">{storesQ.isLoading ? "Loading…" : "Pick a store"}</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.number}{s.name ? ` · ${s.name}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <Label htmlFor="eq-source">Source *</Label>
              <select
                id="eq-source"
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                className="block h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="manual_legacy">Legacy (predates SOAR)</option>
                <option value="manual_direct">Direct purchase (outside work order flow)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eq-asset-tag">Asset tag / serial #</Label>
              <Input
                id="eq-asset-tag"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                placeholder="From the spec plate or sticker"
              />
            </div>
            <div>
              <Label htmlFor="eq-model">Model / SKU *</Label>
              <Input
                id="eq-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. Frymaster FPP255"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eq-supplier">Supplier</Label>
              <Input
                id="eq-supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Who you bought it from"
              />
            </div>
            <div>
              <Label htmlFor="eq-po">PO / order #</Label>
              <Input
                id="eq-po"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="eq-cost">Cost</Label>
              <Input
                id="eq-cost"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="eq-purchased">Purchased</Label>
              <Input
                id="eq-purchased"
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="eq-installed">Installed</Label>
              <Input
                id="eq-installed"
                type="date"
                value={installedAt}
                onChange={(e) => setInstalledAt(e.target.value)}
              />
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Warranty
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="eq-warr-labor">Labor (days)</Label>
                <Input
                  id="eq-warr-labor"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={warrLabor}
                  onChange={(e) => setWarrLabor(e.target.value)}
                  placeholder="90"
                />
              </div>
              <div>
                <Label htmlFor="eq-warr-parts">Parts (days)</Label>
                <Input
                  id="eq-warr-parts"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={warrParts}
                  onChange={(e) => setWarrParts(e.target.value)}
                  placeholder="365"
                />
              </div>
              <div>
                <Label htmlFor="eq-warr-source">Parts via</Label>
                <select
                  id="eq-warr-source"
                  value={warrSource}
                  onChange={(e) => setWarrSource(e.target.value as typeof warrSource)}
                  className="block h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">—</option>
                  <option value="vendor">Vendor</option>
                  <option value="manufacturer">Manufacturer</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="eq-receipt">Receipt / invoice (optional)</Label>
            {existingReceiptUrl && !receiptFile && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs">
                <FileText className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
                <a
                  href={existingReceiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent hover:underline"
                >
                  Current receipt
                </a>
                <span className="text-zinc-500">— attach a new file below to replace.</span>
              </div>
            )}
            <input
              id="eq-receipt"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f && f.size > MAX_RECEIPT_BYTES) {
                  setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB); cap is 10 MB.`);
                  e.target.value = "";
                  return;
                }
                setError(null);
                setReceiptFile(f);
              }}
              className="block w-full text-sm text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-midnight hover:file:bg-accent/20"
            />
            {receiptFile && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="truncate font-mono">{receiptFile.name}</span>
                <span>({(receiptFile.size / 1024).toFixed(0)} KB)</span>
                <button
                  type="button"
                  onClick={() => setReceiptFile(null)}
                  className="text-red-600 hover:underline"
                >
                  remove
                </button>
              </div>
            )}
            <div className="mt-1 text-[10px] text-zinc-500">
              PDF or image, up to 10 MB. Uploaded after the save; replaces any existing receipt on this row.
            </div>
          </div>

          <div>
            <Label htmlFor="eq-notes">Notes</Label>
            <textarea
              id="eq-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything else worth recording about this purchase."
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mut.mutate()}
            disabled={!canSubmit}
          >
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save changes" : "Add equipment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
