// Walkthrough — conditional follow-up reveal.
//
// Rendered inline beneath a checklist item when its value (Fail / Watch)
// triggers a template rule. Animates open via a grid-rows 0fr→1fr trick so
// the row grows smoothly without a fixed max-height guess. Surfaces exactly
// the follow-ups the rule requires — reason chips, a gated photo capture,
// a note — plus a notice when a corrective action will be raised on submit.
//
// Presentational: all state lives in use-walkthrough-store; this component
// reads `response` + emits intent through callbacks.

import { useRef } from "react";
import { Camera, RotateCw, X, Flag } from "lucide-react";
import { cn } from "@/lib/cn";
import { requirementStatus } from "./rules";
import type {
  FollowupRule,
  ItemResponse,
  ItemSeverity,
  PhotoRecord,
} from "./types";

const SEVERITY_LABEL: Record<ItemSeverity, string> = {
  low: "Low priority",
  med: "Priority",
  high: "High priority",
};

export interface ConditionalFollowupProps {
  rule: FollowupRule | null;
  response: ItemResponse;
  /** Photo records attached to THIS item. */
  photos: PhotoRecord[];
  photoUrls: Record<string, string>;
  severity?: ItemSeverity;
  onReason: (reason: string) => void;
  onNote: (note: string) => void;
  onAddPhoto: (file: Blob) => void;
  onRemovePhoto: (id: string) => void;
  onRetryPhoto: (id: string) => void;
}

export function ConditionalFollowup({
  rule,
  response,
  photos,
  photoUrls,
  severity = "med",
  onReason,
  onNote,
  onAddPhoto,
  onRemovePhoto,
  onRetryPhoto,
}: ConditionalFollowupProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const open = !!rule;
  const status = requirementStatus(rule, response);
  const tone = rule?.trigger === "fail" ? "bad" : "warn";

  return (
    <div
      className={cn(
        "grid transition-all duration-200 ease-out",
        open ? "grid-rows-[1fr] opacity-100 mt-3" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">
        {rule && (
          <div
            className={cn(
              "rounded-lg p-3 space-y-3 ring-1",
              tone === "bad"
                ? "bg-bad/[0.04] ring-bad/20"
                : "bg-warn/[0.06] ring-warn/25",
            )}
          >
            {/* Reason — chips when the template supplies options, else a
                short free-text input. */}
            {status.needReason && (
              <Field
                label="Reason"
                required
                done={status.haveReason}
              >
                {rule.reasonOptions && rule.reasonOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {rule.reasonOptions.map((opt) => {
                      const active = response.reason === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => onReason(active ? "" : opt)}
                          className={cn(
                            "min-h-[36px] px-3 rounded-full text-[12.5px] font-medium ring-1 transition",
                            active
                              ? "bg-midnight-900 text-white ring-midnight-900"
                              : "bg-white text-midnight-700 ring-midnight-200 hover:ring-midnight-300",
                          )}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    value={response.reason ?? ""}
                    onChange={(e) => onReason(e.target.value)}
                    placeholder="What's the issue?"
                    className="w-full h-10 rounded-lg ring-1 ring-midnight-200 bg-white px-3 text-[13px] text-midnight-800 placeholder:text-midnight-300 outline-none focus:ring-accent-500"
                  />
                )}
              </Field>
            )}

            {/* Photo — gated. Required count is enforced; the upload runs in
                the background so a failed upload never blocks the walk. */}
            {status.needPhoto > 0 && (
              <Field
                label={`Photo${status.needPhoto > 1 ? `s · ${status.havePhoto}/${status.needPhoto}` : ""}`}
                required
                done={status.havePhoto >= status.needPhoto}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {photos.map((p) => (
                    <PhotoThumb
                      key={p.id}
                      record={p}
                      url={photoUrls[p.id]}
                      onRemove={() => onRemovePhoto(p.id)}
                      onRetry={() => onRetryPhoto(p.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-16 h-16 rounded-lg ring-1 ring-dashed ring-midnight-300 bg-white flex flex-col items-center justify-center gap-0.5 text-midnight-500 hover:ring-accent-500 hover:text-accent-600 transition"
                    aria-label="Add photo"
                  >
                    <Camera className="h-4 w-4" strokeWidth={2} />
                    <span className="text-[10px] font-medium">Add</span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onAddPhoto(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </Field>
            )}

            {/* Note */}
            {status.needNote && (
              <Field label="Note" required done={status.haveNote}>
                <textarea
                  rows={2}
                  value={response.note ?? ""}
                  onChange={(e) => onNote(e.target.value)}
                  placeholder="Add detail for the DO…"
                  className="w-full rounded-lg ring-1 ring-midnight-200 bg-white px-3 py-2 text-[13px] text-midnight-800 placeholder:text-midnight-300 outline-none resize-none focus:ring-accent-500"
                />
              </Field>
            )}

            {/* Corrective-action notice — informational; the record is emitted
                server-side on submit. */}
            {status.raisesCorrectiveAction && (
              <div className="flex items-center gap-2 text-[11.5px] text-midnight-600 pt-0.5">
                <Flag className="h-3.5 w-3.5 text-bad" strokeWidth={2} />
                <span>
                  Creates a corrective action on submit ·{" "}
                  <span className="text-midnight-500">{SEVERITY_LABEL[severity]}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  done,
  children,
}: {
  label: string;
  required?: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-midnight-600">
          {label}
        </span>
        {required && (
          <span
            className={cn(
              "text-[10px] font-medium rounded px-1 py-px",
              done ? "bg-ok/15 text-midnight-600" : "bg-bad/10 text-bad",
            )}
          >
            {done ? "✓" : "Required"}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function PhotoThumb({
  record,
  url,
  onRemove,
  onRetry,
}: {
  record: PhotoRecord;
  url?: string;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const failed = record.uploadStatus === "error";
  const uploading = record.uploadStatus === "uploading";
  return (
    <div className="relative w-16 h-16 rounded-lg overflow-hidden ring-1 ring-midnight-200 bg-midnight-50">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full placeholder-stripes" />
      )}

      {/* Upload status veil */}
      {uploading && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <RotateCw className="h-4 w-4 text-white animate-spin" strokeWidth={2} />
        </div>
      )}
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute inset-0 bg-bad/70 flex flex-col items-center justify-center gap-0.5 text-white"
          aria-label="Retry upload"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="text-[9px] font-semibold">Retry</span>
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center"
        aria-label="Remove photo"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
