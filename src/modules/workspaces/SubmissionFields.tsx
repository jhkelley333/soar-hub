// src/modules/workspaces/SubmissionFields.tsx
//
// Field-level components for the SubmissionFormPage renderer. Split
// out of the page file to keep each piece a reasonable size and to
// make the per-field-type UI easier to scan. Nothing here touches
// network or autosave state — the parent owns all of that.

import { useRef, useState } from "react";
import {
  AlertTriangle, Check, X, Minus, Camera, ImageIcon, Paperclip,
  Loader2, X as XIconClose,
} from "lucide-react";
import { SignatureField } from "./SignatureField";
import type { TemplateQuestion, AuditResult } from "./types";

export type LocalAnswer = {
  question_id: string;
  answer_text?: string | null;
  answer_number?: number | null;
  answer_boolean?: boolean | null;
  answer_date?: string | null;
  answer_json?: unknown;
  audit_result?: AuditResult | null;
  attachment_ids?: string[];
};

export const MAX_PHOTOS_PER_QUESTION = 5;

// Does this answer count as "answered" for required-field validation
// and progress display? Type-aware so e.g. a checkbox with `false`
// is still answered.
export function hasAnswerValue(a: LocalAnswer | undefined, q: TemplateQuestion): boolean {
  if (!a) return false;
  if (q.field_type === "pass_fail_na") return a.audit_result != null;
  if (q.field_type === "select_many")  return Array.isArray(a.answer_json) && (a.answer_json as unknown[]).length > 0;
  if (q.field_type === "checkbox")     return typeof a.answer_boolean === "boolean";
  if (q.field_type === "number")       return a.answer_number != null;
  if (q.field_type === "date")         return !!a.answer_date;
  if (q.field_type === "photo" || q.field_type === "file" || q.field_type === "signature") {
    return Array.isArray(a.attachment_ids) && a.attachment_ids.length > 0;
  }
  return a.answer_text != null && a.answer_text !== "";
}

// A flagged-fail question (pass_fail_na + requires_cap_on_fail) needs
// an inline note when the user marks it fail. Backend enforces the
// same rule; we check here for the live error UI.
export function flaggedFailNeedsNote(q: TemplateQuestion, a: LocalAnswer | undefined): boolean {
  if (q.field_type !== "pass_fail_na") return false;
  if (!q.requires_cap_on_fail) return false;
  if (a?.audit_result !== "fail") return false;
  return !a.answer_text || a.answer_text.trim() === "";
}

// ─── Question card ──────────────────────────────────

