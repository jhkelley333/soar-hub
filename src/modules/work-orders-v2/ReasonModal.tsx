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
    };

interface Props {
  open: boolean;
  config: ReasonModalConfig;
  // Optional. When provided and the modal config is vendor_schedule,
  // the vendor field renders as a searchable, store-scoped typeahead
  // instead of a free-text input. Falls back to plain text if absent.
  storeNumber?: string;
  onClose: () => void;
  onSubmit: (payload: TransitionPayload) => Promise<void> | void;
  submitting?: boolean;
  error?: string | null;
}

export function ReasonModal({ open, config, storeNumber, onClose, onSubmit, submitting, error }: Props) {
  const [reason, setReason] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [resolution, setResolution] = useState<ResolutionCategory | "">("");
  const [vendorName, setVendorName] = useState<string>("");
  const [vendorId, setVendorId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setText("");
    setResolution("");
    setVendorName("");
    setVendorId(null);
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
    }
  }

  const canSubmit = !!buildPayload();

  async function handleSubmit() {
    const payload = buildPayload();
    if (!payload) return;
    await onSubmit(payload);
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
  }
}
