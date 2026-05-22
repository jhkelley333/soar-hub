// /assignments/:id/fill — the heart of the submission flow. Renders
// the pinned template version's questions in order, with auto-save to
// localStorage so the user doesn't lose work on a refresh. Submit
// calls createSubmission with the full answers array; the server
// validates required-ness, computes audit scoring, and creates
// sign-off rows. On success we land back on /assignments/:id.
//
// Attachment-type fields (photo, file, signature) render a "ships in
// a follow-up" placeholder for now — the storage-upload + signed-URL
// flow is its own slice.

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Send, AlertTriangle, Check, X, Minus, Trash2, Info,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getAssignment, getTemplateVersion, createSubmission,
} from "./api";
import type {
  TemplateQuestion, AuditResult, SubmissionAnswer,
} from "./types";

type LocalAnswer = {
  question_id: string;
  answer_text?: string | null;
  answer_number?: number | null;
  answer_boolean?: boolean | null;
  answer_date?: string | null;
  answer_json?: unknown;
  audit_result?: AuditResult | null;
};

type AnswersMap = Record<string, LocalAnswer>;

const ATTACHMENT_TYPES = new Set(["photo", "file", "signature"]);

function draftKey(assignmentId: string) {
  return `ws-submission-draft:${assignmentId}`;
}