export function QuestionCard({
  question, answer, showError,
  attachmentUrls, attachmentMetas, workspaceId,
  onChange, onAddPhoto, onRemovePhoto,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  showError: boolean;
  attachmentUrls: Map<string, string>;
  attachmentMetas: Map<string, { file_name: string; mime_type: string | null }>;
  workspaceId: string | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
  onAddPhoto: (file: File) => void;
  onRemovePhoto: (attachmentId: string) => void;
}) {
  const ft = question.field_type;
  const missingRequired = showError && question.is_required && !hasAnswerValue(answer, question);
  const missingFlaggedNote = showError && flaggedFailNeedsNote(question, answer);
  const hasError = missingRequired || missingFlaggedNote;

  return (
    <div
      className={
        "rounded-lg bg-white border p-4 space-y-3 " +
        (hasError ? "border-red-300" : "border-gray-200")
      }
      role="group"
      aria-labelledby={`q-${question.id}-label`}
      aria-invalid={hasError ? true : undefined}
    >
      <div>
        <label
          id={`q-${question.id}-label`}
          className="block text-[15px] font-medium text-gray-900 leading-snug"
        >
          {question.question_text}
          {question.is_required && <span className="text-red-600 ml-1" aria-label="required">*</span>}
        </label>
        {question.is_critical && ft === "pass_fail_na" && (
          <div className="text-xs text-amber-800 mt-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Critical — a fail here flips the whole audit.
          </div>
        )}
      </div>

      {ft === "short_text" && (
        <input
          type="text"
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
          aria-invalid={missingRequired ? true : undefined}
          className="w-full h-11 rounded-md border border-gray-300 px-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "long_text" && (
        <textarea
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
          rows={3}
          aria-invalid={missingRequired ? true : undefined}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "number" && (
        <input
          type="number"
          inputMode="decimal"
          value={answer?.answer_number ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ answer_number: v === "" ? null : Number(v) });
          }}
          aria-invalid={missingRequired ? true : undefined}
          className="w-full h-11 rounded-md border border-gray-300 px-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "date" && (
        <input
          type="date"
          value={answer?.answer_date ?? ""}
          onChange={(e) => onChange({ answer_date: e.target.value || null })}
          aria-invalid={missingRequired ? true : undefined}
          className="w-full h-11 rounded-md border border-gray-300 px-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "checkbox" && (
        <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={!!answer?.answer_boolean}
            onChange={(e) => onChange({ answer_boolean: e.target.checked })}
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-[15px]">Yes</span>
        </label>
      )}

      {ft === "select_one" && (
        <SelectOneField question={question} answer={answer} onChange={onChange} />
      )}

      {ft === "select_many" && (
        <SelectManyField question={question} answer={answer} onChange={onChange} />
      )}

      {ft === "pass_fail_na" && (
        <>
          <PassFailNaField answer={answer} questionText={question.question_text} onChange={onChange} />
          {question.requires_cap_on_fail && answer?.audit_result === "fail" && (
            <FlaggedFailNote
              question={question}
              answer={answer}
              showError={showError}
              attachmentUrls={attachmentUrls}
              attachmentMetas={attachmentMetas}
              workspaceId={workspaceId}
              onChange={onChange}
              onAddPhoto={onAddPhoto}
              onRemovePhoto={onRemovePhoto}
            />
          )}
        </>
      )}

      {(ft === "photo" || ft === "file") && (
        <PhotoField
          accept={ft === "photo" ? "image/*" : undefined}
          allowCapture={ft === "photo"}
          ids={answer?.attachment_ids ?? []}
          attachmentUrls={attachmentUrls}
          attachmentMetas={attachmentMetas}
          disabled={!workspaceId}
          onAdd={onAddPhoto}
          onRemove={onRemovePhoto}
        />
      )}

      {ft === "signature" && (
        <SignatureField
          ids={answer?.attachment_ids ?? []}
          attachmentUrls={attachmentUrls}
          attachmentMetas={attachmentMetas}
          disabled={!workspaceId}
          onAdd={onAddPhoto}
          onRemove={onRemovePhoto}
        />
      )}

      {missingRequired && (
        <div className="text-sm text-red-700" role="alert">
          This is required
        </div>
      )}
      {missingFlaggedNote && !missingRequired && (
        <div className="text-sm text-red-700" role="alert">
          A note is required when a flagged item is marked failed.
        </div>
      )}
    </div>
  );
}

// ─── Flagged-fail inline note + optional photos ─────────

function FlaggedFailNote({
  question, answer, showError,
  attachmentUrls, attachmentMetas, workspaceId,
  onChange, onAddPhoto, onRemovePhoto,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  showError: boolean;
  attachmentUrls: Map<string, string>;
  attachmentMetas: Map<string, { file_name: string; mime_type: string | null }>;
  workspaceId: string | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
  onAddPhoto: (file: File) => void;
  onRemovePhoto: (attachmentId: string) => void;
}) {
  const missing = showError && flaggedFailNeedsNote(question, answer);
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2 ws-anim-in">
      <label className="block text-xs font-semibold text-amber-900 uppercase tracking-wide">
        What went wrong?
        <span className="text-red-700 ml-1" aria-label="required">*</span>
      </label>
      <textarea
        value={answer?.answer_text ?? ""}
        onChange={(e) => onChange({ answer_text: e.target.value })}
        rows={2}
        placeholder="Brief description — this gets attached to the CAP."
        aria-invalid={missing ? true : undefined}
        className={
          "w-full rounded-md border px-3 py-2 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent " +
          (missing ? "border-red-400" : "border-amber-300")
        }
      />
      <div>
        <label className="block text-xs font-semibold text-amber-900 uppercase tracking-wide mb-1">
          Photo (optional)
        </label>
        <PhotoField
          accept="image/*"
          allowCapture
          ids={answer?.attachment_ids ?? []}
          attachmentUrls={attachmentUrls}
          attachmentMetas={attachmentMetas}
          disabled={!workspaceId}
          onAdd={onAddPhoto}
          onRemove={onRemovePhoto}
          compact
        />
      </div>
    </div>
  );
}

// ─── Photo / file field ────────────────────────────────

