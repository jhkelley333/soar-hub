// Generic modal for collecting the payload a status transition needs:
// a reason code (always required), optional free-text note, optional
// extra fields like resolution_category or vendor_name.
//
// Designed to be config-driven so the action bar can spawn it for any
// transition without bespoke modals per state pair.

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { VendorSearchInput } from "./VendorSearchInput";
import type {
  AdminCloseReason,
  ResolutionCategory,
  ReopenReason,
  StoreCloseReason,
  TransitionPayload,
} from "./types";

const STORE_CLOSE_OPTIONS: { value: StoreCloseReason; label: string }[] = [
  { value: "user_error",          label: "User error — wasn't actually broken" },
  { value: "resolved_internally", label: "Resolved internally (in-house fix)" },
  { value: "duplicate",           label: "Duplicate of another ticket" },
  { value: "no_longer_needed",    label: "No longer needed" },
];

const ADMIN_CLOSE_OPTIONS: { value: AdminCloseReason; label: string }[] = [
  { value: "completed_and_verified",     label: "Completed and verified" },
  { value: "auto_closed_no_verification", label: "Auto-closed — no store verification" },
  { value: "cancelled_by_ops",           label: "Cancelled by operations" },
  { value: "equipment_replaced",         label: "Equipment replaced" },
  { value: "written_off",                label: "Written off" },
  { value: "deferred_to_capex",          label: "Deferred to capex" },
];

const RESOLUTION_OPTIONS: { value: ResolutionCategory; label: string }[] = [
  { value: "repaired",        label: "Repaired" },
  { value: "replaced",        label: "Replaced" },
  { value: "no_issue_found",  label: "No issue found" },
  { value: "deferred",        label: "Deferred" },
];

const REOPEN_OPTIONS: { value: ReopenReason; label: string }[] = [
  { value: "not_fixed",        label: "Not actually fixed" },
  { value: "recurred",         label: "Same issue recurred" },
  { value: "wrong_diagnosis",  label: "Wrong diagnosis — different issue" },
  { value: "other",            label: "Other (please describe below)" },
];

// Sub-reasons for a submitter-initiated cancellation. Stored in
// admin_close_notes; admin_close_reason is always
// 'cancelled_by_submitter' for this path.
const SUBMITTER_CANCEL_OPTIONS: { value: string; label: string }[] = [
  { value: "false_alarm",   label: "False alarm / not actually broken" },
  { value: "fixed_self",    label: "Fixed itself / store handled it" },
  { value: "duplicate",     label: "Duplicate — another ticket already covers this" },
  { value: "wrong_store",   label: "Submitted on the wrong store" },
  { value: "other",         label: "Other (please describe below)" },
];

export type ReasonModalConfig =
  | {
      kind: "store_close";
      title?: string;
      submitLabel?: string;
    }
  | {
      kind: "admin_close";
      title?: string;
      submitLabel?: string;
      requireResolutionCategory?: boolean;
    }
  | {
      kind: "cancellation";
      title?: string;
      submitLabel?: string;
    }
  | {
      // Submitter (GM/shift) cancelling their own ticket before any
      // vendor work has begun. Sub-reason captured in admin_close_notes
      // so we keep a single column shape but distinguish meaningfully.
      kind: "submitter_cancellation";
      title?: string;
      submitLabel?: string;
    }
  | {
      kind: "reopen";
      title?: string;
      submitLabel?: string;
    }
  | {
      kind: "resolution_only";
      title?: string;
      submitLabel?: string;
      optional?: boolean;
    }
  | {
      kind: "vendor_schedule";
      title?: string;
      submitLabel?: string;
    }
  | {
      // Order replacement equipment. Transitions the ticket to
      // awaiting_equipment and stamps the replacement_* columns.
      kind: "order_replacement";
      title?: string;
      submitLabel?: string;
    }
  | {
      // Order a repair part. Transitions the ticket to parts_on_order
      // and stamps the parts_* columns. Parallel to order_replacement.
      kind: "order_parts";
      title?: string;
      submitLabel?: string;
    };

