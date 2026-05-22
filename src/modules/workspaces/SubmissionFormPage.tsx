// /assignments/:id/fill — the form-filling experience. Mobile-first,
// Smartsheet-style single-scroll layout: top bar + progress, sections
// as visual dividers, question cards, sticky Submit at the bottom.
// Conditional logic (show_if) hides/shows questions and whole sections
// live as the user answers.
//
// Checkpoint 2 additions:
//   ✓ localStorage immediate write + debounced (2s) server saveDraft
//   ✓ Stale-draft detection: if the assignment's template version has
//     changed since the draft was saved, force a fresh start
//   ✓ Submit confirmation modal (preview of count + audit score)
//   ✓ Post-submit success screen (with score/outcome for audits)
//   ✓ 3-dot menu: Save now, Discard draft
//   ✗ Photos / signatures / file uploads → Checkpoint 3/4
//   ✗ Flagged-response inline note requirement → Checkpoint 3
//   ✗ Live audit score in top bar → Checkpoint 3 (preview-on-submit
//     for now)

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Check, X, Minus, AlertTriangle, MoreVertical,
  CheckCircle2, XCircle, Cloud, CloudOff, Loader2, Trash2,
} from "lucide-react";
import {
  getAssignment, getTemplateVersion, createSubmission,
  loadDraft, saveDraft, discardDraft,
} from "./api";
import { shouldShow } from "./conditional";
import type {
  TemplateQuestion, TemplateSection, AuditResult, SubmissionAnswer,
  WorkspaceSubmission, WorkspaceTemplate,
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

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

const ATTACHMENT_TYPES = new Set(["photo", "file", "signature"]);
const SAVE_DEBOUNCE_MS = 2000;

function localKey(assignmentId: string) {
  return `wsdraft:${assignmentId}`;
}

function hasAnswerValue(a: LocalAnswer | undefined, q: TemplateQuestion): boolean {
  if (!a) return false;
  if (q.field_type === "pass_fail_na") return a.audit_result != null;
  if (q.field_type === "select_many")  return Array.isArray(a.answer_json) && (a.answer_json as unknown[]).length > 0;
  if (q.field_type === "checkbox")     return typeof a.answer_boolean === "boolean";
  if (q.field_type === "number")       return a.answer_number != null;
  if (q.field_type === "date")         return !!a.answer_date;
  return a.answer_text != null && a.answer_text !== "";
}

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

// Frontend-only audit preview for the submit-confirmation modal. NOT
// authoritative — the backend recomputes on submit. Mirrors the
// scoring logic in netlify/functions/_lib/workspace_resolvers.js so
// the user sees the same number they'll get.
function computeAuditPreview(
  template: WorkspaceTemplate | undefined,
  questions: TemplateQuestion[],
  answers: Map<string, LocalAnswer>,
  visibleQuestionIds: Set<string>,
) {
  if (!template || template.type !== "audit") return null;
  let possible = 0;
  let earned = 0;
  let criticalFailed = false;
  for (const q of questions) {
    if (q.field_type !== "pass_fail_na") continue;
    if (!visibleQuestionIds.has(q.id)) continue;
    const a = answers.get(q.id);
    const w = q.weight ?? 1;
    if (a?.audit_result === "pass") {
      possible += w;
      earned += w;
    } else if (a?.audit_result === "fail") {
      possible += w;
      if (q.is_critical) criticalFailed = true;
    }
    // na / unanswered → neither earns nor counts toward possible.
  }
  const pct = possible > 0 ? Math.round((earned / possible) * 100) : 100;
  const threshold = template.audit_pass_threshold ?? 80;
  const passByScore = pct >= threshold;
  const flipsToFail = template.critical_fails_audit && criticalFailed;
  const outcome: "pass" | "fail" | "fail_critical" =
    flipsToFail ? "fail_critical" : passByScore ? "pass" : "fail";
  return { pct, threshold, possible, earned, criticalFailed, outcome };
}

export function SubmissionFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [answers, setAnswers] = useState<Map<string, LocalAnswer>>(new Map());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [staleDraft, setStaleDraft] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [submitted, setSubmitted] = useState<WorkspaceSubmission | null>(null);

  // Refs let our debounced save and beforeunload handler see the
  // current state without recreating timers on every keystroke.
  const answersRef = useRef(answers);
  const lastClientUpdatedAt = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);
  const questionRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => { answersRef.current = answers; }, [answers]);

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

  const draftQuery = useQuery({
    queryKey: ["submission-draft", id],
    queryFn: () => loadDraft(id!),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  const template = verQuery.data?.version.workspace_templates;
  const questions = useMemo(() => verQuery.data?.questions ?? [], [verQuery.data]);
  const sections = useMemo(() => verQuery.data?.sections ?? [], [verQuery.data]);

  const questionsByQid = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions],
  );

  // One-time hydrate: populate the answers Map from whichever source
  // is freshest (server draft vs. localStorage). Stale template
  // version forces a restart screen instead.
  useEffect(() => {
    if (initialized) return;
    if (!id || !versionId) return;
    if (asnQuery.isLoading || verQuery.isLoading || draftQuery.isLoading) return;

    const draft = draftQuery.data?.draft ?? null;
    const stale = draftQuery.data?.stale === true;
    if (stale) {
      setStaleDraft(true);
      setInitialized(true);
      return;
    }

    // localStorage mirror — may be newer than server if user was offline.
    let local: { answers: LocalAnswer[]; client_updated_at: string; template_version_id: string } | null = null;
    try {
      const raw = localStorage.getItem(localKey(id));
      if (raw) local = JSON.parse(raw);
    } catch { /* ignore parse errors */ }
    if (local && local.template_version_id !== versionId) {
      // localStorage is from a previous template version — discard.
      localStorage.removeItem(localKey(id));
      local = null;
    }

    let chosen: { answers: LocalAnswer[]; client_updated_at: string } | null = null;
    if (draft && local) {
      chosen = Date.parse(local.client_updated_at) > Date.parse(draft.client_updated_at)
        ? local
        : { answers: draft.answers as LocalAnswer[], client_updated_at: draft.client_updated_at };
    } else if (draft) {
      chosen = { answers: draft.answers as LocalAnswer[], client_updated_at: draft.client_updated_at };
    } else if (local) {
      chosen = local;
    }

    if (chosen) {
      const map = new Map<string, LocalAnswer>();
      for (const a of chosen.answers) {
        if (a && typeof a.question_id === "string") map.set(a.question_id, a);
      }
      setAnswers(map);
      lastClientUpdatedAt.current = chosen.client_updated_at;
      setSaveStatus("saved");
    }
    setInitialized(true);
  }, [
    initialized, id, versionId,
    asnQuery.isLoading, verQuery.isLoading, draftQuery.isLoading,
    draftQuery.data,
  ]);

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
      if (!shouldShow(s.conditional_logic, answers, questionsByQid)) continue;
      const hasVisibleChild = questions.some(
        (q) => q.section_id === s.id && visibleQuestionIds.has(q.id),
      );
      if (hasVisibleChild) out.add(s.id);
    }
    return out;
  }, [sections, answers, questionsByQid, questions, visibleQuestionIds]);

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

  const { requiredTotal, requiredAnswered, missingRequiredIds } = useMemo(() => {
    let total = 0;
    let answered = 0;
    const missing: string[] = [];
    for (const q of questions) {
      if (!q.is_required) continue;
      if (!visibleQuestionIds.has(q.id)) continue;
      total++;
      if (hasAnswerValue(answers.get(q.id), q)) answered++;
      else missing.push(q.id);
    }
    return { requiredTotal: total, requiredAnswered: answered, missingRequiredIds: missing };
  }, [questions, visibleQuestionIds, answers]);
  const pct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);

  const auditPreview = useMemo(
    () => computeAuditPreview(template, questions, answers, visibleQuestionIds),
    [template, questions, answers, visibleQuestionIds],
  );

  // ─── Autosave plumbing ──────────────────────────────

  function persistLocal(map: Map<string, LocalAnswer>, clientUpdatedAt: string) {
    if (!id || !versionId) return;
    try {
      localStorage.setItem(
        localKey(id),
        JSON.stringify({
          answers: Array.from(map.values()),
          client_updated_at: clientUpdatedAt,
          template_version_id: versionId,
        }),
      );
    } catch { /* quota or private-mode — non-fatal */ }
  }

  async function flushSave() {
    if (!id || !versionId) return;
    const stamp = lastClientUpdatedAt.current;
    setSaveStatus("saving");
    try {
      const res = await saveDraft({
        assignment_id: id,
        template_version_id: versionId,
        answers: Array.from(answersRef.current.values()) as Array<Record<string, unknown>>,
        client_updated_at: stamp,
      });
      // Only mark saved if no newer edit happened while the request was in flight.
      // `res.skipped` means the server already had a newer client_updated_at
      // (another tab/device); from this client's view we're still in sync.
      if (lastClientUpdatedAt.current === stamp) {
        setSaveStatus("saved");
      }
      void res;
    } catch {
      // Network or server error — localStorage already holds the
      // latest, so this is recoverable. Subsequent edits will retry.
      setSaveStatus("offline");
    }
  }

  function scheduleSave(nextMap: Map<string, LocalAnswer>) {
    const now = new Date().toISOString();
    lastClientUpdatedAt.current = now;
    persistLocal(nextMap, now);
    setSaveStatus("saving");
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  function setAnswer(qid: string, patch: Partial<LocalAnswer>) {
    setAnswers((prev) => {
      const next = new Map(prev);
      const existing = next.get(qid) ?? { question_id: qid };
      next.set(qid, { ...existing, question_id: qid, ...patch });
      scheduleSave(next);
      return next;
    });
  }

  // Best-effort: try to flush before the tab unloads. The browser
  // won't wait for fetch, but localStorage is already written
  // synchronously inside scheduleSave, so we don't lose data here —
  // this just gives the server a chance.
  useEffect(() => {
    function onUnload() {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Fire-and-forget. No await possible during unload.
      void flushSave();
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
    // flushSave reads refs, so we don't need it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the 3-dot menu on outside click.
  useEffect(() => {
    if (!showMenu) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-menu-root]")) setShowMenu(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMenu]);

  // ─── Actions ──────────────────────────────────────

  const submitMut = useMutation({
    mutationFn: () => createSubmission({
      assignment_id: id!,
      answers: Array.from(answers.values()).filter(
        (a) => visibleQuestionIds.has(a.question_id),
      ) as Array<Partial<SubmissionAnswer> & { question_id: string }>,
    }),
    onSuccess: (data) => {
      // Backend already deleted the draft row; clear our localStorage.
      if (id) localStorage.removeItem(localKey(id));
      setSubmitted(data.submission);
      setShowConfirm(false);
    },
    onError: (e) => {
      setSubmitError((e as Error)?.message ?? "Submit failed.");
      setShowConfirm(false);
    },
  });

  function openSubmitConfirm() {
    setSubmitError(null);
    if (missingRequiredIds.length) {
      setShowErrors(true);
      const firstEl = questionRefs.current.get(missingRequiredIds[0]);
      if (firstEl) firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setSubmitError(
        `${missingRequiredIds.length} required question${missingRequiredIds.length === 1 ? "" : "s"} still need an answer.`,
      );
      return;
    }
    setShowConfirm(true);
  }

  async function saveDraftNow() {
    setShowMenu(false);
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await flushSave();
  }

  async function discardDraftNow() {
    setShowMenu(false);
    if (!id) return;
    if (!window.confirm("Discard your in-progress answers? This cannot be undone.")) return;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try { await discardDraft(id); } catch { /* ignore — local clear matters */ }
    localStorage.removeItem(localKey(id));
    setAnswers(new Map());
    lastClientUpdatedAt.current = "";
    setSaveStatus("idle");
  }

  async function restartFromScratch() {
    if (!id) return;
    try { await discardDraft(id); } catch { /* ignore */ }
    localStorage.removeItem(localKey(id));
    setAnswers(new Map());
    lastClientUpdatedAt.current = "";
    setStaleDraft(false);
    setSaveStatus("idle");
  }

  // ─── Render ───────────────────────────────────────

  if (asnQuery.isLoading || verQuery.isLoading || draftQuery.isLoading) {
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

  if (assignment.status === "submitted" || assignment.status === "cancelled") {
    return (
      <div className="px-4 py-6 space-y-3">
        <p className="text-sm">
          This assignment is <strong>{assignment.status}</strong> and can't be filled out here.
        </p>
        <Link to={`/assignments/${id}`} className="text-blue-600 hover:underline text-sm">
          ← Back to assignment
        </Link>
      </div>
    );
  }

  // Stale draft: template was republished while user had work in
  // progress. Force a restart — scoring rules / questions may have
  // changed under them.
  if (staleDraft) {
    return (
      <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-8 lg:-mx-8 lg:-my-10 min-h-screen bg-gray-50 px-4 py-10 flex flex-col items-center justify-center">
        <div className="max-w-sm w-full bg-white rounded-lg border border-amber-200 p-5 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-amber-700 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Form updated
          </div>
          <p className="text-sm text-gray-700">
            This form was updated since you started. Your previous answers can't
            carry over because the questions or scoring may have changed.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={restartFromScratch}
              className="flex-1 h-11 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              Start fresh
            </button>
            <button
              type="button"
              onClick={() => navigate(`/assignments/${id}`)}
              className="h-11 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Post-submit success screen.
  if (submitted) {
    return (
      <SuccessScreen
        submission={submitted}
        template={template}
        assignmentId={id!}
      />
    );
  }

  return (
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
            <SaveStatusLine status={saveStatus} />
          </div>
          {/* 3-dot menu */}
          <div className="relative" data-menu-root>
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 -mr-2"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {showMenu && (
              <div
                className="absolute right-0 top-11 z-40 w-52 rounded-md border border-gray-200 bg-white shadow-lg py-1"
                role="menu"
              >
                <button
                  type="button"
                  onClick={saveDraftNow}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                  role="menuitem"
                >
                  <Cloud className="h-4 w-4 text-gray-500" />
                  Save draft now
                </button>
                <button
                  type="button"
                  onClick={discardDraftNow}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-red-50 text-red-700 flex items-center gap-2"
                  role="menuitem"
                >
                  <Trash2 className="h-4 w-4" />
                  Discard draft
                </button>
              </div>
            )}
          </div>
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
          <div className="text-xs text-gray-500 mt-1 tabular-nums" aria-live="polite">
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
          onClick={openSubmitConfirm}
          disabled={submitMut.isPending}
          className="w-full h-12 rounded-md bg-blue-600 text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed hover:bg-blue-700 transition"
        >
          <Send className="h-4 w-4" />
          {submitMut.isPending ? "Submitting..." : "Submit"}
        </button>
      </footer>

      {/* Submit confirmation modal */}
      {showConfirm && (
        <ConfirmSubmitModal
          requiredTotal={requiredTotal}
          requiredAnswered={requiredAnswered}
          totalVisible={visibleQuestionIds.size}
          totalAnswered={Array.from(answers.values()).filter((a) =>
            visibleQuestionIds.has(a.question_id)
            && hasAnswerValue(a, questionsByQid.get(a.question_id)!)
          ).length}
          audit={auditPreview}
          submitting={submitMut.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => submitMut.mutate()}
        />
      )}
    </div>
  );
}

// ─── Save status line ──────────────────────────────

function SaveStatusLine({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const map: Record<Exclude<SaveStatus, "idle">, { Icon: typeof Cloud; label: string; cls: string }> = {
    saving:  { Icon: Loader2,  label: "Saving…",            cls: "text-gray-500" },
    saved:   { Icon: Cloud,    label: "Saved",              cls: "text-gray-500" },
    offline: { Icon: CloudOff, label: "Offline — saved locally", cls: "text-amber-600" },
    error:   { Icon: CloudOff, label: "Save failed",        cls: "text-red-600" },
  };
  const { Icon, label, cls } = map[status];
  return (
    <div className={`text-[11px] flex items-center gap-1 ${cls}`} aria-live="polite">
      <Icon className={"h-3 w-3 " + (status === "saving" ? "animate-spin" : "")} />
      {label}
    </div>
  );
}

// ─── Submit confirmation modal ─────────────────────────

function ConfirmSubmitModal({
  requiredTotal, requiredAnswered, totalVisible, totalAnswered,
  audit, submitting, onCancel, onConfirm,
}: {
  requiredTotal: number;
  requiredAnswered: number;
  totalVisible: number;
  totalAnswered: number;
  audit: ReturnType<typeof computeAuditPreview>;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-md bg-white sm:rounded-lg rounded-t-lg shadow-xl">
        <div className="px-4 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Submit this form?</h2>
        </div>
        <div className="px-4 py-4 space-y-3 text-sm">
          <div className="space-y-1 text-gray-700">
            <div>{requiredAnswered} of {requiredTotal} required answered</div>
            <div className="text-gray-500">{totalAnswered} of {totalVisible} total questions answered</div>
          </div>

          {audit && (
            <div className={
              "rounded-md p-3 border " +
              (audit.outcome === "fail_critical" ? "border-red-300 bg-red-50"
                : audit.outcome === "fail"        ? "border-red-200 bg-red-50"
                                                  : "border-green-200 bg-green-50")
            }>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Audit preview</div>
              <div className="text-3xl font-bold tabular-nums">
                {audit.pct}%
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                Threshold {audit.threshold}% · {audit.earned} of {audit.possible} points
              </div>
              <div className="mt-2">
                <OutcomeBadge outcome={audit.outcome} />
              </div>
              {audit.criticalFailed && (
                <div className="mt-2 text-xs text-red-700 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Critical fail recorded.
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Once submitted, this form is locked for review. You can't edit it
            unless a reviewer requests a revision.
          </p>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 h-11 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 h-11 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: "pass" | "fail" | "fail_critical" }) {
  const map = {
    pass:           { cls: "bg-green-600 text-white",  label: "Pass" },
    fail:           { cls: "bg-red-600 text-white",    label: "Fail" },
    fail_critical:  { cls: "bg-red-700 text-white",    label: "Fail · Critical" },
  } as const;
  const { cls, label } = map[outcome];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ─── Success screen ────────────────────────────────

function SuccessScreen({
  submission, template, assignmentId,
}: {
  submission: WorkspaceSubmission;
  template: WorkspaceTemplate | undefined;
  assignmentId: string;
}) {
  const isAudit = template?.type === "audit";
  const outcome = submission.audit_outcome;
  const failed = outcome === "fail" || outcome === "fail_critical";
  const Icon = failed ? XCircle : CheckCircle2;
  const iconCls = failed ? "text-red-600" : "text-green-600";

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 sm:-my-8 lg:-mx-8 lg:-my-10 min-h-screen bg-gray-50 px-4 py-10 flex flex-col items-center">
      <div className="max-w-sm w-full bg-white rounded-lg border border-gray-200 p-6 space-y-4 shadow-sm">
        <div className="flex flex-col items-center text-center space-y-2">
          <Icon className={`h-12 w-12 ${iconCls}`} />
          <h1 className="text-lg font-semibold text-gray-900">
            {isAudit ? "Audit submitted" : "Form submitted"}
          </h1>
          <p className="text-sm text-gray-600">
            {submission.signoff_status === "approved"
              ? "Auto-approved — no signoff required."
              : "Sent for review. You'll be notified when a reviewer takes action."}
          </p>
        </div>

        {isAudit && submission.audit_score_percent != null && (
          <div className="border-t border-gray-200 pt-4 text-center space-y-2">
            <div className="text-4xl font-bold tabular-nums">
              {submission.audit_score_percent}%
            </div>
            <div className="text-xs text-gray-500">
              {submission.audit_score_total ?? 0} of {submission.audit_score_possible ?? 0} points
            </div>
            {outcome && <OutcomeBadge outcome={outcome} />}
            {submission.audit_critical_failed && (
              <div className="text-xs text-red-700 flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Critical fail recorded.
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Link
            to={`/assignments/${assignmentId}`}
            className="w-full h-11 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 inline-flex items-center justify-center"
          >
            View details
          </Link>
          <Link
            to="/assignments"
            className="w-full h-11 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center justify-center"
          >
            Back to assignments
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Question card ────────────────────────────────

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

// ─── Select-one radio list ──────────────────────────

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