function loadDraft(assignmentId: string): AnswersMap {
  try {
    const raw = localStorage.getItem(draftKey(assignmentId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDraft(assignmentId: string, answers: AnswersMap) {
  try {
    localStorage.setItem(draftKey(assignmentId), JSON.stringify(answers));
  } catch { /* quota or private mode — skip silently */ }
}

function clearDraft(assignmentId: string) {
  try { localStorage.removeItem(draftKey(assignmentId)); } catch { /* */ }
}

function hasAnswer(a: LocalAnswer | undefined, q: TemplateQuestion): boolean {
  if (!a) return false;
  if (q.field_type === "pass_fail_na") return a.audit_result != null;
  return (
    a.answer_text != null && a.answer_text !== ""
    || a.answer_number != null
    || a.answer_boolean != null
    || a.answer_date != null
    || a.answer_json != null
  );
}

export function SubmissionFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftLoadedAt, setDraftLoadedAt] = useState<number | null>(null);

  const asnQuery = useQuery({
    queryKey: ["assignment", id],
    queryFn: () => getAssignment(id!),
    enabled: !!id,
  });

  const assignment = asnQuery.data?.assignment;
  const versionId = assignment?.template_version_id;

  const verQuery = useQuery({
    queryKey: ["template-version", versionId],
    queryFn: () => getTemplateVersion(versionId!),
    enabled: !!versionId,
  });

  // Hydrate local state from localStorage once we know the assignment.
  useEffect(() => {
    if (!id) return;
    setAnswers(loadDraft(id));
    setDraftLoadedAt(Date.now());
  }, [id]);

  // Auto-save on any answer change after hydration.
  useEffect(() => {
    if (!id || draftLoadedAt == null) return;
    saveDraft(id, answers);
  }, [id, answers, draftLoadedAt]);

  const submitMut = useMutation({
    mutationFn: () => createSubmission({
      assignment_id: id!,
      answers: Object.values(answers) as Array<Partial<SubmissionAnswer> & { question_id: string }>,
    }),
    onSuccess: () => {
      clearDraft(id!);
      navigate(`/assignments/${id}`);
    },
    onError: (e) => setSubmitError((e as Error)?.message ?? "Submit failed."),
  });

  const questions = verQuery.data?.questions ?? [];
  const template = verQuery.data?.version.workspace_templates;
  const isAudit = template?.type === "audit";

  // Group questions by section_label for visual grouping (null section
  // → ungrouped, render in order at the top).
  const sections = useMemo(() => {
    const out: Array<{ label: string | null; items: TemplateQuestion[] }> = [];
    let current: { label: string | null; items: TemplateQuestion[] } | null = null;
    for (const q of questions) {
      if (!current || current.label !== (q.section_label ?? null)) {
        current = { label: q.section_label ?? null, items: [] };
        out.push(current);
      }
      current.items.push(q);
    }
    return out;
  }, [questions]);

  function setAnswer(qid: string, patch: Partial<LocalAnswer>) {
    setAnswers((prev) => ({
      ...prev,
      [qid]: { ...(prev[qid] ?? { question_id: qid }), question_id: qid, ...patch },
    }));
  }

  const missingRequired = questions.filter(
    (q) => q.is_required && !hasAnswer(answers[q.id], q),
  );
  const canSubmit = missingRequired.length === 0 && !submitMut.isPending;

  if (asnQuery.isLoading || verQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (asnQuery.isError || !assignment) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load assignment: {(asnQuery.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/assignments">
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
      </Card>
    );
  }

  // Guard: backend rejects createSubmission on cancelled/submitted; show
  // a helpful surface rather than letting the user fill out a dead form.
  if (assignment.status === "submitted" || assignment.status === "cancelled") {
    return (
      <Card className="p-6 space-y-3">
        <p className="text-sm">
          This assignment is <strong>{assignment.status}</strong> and can't be filled out here.
        </p>
        <Link to={`/assignments/${id}`}>
          <Button variant="secondary"><ArrowLeft className="h-4 w-4 mr-1" /> Back to assignment</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to={`/assignments/${id}`}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to assignment
      </Link>

      <PageHeader
        title={template?.name ?? "Submission"}
        description={
          isAudit
            ? "Audit form — fail answers may auto-spawn a corrective action plan."
            : "Fill out the form below and submit when ready."
        }
        actions={
          <div className="flex items-center gap-2">
            {isAudit && <Badge tone="warning">Audit</Badge>}
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Save className="h-3 w-3" /> Draft saved locally
            </span>
          </div>
        }
      />

      {missingRequired.length > 0 && (
        <Card className="p-3 text-sm bg-amber-50 border-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>{missingRequired.length}</strong> required question{missingRequired.length === 1 ? "" : "s"}{" "}
            still need an answer.
          </div>
        </Card>
      )}

      {sections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-3">
          {section.label && (
            <h3 className="text-sm font-semibold text-gray-700 mt-2">{section.label}</h3>
          )}
          {section.items.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              answer={answers[q.id]}
              onChange={(patch) => setAnswer(q.id, patch)}
            />
          ))}
        </div>
      ))}

      {submitError && (
        <Card className="p-3 text-sm text-red-600 bg-red-50 border-red-200">
          {submitError}
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={() => {
            if (confirm("Discard the local draft? This clears any unsubmitted answers in this browser.")) {
              clearDraft(id!);
              setAnswers({});
            }
          }}
          className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" /> Discard draft
        </button>
        <Button
          onClick={() => { setSubmitError(null); submitMut.mutate(); }}
          disabled={!canSubmit}
          title={canSubmit ? "Submit for sign-off" : "Answer required questions first"}
        >
          <Send className="h-4 w-4 mr-1" />
          {submitMut.isPending ? "Submitting..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}

function QuestionField({
  question, answer, onChange,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const ft = question.field_type;
  const cfg = (question.field_config ?? {}) as { options?: string[]; allow_other?: boolean };

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Label className="text-sm">
            {question.question_text}
            {question.is_required && <span className="text-red-600 ml-1">*</span>}
          </Label>
          {question.is_critical && ft === "pass_fail_na" && (
            <div className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Critical — a fail here flips the whole audit.
            </div>
          )}
        </div>
      </div>

      {ft === "short_text" && (
        <Input
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
        />
      )}

      {ft === "long_text" && (
        <textarea
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      {ft === "number" && (
        <Input
          type="number"
          value={answer?.answer_number ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ answer_number: v === "" ? null : Number(v) });
          }}
        />
      )}

      {ft === "date" && (
        <Input
          type="date"
          value={answer?.answer_date ?? ""}
          onChange={(e) => onChange({ answer_date: e.target.value || null })}
        />
      )}

      {ft === "checkbox" && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={!!answer?.answer_boolean}
            onChange={(e) => onChange({ answer_boolean: e.target.checked })}
            className="rounded"
          />
          Yes
        </label>
      )}

      {ft === "select_one" && (
        <div className="space-y-1.5">
          {(cfg.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={answer?.answer_text === opt}
                onChange={() => onChange({ answer_text: opt })}
              />
              {opt}
            </label>
          ))}
          {!(cfg.options ?? []).length && (
            <p className="text-xs text-amber-700">
              No options configured on this question.
            </p>
          )}
        </div>
      )}

      {ft === "select_many" && (
        <div className="space-y-1.5">
          {(cfg.options ?? []).map((opt) => {
            const sel = Array.isArray(answer?.answer_json) ? answer!.answer_json as string[] : [];
            const checked = sel.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...sel, opt]
                      : sel.filter((s) => s !== opt);
                    onChange({ answer_json: next });
                  }}
                  className="rounded"
                />
                {opt}
              </label>
            );
          })}
          {!(cfg.options ?? []).length && (
            <p className="text-xs text-amber-700">
              No options configured on this question.
            </p>
          )}
        </div>
      )}

      {ft === "pass_fail_na" && (
        <PassFailNa
          value={answer?.audit_result ?? null}
          onChange={(v) => onChange({ audit_result: v })}
          critical={question.is_critical}
        />
      )}

      {ATTACHMENT_TYPES.has(ft) && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {ft === "photo" ? "Photo" : ft === "signature" ? "Signature" : "File"} upload ships
            in the next slice. For now this question won't block submit unless it's required.
          </span>
        </div>
      )}
    </Card>
  );
}

function PassFailNa({
  value, onChange, critical,
}: {
  value: AuditResult | null;
  onChange: (v: AuditResult) => void;
  critical: boolean;
}) {
  const options: Array<{ v: AuditResult; label: string; icon: typeof Check; activeCls: string }> = [
    { v: "pass", label: "Pass", icon: Check,  activeCls: "bg-green-600 text-white border-green-600" },
    { v: "fail", label: "Fail", icon: X,      activeCls: "bg-red-600 text-white border-red-600" },
    { v: "na",   label: "N/A",  icon: Minus,  activeCls: "bg-gray-600 text-white border-gray-600" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = value === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange(opt.v)}
              className={
                "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded border text-sm font-medium transition " +
                (active
                  ? opt.activeCls
                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
              }
            >
              <Icon className="h-4 w-4" />
              {opt.label}
            </button>
          );
        })}
      </div>
      {value === "fail" && critical && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Critical fail — submitting will flag this audit as
          {" "}<strong>fail_critical</strong> regardless of overall score.
        </div>
      )}
    </div>
  );
}