// A file the modal collected but doesn't upload itself. Order
// Replacement attaches one (the receipt/invoice); the action bar
// uploads it after the transition succeeds. Keeps the modal focused
// on data capture rather than file orchestration.
export interface PendingAttachment {
  file: File;
  uploadType: string;
}

interface Props {
  open: boolean;
  config: ReasonModalConfig;
  // Optional. When provided and the modal config is vendor_schedule,
  // the vendor field renders as a searchable, store-scoped typeahead
  // instead of a free-text input. Falls back to plain text if absent.
  storeNumber?: string;
  onClose: () => void;
  onSubmit: (payload: TransitionPayload, attachments?: PendingAttachment[]) => Promise<void> | void;
  submitting?: boolean;
  error?: string | null;
}

export function ReasonModal({ open, config, storeNumber, onClose, onSubmit, submitting, error }: Props) {
  const [reason, setReason] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [resolution, setResolution] = useState<ResolutionCategory | "">("");
  const [vendorName, setVendorName] = useState<string>("");
  const [vendorId, setVendorId] = useState<string | null>(null);
  // Replacement-equipment fields. Only meaningful for the
  // order_replacement modal kind. Most are optional — the team fills
  // in what's known at order time; the rest can be set later via the
  // Update Ticket panel as the equipment arrives + gets installed.
  const [replManufacturer, setReplManufacturer] = useState<string>("");
  const [replModel, setReplModel] = useState<string>("");
  const [replSupplier, setReplSupplier] = useState<string>("");
  const [replCost, setReplCost] = useState<string>("");
  const [replEta, setReplEta] = useState<string>("");
  const [replAssetTag, setReplAssetTag] = useState<string>("");
  const [replPoNumber, setReplPoNumber] = useState<string>("");
  const [replWarrLabor, setReplWarrLabor] = useState<string>("");
  const [replWarrParts, setReplWarrParts] = useState<string>("");
  const [replWarrSource, setReplWarrSource] = useState<"" | "vendor" | "manufacturer" | "none">("");
  const [replReceipt, setReplReceipt] = useState<File | null>(null);
  const [replWarrantyDoc, setReplWarrantyDoc] = useState<File | null>(null);
  // Parts-on-order fields. Only meaningful for the order_parts modal
  // kind. Description, cost, ETA required; supplier + PO optional.
  const [partsDesc, setPartsDesc] = useState<string>("");
  const [partsSupplier, setPartsSupplier] = useState<string>("");
  const [partsCost, setPartsCost] = useState<string>("");
  const [partsEta, setPartsEta] = useState<string>("");
  const [partsPoNumber, setPartsPoNumber] = useState<string>("");
  const [partsReceipt, setPartsReceipt] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setText("");
    setResolution("");
    setVendorName("");
    setVendorId(null);
    setReplManufacturer("");
    setReplModel("");
    setReplSupplier("");
    setReplCost("");
    setReplEta("");
    setReplAssetTag("");
    setReplPoNumber("");
    setReplWarrLabor("");
    setReplWarrParts("");
    setReplWarrSource("");
    setReplReceipt(null);
    setReplWarrantyDoc(null);
    setPartsDesc("");
    setPartsSupplier("");
    setPartsCost("");
    setPartsEta("");
    setPartsPoNumber("");
    setPartsReceipt(null);
  }, [open, config.kind]);

  const title = useMemo(() => config.title || defaultTitle(config.kind), [config]);
  const submitLabel = useMemo(
    () => config.submitLabel || defaultSubmit(config.kind),
    [config],
  );

  if (!open) return null;

  function buildPayload(): TransitionPayload | null {
    switch (config.kind) {
      case "store_close":
        if (!reason) return null;
        return { store_close_reason: reason as StoreCloseReason };
      case "admin_close": {
        if (!reason) return null;
        const payload: TransitionPayload = { admin_close_reason: reason as AdminCloseReason };
        if (resolution) payload.resolution_category = resolution;
        else if (config.requireResolutionCategory) return null;
        return payload;
      }
      case "cancellation":
        return { admin_close_reason: "cancelled_by_ops" };
      case "submitter_cancellation": {
        if (!reason) return null;
        const notes = text.trim()
          ? `${reason}: ${text.trim()}`
          : reason;
        return {
          admin_close_reason: "cancelled_by_submitter",
          admin_close_notes: notes,
        } as TransitionPayload;
      }
      case "reopen": {
        if (!reason) return null;
        const payload: TransitionPayload = { reopen_reason: reason as ReopenReason };
        if (reason === "other") {
          if (!text.trim()) return null;
          payload.reopen_reason_text = text.trim();
        }
        return payload;
      }
      case "resolution_only":
        if (!resolution && !config.optional) return null;
        return resolution ? { resolution_category: resolution } : {};
      case "vendor_schedule": {
        if (!vendorName.trim()) return null;
        const payload: TransitionPayload = { vendor_name: vendorName.trim() };
        if (vendorId) payload.vendor_id = vendorId;
        return payload;
      }
      case "order_replacement": {
        const manufacturer = replManufacturer.trim();
        const model = replModel.trim();
        const supplier = replSupplier.trim();
        const eta = replEta.trim();
        const cost = Number(replCost);
        if (!manufacturer || !model || !supplier || !eta || !Number.isFinite(cost) || cost < 0) {
          return null;
        }
        const payload: TransitionPayload = {
          replacement_manufacturer: manufacturer,
          replacement_model: model,
          replacement_supplier: supplier,
          replacement_cost: cost,
          replacement_eta: eta,
        };
        if (replAssetTag.trim()) payload.replacement_asset_tag = replAssetTag.trim();
        if (replPoNumber.trim()) payload.replacement_po_number = replPoNumber.trim();
        if (replWarrLabor.trim()) {
          const n = Number(replWarrLabor);
          if (Number.isFinite(n) && n >= 0) payload.replacement_warranty_labor_days = Math.round(n);
        }
        if (replWarrParts.trim()) {
          const n = Number(replWarrParts);
          if (Number.isFinite(n) && n >= 0) payload.replacement_warranty_parts_days = Math.round(n);
        }
        if (replWarrSource) payload.replacement_warranty_parts_source = replWarrSource;
        return payload;
      }
      case "order_parts": {
        const desc = partsDesc.trim();
        const eta = partsEta.trim();
        const cost = Number(partsCost);
        if (!desc || !eta || !Number.isFinite(cost) || cost < 0) return null;
        const payload: TransitionPayload = {
          parts_description: desc,
          parts_cost: cost,
          parts_eta: eta,
        };
        if (partsSupplier.trim()) payload.parts_supplier = partsSupplier.trim();
        if (partsPoNumber.trim()) payload.parts_po_number = partsPoNumber.trim();
        return payload;
      }
    }
  }

  const canSubmit = !!buildPayload();

  async function handleSubmit() {
    const payload = buildPayload();
    if (!payload) return;
    // Receipt / warranty PDFs+images live on ticket_photos with distinct
    // upload_types so admins can filter / list them. The action bar does
    // the actual uploads after the transition succeeds.
    const attachments: PendingAttachment[] = [];
    if (config.kind === "order_replacement") {
      if (replReceipt) attachments.push({ file: replReceipt, uploadType: "replacement_receipt" });
      if (replWarrantyDoc) attachments.push({ file: replWarrantyDoc, uploadType: "replacement_warranty" });
    } else if (config.kind === "order_parts" && partsReceipt) {
      attachments.push({ file: partsReceipt, uploadType: "parts_receipt" });
    }
    await onSubmit(payload, attachments.length ? attachments : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">{title}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {config.kind === "store_close" && (
            <ReasonSelect
              label="Why are you closing this?"
              value={reason}
              onChange={setReason}
              options={STORE_CLOSE_OPTIONS}
            />
          )}
          {config.kind === "admin_close" && (
            <>
              <ReasonSelect
                label="Close reason"
                value={reason}
                onChange={setReason}
                options={ADMIN_CLOSE_OPTIONS}
              />
              <ReasonSelect
                label={config.requireResolutionCategory
                  ? "Resolution"
                  : "Resolution (optional)"}
                value={resolution}
                onChange={(v) => setResolution(v as ResolutionCategory | "")}
                options={RESOLUTION_OPTIONS}
              />
            </>
          )}
          {config.kind === "cancellation" && (
            <div className="text-sm text-zinc-700">
              This ticket will be marked <strong>Cancelled</strong> with reason
              <em> &quot;Cancelled by operations&quot;</em>. Cancelled tickets are
              terminal — no further action is possible.
            </div>
          )}
          {config.kind === "submitter_cancellation" && (
            <>
              <ReasonSelect
                label="Why are you cancelling?"
                value={reason}
                onChange={setReason}
                options={SUBMITTER_CANCEL_OPTIONS}
              />
              {(reason === "other" || reason === "duplicate") && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-600">
                    {reason === "duplicate"
                      ? "Which WO number is the duplicate? (optional)"
                      : "Tell us more (optional)"}
                  </label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={reason === "duplicate" ? "WO-1234" : ""}
                    className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
                Cancelled tickets are terminal — no further action is possible.
                Only available before any vendor work has started.
              </div>
            </>
          )}
          {config.kind === "reopen" && (
            <>
              <ReasonSelect
                label="Why are you reopening?"
                value={reason}
                onChange={setReason}
                options={REOPEN_OPTIONS}
              />
              {reason === "other" && (
                <div>
                  <Label htmlFor="reopen-text">Describe the issue *</Label>
                  <textarea
                    id="reopen-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    placeholder="Required for 'Other' reason."
                    className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}
            </>
          )}
          {config.kind === "resolution_only" && (
            <ReasonSelect
              label={config.optional ? "Resolution (optional)" : "Resolution *"}
              value={resolution}
              onChange={(v) => setResolution(v as ResolutionCategory | "")}
              options={RESOLUTION_OPTIONS}
            />
          )}
          {config.kind === "vendor_schedule" && (
            <div>
              <Label htmlFor="vendor-name">Vendor *</Label>
              {storeNumber ? (
                <VendorSearchInput
                  id="vendor-name"
                  storeNumber={storeNumber}
                  value={vendorName}
                  vendorId={vendorId}
                  onChange={({ name, id }) => {
                    setVendorName(name);
                    setVendorId(id);
                  }}
                  placeholder="Search vendors or type a one-off name…"
                  autoFocus
                />
              ) : (
                <Input
                  id="vendor-name"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Type a vendor name (or pick from Vendors tab)"
                  autoComplete="off"
                />
              )}
              <div className="mt-1 text-[10px] text-zinc-500">
                Pick from the list to link the ticket; or type a one-off name.
              </div>
            </div>
          )}
          {config.kind === "order_replacement" && (
            <div className="space-y-3">
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                Records that you're ordering new equipment instead of repairing.
                The ticket moves to <strong>Awaiting Equipment</strong> until the
                install is complete.
              </div>
              <div>
                <Label htmlFor="repl-manufacturer">Manufacturer *</Label>
                <Input
                  id="repl-manufacturer"
                  value={replManufacturer}
                  onChange={(e) => setReplManufacturer(e.target.value)}
                  placeholder="e.g. Frymaster, Hoshizaki, True"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="repl-model">Replacement model / SKU *</Label>
                <Input
                  id="repl-model"
                  value={replModel}
                  onChange={(e) => setReplModel(e.target.value)}
                  placeholder="e.g. FPP255, KM-901"
                />
              </div>
              <div>
                <Label htmlFor="repl-supplier">Supplier *</Label>
                {storeNumber ? (
                  <VendorSearchInput
                    id="repl-supplier"
                    storeNumber={storeNumber}
                    value={replSupplier}
                    vendorId={null}
                    onChange={({ name }) => setReplSupplier(name)}
                    placeholder="Search vendors or type a one-off name…"
                  />
                ) : (
                  <Input
                    id="repl-supplier"
                    value={replSupplier}
                    onChange={(e) => setReplSupplier(e.target.value)}
                    placeholder="Who's the equipment coming from?"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="repl-cost">Cost *</Label>
                  <Input
                    id="repl-cost"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={replCost}
                    onChange={(e) => setReplCost(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="repl-eta">Expected install *</Label>
                  <Input
                    id="repl-eta"
                    type="date"
                    value={replEta}
                    onChange={(e) => setReplEta(e.target.value)}
                  />
                </div>
              </div>

              {/* V3-asset-capture fields. All optional at order time;
                  team can fill in the rest via Update Ticket as the
                  data arrives. Section header sets expectations so
                  users know they don't HAVE to fill these now. */}
              <div className="border-t border-zinc-200 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Asset details (optional — for the V3 asset register)
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="repl-asset-tag">Asset tag / serial #</Label>
                    <Input
                      id="repl-asset-tag"
                      value={replAssetTag}
                      onChange={(e) => setReplAssetTag(e.target.value)}
                      placeholder="From the spec plate or sticker"
                    />
                  </div>
                  <div>
                    <Label htmlFor="repl-po">PO / order #</Label>
                    <Input
                      id="repl-po"
                      value={replPoNumber}
                      onChange={(e) => setReplPoNumber(e.target.value)}
                      placeholder="From the supplier"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-200 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Warranty (optional)
                </div>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="repl-warr-labor">Labor (days)</Label>
                    <Input
                      id="repl-warr-labor"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={replWarrLabor}
                      onChange={(e) => setReplWarrLabor(e.target.value)}
                      placeholder="90"
                    />
                  </div>
                  <div>
                    <Label htmlFor="repl-warr-parts">Parts (days)</Label>
                    <Input
                      id="repl-warr-parts"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={replWarrParts}
                      onChange={(e) => setReplWarrParts(e.target.value)}
                      placeholder="365"
                    />
                  </div>
                  <div>
                    <Label htmlFor="repl-warr-source">Parts via</Label>
                    <select
                      id="repl-warr-source"
                      value={replWarrSource}
                      onChange={(e) => setReplWarrSource(e.target.value as typeof replWarrSource)}
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

              <div className="border-t border-zinc-200 pt-3">
                <Label htmlFor="repl-receipt">Receipt / invoice (optional)</Label>
                <input
                  id="repl-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReplReceipt(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-midnight hover:file:bg-accent/20"
                />
                {replReceipt && (
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate font-mono">{replReceipt.name}</span>
                    <span>({(replReceipt.size / 1024).toFixed(0)} KB)</span>
                    <button
                      type="button"
                      onClick={() => setReplReceipt(null)}
                      className="text-red-600 hover:underline"
                    >
                      remove
                    </button>
                  </div>
                )}
                <div className="mt-1 text-[10px] text-zinc-500">
                  PDF or image. Uploaded after the ticket transitions; failures don't block the order.
                </div>
              </div>

              <div className="border-t border-zinc-200 pt-3">
                <Label htmlFor="repl-warranty-doc">Warranty document (optional)</Label>
                <input
                  id="repl-warranty-doc"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReplWarrantyDoc(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-midnight hover:file:bg-accent/20"
                />
                {replWarrantyDoc && (
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate font-mono">{replWarrantyDoc.name}</span>
                    <span>({(replWarrantyDoc.size / 1024).toFixed(0)} KB)</span>
                    <button
                      type="button"
                      onClick={() => setReplWarrantyDoc(null)}
                      className="text-red-600 hover:underline"
                    >
                      remove
                    </button>
                  </div>
                )}
                <div className="mt-1 text-[10px] text-zinc-500">
                  Warranty card, terms, or registration. PDF or image.
                </div>
              </div>
            </div>
          )}
          {config.kind === "order_parts" && (
            <div className="space-y-3">
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                Records that you're ordering a repair part. The ticket moves to{" "}
                <strong>Parts on Order</strong> until the part arrives and the
                repair is done.
              </div>
              <div>
                <Label htmlFor="parts-desc">Part description / number *</Label>
                <Input
                  id="parts-desc"
                  value={partsDesc}
                  onChange={(e) => setPartsDesc(e.target.value)}
                  placeholder="e.g. Compressor relay, gas valve #5R-2310"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="parts-supplier">Supplier (optional)</Label>
                {storeNumber ? (
                  <VendorSearchInput
                    id="parts-supplier"
                    storeNumber={storeNumber}
                    value={partsSupplier}
                    vendorId={null}
                    onChange={({ name }) => setPartsSupplier(name)}
                    placeholder="Search vendors or type a one-off name…"
                  />
                ) : (
                  <Input
                    id="parts-supplier"
                    value={partsSupplier}
                    onChange={(e) => setPartsSupplier(e.target.value)}
                    placeholder="Who's the part coming from?"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="parts-cost">Cost *</Label>
                  <Input
                    id="parts-cost"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={partsCost}
                    onChange={(e) => setPartsCost(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="parts-eta">Expected arrival *</Label>
                  <Input
                    id="parts-eta"
                    type="date"
                    value={partsEta}
                    onChange={(e) => setPartsEta(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="parts-po">PO / order # (optional)</Label>
                <Input
                  id="parts-po"
                  value={partsPoNumber}
                  onChange={(e) => setPartsPoNumber(e.target.value)}
                  placeholder="From the supplier"
                />
              </div>
              <div className="border-t border-zinc-200 pt-3">
                <Label htmlFor="parts-receipt">Receipt / invoice (optional)</Label>
                <input
                  id="parts-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setPartsReceipt(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-midnight hover:file:bg-accent/20"
                />
                {partsReceipt && (
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate font-mono">{partsReceipt.name}</span>
                    <span>({(partsReceipt.size / 1024).toFixed(0)} KB)</span>
                    <button
                      type="button"
                      onClick={() => setPartsReceipt(null)}
                      className="text-red-600 hover:underline"
                    >
                      remove
                    </button>
                  </div>
                )}
                <div className="mt-1 text-[10px] text-zinc-500">
                  PDF or image. Uploaded after the ticket transitions; failures don't block the order.
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReasonSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function defaultTitle(kind: ReasonModalConfig["kind"]): string {
  switch (kind) {
    case "store_close":    return "Close — False Alarm";
    case "admin_close":    return "Close Ticket";
    case "cancellation":   return "Cancel Ticket";
    case "submitter_cancellation": return "Cancel this ticket";
    case "reopen":         return "Reopen Ticket";
    case "resolution_only":return "Resolution";
    case "vendor_schedule":return "Schedule Vendor";
    case "order_replacement":return "Order Replacement Equipment";
    case "order_parts":    return "Order Parts";
  }
}
function defaultSubmit(kind: ReasonModalConfig["kind"]): string {
  switch (kind) {
    case "store_close":    return "Close Ticket";
    case "admin_close":    return "Close Ticket";
    case "cancellation":   return "Cancel Ticket";
    case "submitter_cancellation": return "Cancel my ticket";
    case "reopen":         return "Reopen";
    case "resolution_only":return "Save";
    case "vendor_schedule":return "Schedule";
    case "order_replacement":return "Order Replacement";
    case "order_parts":    return "Order Parts";
  }
}