function PhotoField({
  accept, allowCapture, ids,
  attachmentUrls, attachmentMetas, disabled,
  onAdd, onRemove, compact = false,
}: {
  accept?: string;
  allowCapture?: boolean;
  ids: string[];
  attachmentUrls: Map<string, string>;
  attachmentMetas: Map<string, { file_name: string; mime_type: string | null }>;
  disabled?: boolean;
  onAdd: (file: File) => void;
  onRemove: (attachmentId: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const limitReached = ids.length >= MAX_PHOTOS_PER_QUESTION;

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (ids.length + 1 > MAX_PHOTOS_PER_QUESTION) break;
        await onAdd(f);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className={"grid gap-2 " + (compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")}>
          {ids.map((aid) => (
            <PhotoThumb
              key={aid}
              url={attachmentUrls.get(aid)}
              meta={attachmentMetas.get(aid)}
              onRemove={() => onRemove(aid)}
            />
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={allowCapture ? "environment" : undefined}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || busy}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || limitReached}
        className={
          "inline-flex items-center gap-2 h-10 px-3 rounded-md border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
          (limitReached
            ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
            : "border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100")
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : allowCapture ? (
          <Camera className="h-4 w-4" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        {busy
          ? "Uploading…"
          : allowCapture
            ? (ids.length > 0 ? "Add another photo" : "Take photo")
            : (ids.length > 0 ? "Add another file" : "Attach file")}
      </button>
      {limitReached && (
        <div className="text-xs text-gray-600">Max {MAX_PHOTOS_PER_QUESTION} reached.</div>
      )}
    </div>
  );
}

function PhotoThumb({
  url, meta, onRemove,
}: {
  url: string | undefined;
  meta: { file_name: string; mime_type: string | null } | undefined;
  onRemove: () => void;
}) {
  const isImage = !meta?.mime_type || meta.mime_type.startsWith("image/");
  return (
    <div className="relative aspect-square rounded-md overflow-hidden border border-gray-200 bg-gray-50">
      {url && isImage ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full h-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
        >
          <img src={url} alt={meta?.file_name ?? "attachment"} className="w-full h-full object-cover" />
        </a>
      ) : (
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-[10px] text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset"
        >
          <ImageIcon className="h-6 w-6 mb-1" />
          <div className="truncate w-full">{meta?.file_name ?? "file"}</div>
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white"
      >
        <XIconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Pass / Fail / N/A pills ────────────────────────────

function PassFailNaField({
  answer, questionText, onChange,
}: {
  answer: LocalAnswer | undefined;
  questionText: string;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const val = answer?.audit_result ?? null;
  const opts: Array<{
    v: AuditResult; label: string; Icon: typeof Check;
    activeCls: string;
  }> = [
    { v: "pass", label: "Yes", Icon: Check, activeCls: "bg-green-600 text-white border-green-600" },
    { v: "fail", label: "No",  Icon: X,     activeCls: "bg-red-600 text-white border-red-600" },
    { v: "na",   label: "N/A", Icon: Minus, activeCls: "bg-gray-600 text-white border-gray-600" },
  ];
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label={`Yes, no, or N/A for: ${questionText}`}
    >
      {opts.map(({ v, label, Icon, activeCls }) => {
        const active = val === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            onClick={() => onChange({ audit_result: v })}
            className={
              "min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-md border text-[15px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 " +
              (active
                ? activeCls
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
            }
            aria-checked={active}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Select-one radio list ───────────────────────────

function SelectOneField({
  question, answer, onChange,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const cfg = (question.field_config ?? {}) as { options?: string[] };
  const options = cfg.options ?? [];
  if (!options.length) {
    return (
      <p className="text-xs text-amber-800">
        No options configured on this question.
      </p>
    );
  }
  return (
    <div className="space-y-1" role="radiogroup" aria-labelledby={`q-${question.id}-label`}>
      {options.map((opt) => (
        <label
          key={opt}
          className="flex items-center gap-3 cursor-pointer min-h-[44px] px-1"
        >
          <input
            type="radio"
            name={`q-${question.id}`}
            checked={answer?.answer_text === opt}
            onChange={() => onChange({ answer_text: opt })}
            className="h-5 w-5 border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-[15px] flex-1">{opt}</span>
        </label>
      ))}
    </div>
  );
}

// ─── Select-many checkbox list ─────────────────────────

function SelectManyField({
  question, answer, onChange,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const cfg = (question.field_config ?? {}) as { options?: string[] };
  const options = cfg.options ?? [];
  const selected: string[] = Array.isArray(answer?.answer_json)
    ? (answer!.answer_json as string[])
    : [];
  if (!options.length) {
    return (
      <p className="text-xs text-amber-800">
        No options configured on this question.
      </p>
    );
  }
  return (
    <div className="space-y-1" role="group" aria-labelledby={`q-${question.id}-label`}>
      {options.map((opt) => {
        const checked = selected.includes(opt);
        return (
          <label
            key={opt}
            className="flex items-center gap-3 cursor-pointer min-h-[44px] px-1"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...selected, opt]
                  : selected.filter((s) => s !== opt);
                onChange({ answer_json: next });
              }}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-[15px] flex-1">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}
