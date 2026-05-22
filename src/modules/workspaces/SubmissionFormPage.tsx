// /assignments/:id/fill — the form-filling experience. Mobile-first,
// Smartsheet-style single-scroll layout: top bar + progress, sections
// as visual dividers, question cards, sticky Submit at the bottom.
// Conditional logic (show_if) hides/shows questions and whole sections
// live as the user answers.
//
// This is Checkpoint 1 of the renderer rebuild:
//   ✓ Mobile shell (top bar, progress, sticky submit)
//   ✓ Render pipeline: sections → questions, ordered, with show_if
//   ✓ Yes/No/N/A pill buttons (the headline interaction)
//   ✓ Text / long text / number / date / select_one / select_many / checkbox
//   ✓ Local React state only (no save yet — that's Checkpoint 2)
//   ✗ Auto-save to Supabase  → Checkpoint 2
//   ✗ Submit confirmation modal + success screen → Checkpoint 2
//   ✗ Photos / signatures / file uploads → Checkpoint 3/4
//   ✗ Flagged-response inline note requirement → Checkpoint 3
//   ✗ Live audit score in top bar → Checkpoint 3

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Check, X, Minus, AlertTriangle, MoreVertical,
} from "lucide-react";
import {
  getAssignment, getTemplateVersion, createSubmission,
} from "./api";
import { shouldShow, getAnswerValue } from "./conditional";
import type {
  TemplateQuestion, TemplateSection, AuditResult, SubmissionAnswer,
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

const ATTACHMENT_TYPES = new Set(["photo", "file", "signature"]);

function hasAnswerValue(a: LocalAnswer | undefined, q: TemplateQuestion): boolean {
  if (!a) return false;
  if (q.field_type === "pass_fail_na") return a.audit_result != null;
  if (q.field_type === "select_many")  return Array.isArray(a.answer_json) && (a.answer_json as unknown[]).length > 0;
  if (q.field_type === "checkbox")     return typeof a.answer_boolean === "boolean";
  if (q.field_type === "number")       return a.answer_number != null;
  if (q.field_type === "date")         return !!a.answer_date;
  return a.answer_text != null && a.answer_text !== "";
}

// Group questions by section_id (NULL = "unsectioned", rendered first
// with no header). Within a section, questions render in `position`
// order — they come from the API already sorted.
function groupBySection(questions: TemplateQuestion[]): Map<string | null, TemplateQuestion[]> {
  const out = new Map<string | null, TemplateQuestion[]>();
  for (const q of questions) {
    const key = q.section_id ?? null;
    const arr = out.get(key) ?? [];
    arr.push(q);
    out.set(key, arr);
  }
  return out;
}

export function SubmissionFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Map<string, LocalAnswer>>(new Map());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const questionRefs = useRef(new Map<string, HTMLDivElement>());

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

  const template = verQuery.data?.version.workspace_templates;
  const questions = useMemo(() => verQuery.data?.questions ?? [], [verQuery.data]);
  const sections = useMemo(() => verQuery.data?.sections ?? [], [verQuery.data]);

  const questionsByQid = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions],
  );

  // Compute visibility for every question + section against current
  // answers. Memoized on the answers map identity (we replace it on
  // every change) so the recompute is fast and predictable.
  const visibleQuestionIds = useMemo(() => {
    const out = new Set<string>();
    for (const q of questions) {
      if (shouldShow(q.conditional_logic, answers, questionsByQid)) {
        out.add(q.id);
      }
    }
    return out;
  }, [questions, answers, questionsByQid]);

  const visibleSectionIds = useMemo(() => {
    const out = new Set<string>();
    for (const s of sections) {
      // Section's own show_if must pass first.
      if (!shouldShow(s.conditional_logic, answers, questionsByQid)) continue;
      // And then it must have at least one currently-visible question
      // (otherwise rendering an empty header is just noise).
      const hasVisibleChild = questions.some(
        (q) => q.section_id === s.id && visibleQuestionIds.has(q.id),
      );
      if (hasVisibleChild) out.add(s.id);
    }
    return out;
  }, [sections, answers, questionsByQid, questions, visibleQuestionIds]);

  // The render order: any unsectioned visible questions first (rare
  // but legal), then sections in `position` order with their visible
  // questions.
  const grouped = useMemo(() => groupBySection(questions), [questions]);
  const renderPlan = useMemo(() => {
    const plan: Array<
      | { kind: "section"; section: TemplateSection; questions: TemplateQuestion[] }
      | { kind: "loose"; questions: TemplateQuestion[] }
    > = [];

    const loose = (grouped.get(null) ?? []).filter((q) => visibleQuestionIds.has(q.id));
    if (loose.length) plan.push({ kind: "loose", questions: loose });

    for (const s of sections) {
      if (!visibleSectionIds.has(s.id)) continue;
      const items = (grouped.get(s.id) ?? []).filter((q) => visibleQuestionIds.has(q.id));
      if (items.length) plan.push({ kind: "section", section: s, questions: items });
    }
    return plan;
  }, [grouped, sections, visibleQuestionIds, visibleSectionIds]);

  // Required progress = visible required questions answered / total
  // visible required questions. Required-but-hidden questions don't
  // count — they're not asked at all in this submission.
  const { requiredTotal, requiredAnswered } = useMemo(() => {
    let total = 0;
    let answered = 0;
    for (const q of questions) {
      if (!q.is_required) continue;
      if (!visibleQuestionIds.has(q.id)) continue;
      total++;
      if (hasAnswerValue(answers.get(q.id), q)) answered++;
    }
    return { requiredTotal: total, requiredAnswered: answered };
  }, [questions, visibleQuestionIds, answers]);
  const pct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);

  function setAnswer(qid: string, patch: Partial<LocalAnswer>) {
    setAnswers((prev) => {
      const next = new Map(prev);
      const existing = next.get(qid) ?? { question_id: qid };
      next.set(qid, { ...existing, question_id: qid, ...patch });
      return next;
    });
  }

  const submitMut = useMutation({
    mutationFn: () => createSubmission({
      assignment_id: id!,
      // Only ship answers for currently-visible questions. Hidden
      // answers (orphaned by a conditional change) are dropped at
      // submit time so the server doesn't validate against them.
      answers: Array.from(answers.values()).filter(
        (a) => visibleQuestionIds.has(a.question_id),
      ) as Array<Partial<SubmissionAnswer> & { question_id: string }>,
    }),
    onSuccess: () => navigate(`/assignments/${id}`),
    onError: (e) => setSubmitError((e as Error)?.message ?? "Submit failed."),
  });

  function handleSubmit() {
    setSubmitError(null);
    // Final validation: every visible required question must have an
    // answer. If any are missing, surface the inline errors and scroll
    // to the first one.
    const missing: string[] = [];
    for (const q of questions) {
      if (!q.is_required) continue;
      if (!visibleQuestionIds.has(q.id)) continue;
      if (!hasAnswerValue(answers.get(q.id), q)) missing.push(q.id);
    }
    if (missing.length) {
      setShowErrors(true);
      const firstEl = questionRefs.current.get(missing[0]);
      if (firstEl) {
        firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setSubmitError(`${missing.length} required question${missing.length === 1 ? "" : "s"} still need an answer.`);
      return;
    }
    submitMut.mutate();
  }

  // Force a re-render when the form refs map fills in. Not strictly
  // needed — refs aren't part of state — but keeps the linter quiet
  // about questionRefs being declared and not "read" inside render.
  useEffect(() => { /* no-op */ }, [renderPlan]);

  if (asnQuery.isLoading || verQuery.isLoading) {
    return (
      <div className="px-4 py-6 space-y-4">
        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-32 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (asnQuery.isError || !assignment) {
    return (
      <div className="px-4 py-6 space-y-3">
        <p className="text-red-600 text-sm">
          Failed to load assignment: {(asnQuery.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/assignments" className="text-blue-600 hover:underline text-sm">
          ← Back to my assignments
        </Link>
      </div>
    );
  }

  // Guard: backend rejects createSubmission on cancelled/submitted.
  // Show a useful surface instead of letting the user fill out a dead form.
  if (assignment.status === "submitted" || assignment.status === "cancelled") {
    return (
      <div className="px-4 py-6 space-y-3">
        <p className="text-sm">
          This assignment is <strong>{assignment.status}</strong> and can't be filled out here.
        </p>
        <Link
          to={`/assignments/${id}`}
          className="text-blue-600 hover:underline text-sm"
        >
          ← Back to assignment
        </Link>
      </div>
    );
  }

  return (
    // Negative margins kill the AppShell's container padding so the
    // form takes the full viewport width. Sticky header + footer sit
    // flush with the viewport edges on mobile, which is what users
    // expect from a SafetyCulture / Smartsheet-style fill experience.
    <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-8 lg:-mx-8 lg:-my-10 min-h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2 px-3 py-2.5 min-h-[48px]">
          <button
            type="button"
            onClick={() => navigate(`/assignments/${id}`)}
            className="flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 -ml-2"
            aria-label="Back to assignment"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {template?.name ?? "Submission"}
            </div>
          </div>
          {/* ⚠️ UNCERTAIN: 3-dot menu (save draft / discard / help) will
              wire up in Checkpoint 2 alongside auto-save. For now the
              icon's a visual placeholder — clicking does nothing. */}
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 -mr-2"
            aria-label="More"
            disabled
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
        {/* Progress bar */}
        <div className="px-3 pb-2">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-1 bg-blue-600 transition-all duration-300"
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          </div>
          <div
            className="text-xs text-gray-500 mt-1 tabular-nums"
            aria-live="polite"
          >
            {requiredAnswered} of {requiredTotal} required answered
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 px-3 py-4 pb-28 space-y-6 sm:px-6">
        {renderPlan.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-12">
            This form has no questions to display.
          </div>
        )}

        {renderPlan.map((block, bIdx) => (
          <section key={block.kind === "section" ? block.section.id : `loose-${bIdx}`} className="space-y-3">
            {block.kind === "section" && (
              <h2 className="text-xs uppercase tracking-wider font-semibold text-gray-500 px-1">
                {block.section.label}
              </h2>
            )}
            {block.questions.map((q) => (
              <div
                key={q.id}
                ref={(el) => {
                  if (el) questionRefs.current.set(q.id, el);
                  else questionRefs.current.delete(q.id);
                }}
              >
                <QuestionCard
                  question={q}
                  answer={answers.get(q.id)}
                  showError={showErrors}
                  onChange={(patch) => setAnswer(q.id, patch)}
                />
              </div>
            ))}
          </section>
        ))}

        {submitError && (
          <div
            className="mx-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2"
            role="alert"
            aria-live="assertive"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{submitError}</div>
          </div>
        )}
      </main>

      {/* Sticky submit */}
      <footer className="sticky bottom-0 z-30 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] px-3 py-3 sm:px-6">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitMut.isPending}
          className="w-full h-12 rounded-md bg-blue-600 text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed hover:bg-blue-700 transition"
        >
          <Send className="h-4 w-4" />
          {submitMut.isPending ? "Submitting..." : "Submit"}
        </button>
      </footer>
    </div>
  );
}

// ─── Question card ──────────────────────────────────

function QuestionCard({
  question, answer, showError, onChange,
}: {
  question: TemplateQuestion;
  answer: LocalAnswer | undefined;
  showError: boolean;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const ft = question.field_type;
  const missing = showError && question.is_required && !hasAnswerValue(answer, question);

  return (
    <div
      className={
        "rounded-lg bg-white border p-4 space-y-3 " +
        (missing ? "border-red-300" : "border-gray-200")
      }
    >
      <div>
        <label className="block text-[15px] font-medium text-gray-900 leading-snug">
          {question.question_text}
          {question.is_required && <span className="text-red-600 ml-1" aria-label="required">*</span>}
        </label>
        {question.is_critical && ft === "pass_fail_na" && (
          <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Critical — a fail here flips the whole audit.
          </div>
        )}
      </div>

      {/* Field */}
      {ft === "short_text" && (
        <input
          type="text"
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
          className="w-full h-11 rounded-md border border-gray-300 px-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "long_text" && (
        <textarea
          value={answer?.answer_text ?? ""}
          onChange={(e) => onChange({ answer_text: e.target.value })}
          rows={3}
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
          className="w-full h-11 rounded-md border border-gray-300 px-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      {ft === "date" && (
        <input
          type="date"
          value={answer?.answer_date ?? ""}
          onChange={(e) => onChange({ answer_date: e.target.value || null })}
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
        <PassFailNaField answer={answer} onChange={onChange} />
      )}

      {ATTACHMENT_TYPES.has(ft) && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
          {ft === "photo" ? "Photo" : ft === "signature" ? "Signature" : "File"} capture
          ships in a follow-up checkpoint.
        </div>
      )}

      {missing && (
        <div className="text-sm text-red-600" role="alert">
          This is required
        </div>
      )}
    </div>
  );
}

// ─── Pass / Fail / N/A pills ────────────────────────────

function PassFailNaField({
  answer, onChange,
}: {
  answer: LocalAnswer | undefined;
  onChange: (patch: Partial<LocalAnswer>) => void;
}) {
  const val = answer?.audit_result ?? null;
  const opts: Array<{
    v: AuditResult; label: string; Icon: typeof Check;
    activeCls: string;
  }> = [
    {
      v: "pass", label: "Yes", Icon: Check,
      activeCls: "bg-green-600 text-white border-green-600",
    },
    {
      v: "fail", label: "No", Icon: X,
      activeCls: "bg-red-600 text-white border-red-600",
    },
    {
      v: "na", label: "N/A", Icon: Minus,
      activeCls: "bg-gray-600 text-white border-gray-600",
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map(({ v, label, Icon, activeCls }) => {
        const active = val === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange({ audit_result: v })}
            className={
              "min-h-[48px] inline-flex items-center justify-center gap-1.5 rounded-md border text-[15px] font-semibold transition " +
              (active
                ? activeCls
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
            }
            aria-pressed={active}
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
      <p className="text-xs text-amber-700">
        No options configured on this question.
      </p>
    );
  }
  return (
    <div className="space-y-1">
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
      <p className="text-xs text-amber-700">
        No options configured on this question.
      </p>
    );
  }
  return (
    <div className="space-y-1">
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

// Re-use the same helper from above for the QuestionCard. Kept here
// rather than imported because the file already owns the local
// `LocalAnswer` shape.
export { getAnswerValue };
