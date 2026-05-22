// /assignments/:id/fill — the form-filling experience. Mobile-first,
// Smartsheet-style single-scroll layout: top bar + progress, sections
// as visual dividers, question cards, sticky Submit at the bottom.
// Conditional logic (show_if) hides/shows questions and whole sections
// live as the user answers.
//
// Checkpoint 3 additions:
//   ✓ Photo capture per question (compress + GPS + upload)
//   ✓ Flagged-response inline notes (pass_fail_na fail with
//     requires_cap_on_fail → required textarea) + optional photo
//   ✓ Live audit score chip in the top bar
//   ✓ Subtle slide/fade-in animation as questions appear from
//     conditional logic
//   ✗ Signature pad → Checkpoint 4
//   ✗ Desktop two-column layout → Checkpoint 4
//   ✗ Accessibility audit → Checkpoint 4

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Check, X, Minus, AlertTriangle, MoreVertical,
  CheckCircle2, XCircle, Cloud, CloudOff, Loader2, Trash2,
  Camera, ImageIcon, Paperclip, X as XIconClose,
} from "lucide-react";
import {
  getAssignment, getTemplateVersion, createSubmission,
  loadDraft, saveDraft, discardDraft,
  uploadAttachment, deleteAttachment, getAttachmentSignedUrl,
} from "./api";
import { shouldShow } from "./conditional";
import { compressImage, getCachedGeolocation, blobToBase64 } from "./photo";
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
  attachment_ids?: string[];
};

type SaveStatus = "idle" | "saving" | "saved" | "offline" | "error";

const SAVE_DEBOUNCE_MS = 2000;
const MAX_PHOTOS_PER_QUESTION = 5;
const SIGNED_URL_TTL_SECONDS = 3600;

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
  if (q.field_type === "photo" || q.field_type === "file") {
    return Array.isArray(a.attachment_ids) && a.attachment_ids.length > 0;
  }
  return a.answer_text != null && a.answer_text !== "";
}

// A flagged-fail question (pass_fail_na + requires_cap_on_fail) needs
// an inline note when the user marks it fail. The renderer enforces
// this client-side; the backend has the same rule for safety.
function flaggedFailNeedsNote(q: TemplateQuestion, a: LocalAnswer | undefined): boolean {
  if (q.field_type !== "pass_fail_na") return false;
  if (!q.requires_cap_on_fail) return false;
  if (a?.audit_result !== "fail") return false;
  return !a.answer_text || a.answer_text.trim() === "";
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

// Frontend-only audit preview. NOT authoritative — the backend
// recomputes on submit. Mirrors the scoring logic in
// netlify/functions/_lib/workspace_resolvers.js so the user sees the
// same number they'll get.
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
  let anyAnswered = false;
  for (const q of questions) {
    if (q.field_type !== "pass_fail_na") continue;
    if (!visibleQuestionIds.has(q.id)) continue;
    const a = answers.get(q.id);
    const w = q.weight ?? 1;
    if (a?.audit_result === "pass") {
      possible += w; earned += w; anyAnswered = true;
    } else if (a?.audit_result === "fail") {
      possible += w;
      if (q.is_critical) criticalFailed = true;
      anyAnswered = true;
    } else if (a?.audit_result === "na") {
      anyAnswered = true;
    }
  }
  const pct = possible > 0 ? Math.round((earned / possible) * 100) : 100;
  const threshold = template.audit_pass_threshold ?? 80;
  const passByScore = pct >= threshold;
  const flipsToFail = template.critical_fails_audit && criticalFailed;
  const outcome: "pass" | "fail" | "fail_critical" =
    flipsToFail ? "fail_critical" : passByScore ? "pass" : "fail";
  return { pct, threshold, possible, earned, criticalFailed, outcome, anyAnswered };
}

// Inline CSS for the conditional show/hide animation. Kept in the
// component file so we don't have to touch tailwind.config. The
// motion-safe wrapper respects users' reduce-motion preference.
const ANIMATION_CSS = `
@keyframes ws-fade-slide-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ws-anim-in { animation: ws-fade-slide-in 200ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .ws-anim-in { animation: none; }
}
`;

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
  const [attachmentUrls, setAttachmentUrls] = useState<Map<string, string>>(new Map());
  const [attachmentMetas, setAttachmentMetas] = useState<Map<string, { file_name: string; mime_type: string | null }>>(new Map());

  const answersRef = useRef(answers);
  const lastClientUpdatedAt = useRef<string>("");
  const saveTimerRef = useRef<number | null>(null);
  const questionRefs = useRef(new Map<string, HTMLDivElement>());
  const blobUrlsRef = useRef(new Set<string>());

  useEffect(() => { answersRef.current = answers; }, [answers]);

  // Clean up any object URLs we created for photo thumbnails on unmount,
  // so we don't leak memory across navigation.
  useEffect(() => {
    return () => {
      for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
      blobUrlsRef.current.clear();
    };
  }, []);

  const asnQuery = useQuery({
    queryKey: ["assignment", id],
    queryFn: () => getAssignment(id!),
    enabled: !!id,
  });
  const assignment = asnQuery.data?.assignment;
  const versionId = assignment?.template_version_id;
  const workspaceId = assignment?.workspace_id;

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
  // is freshest. Then fetch signed URLs for any photos referenced in
  // the draft so they show up in the thumbnails immediately.
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

    let local: { answers: LocalAnswer[]; client_updated_at: string; template_version_id: string } | null = null;
    try {
      const raw = localStorage.getItem(localKey(id));
      if (raw) local = JSON.parse(raw);
    } catch { /* ignore parse errors */ }
    if (local && local.template_version_id !== versionId) {
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
      const allAttachmentIds: string[] = [];
      for (const a of chosen.answers) {
        if (a && typeof a.question_id === "string") {
          map.set(a.question_id, a);
          if (Array.isArray(a.attachment_ids)) {
            for (const aid of a.attachment_ids) {
              if (typeof aid === "string") allAttachmentIds.push(aid);
            }
          }
        }
      }
      setAnswers(map);
      lastClientUpdatedAt.current = chosen.client_updated_at;
      setSaveStatus("saved");

      // Refresh signed URLs for any rehydrated attachments. Fire-and-
      // forget so a slow network doesn't gate the form being usable.
      void Promise.all(
        allAttachmentIds.map(async (aid) => {
          try {
            const res = await getAttachmentSignedUrl(aid, SIGNED_URL_TTL_SECONDS);
            return { aid, url: res.signed_url, attachment: res.attachment };
          } catch { return null; }
        }),
      ).then((results) => {
        setAttachmentUrls((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r.aid, r.url);
          return next;
        });
        setAttachmentMetas((prev) => {
          const next = new Map(prev);
          for (const r of results) {
            if (r) next.set(r.aid, { file_name: r.attachment.file_name, mime_type: r.attachment.mime_type });
          }
          return next;
        });
      });
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

  const { requiredTotal, requiredAnswered, missingRequiredIds, missingFlaggedNoteIds } = useMemo(() => {
    let total = 0;
    let answered = 0;
    const missingRequired: string[] = [];
    const missingFlagged: string[] = [];
    for (const q of questions) {
      if (!visibleQuestionIds.has(q.id)) continue;
      const a = answers.get(q.id);
      if (q.is_required) {
        total++;
        if (hasAnswerValue(a, q)) answered++;
        else missingRequired.push(q.id);
      }
      if (flaggedFailNeedsNote(q, a)) missingFlagged.push(q.id);
    }
    return {
      requiredTotal: total,
      requiredAnswered: answered,
      missingRequiredIds: missingRequired,
      missingFlaggedNoteIds: missingFlagged,
    };
  }, [questions, visibleQuestionIds, answers]);
  const pct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);

  const auditPreview = useMemo(
    () => computeAuditPreview(template, questions, answers, visibleQuestionIds),
    [template, questions, answers, visibleQuestionIds],
  );

  // ─── Autosave plumbing ──────────────────────────

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
      if (lastClientUpdatedAt.current === stamp) {
        setSaveStatus("saved");
      }
      void res;
    } catch {
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

  useEffect(() => {
    function onUnload() {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushSave();
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-menu-root]")) setShowMenu(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMenu]);

  // ─── Photo capture ──────────────────────────────

  async function addPhoto(qid: string, file: File) {
    if (!workspaceId) return;
    const current = answersRef.current.get(qid);
    const existing = (current?.attachment_ids ?? []).slice();
    if (existing.length >= MAX_PHOTOS_PER_QUESTION) {
      setSubmitError(`You can attach up to ${MAX_PHOTOS_PER_QUESTION} photos per question.`);
      return;
    }

    try {
      const { blob, name, mime } = await compressImage(file);
      const base64 = await blobToBase64(blob);
      const geo = await getCachedGeolocation();

      const res = await uploadAttachment({
        workspace_id: workspaceId,
        file_name: name,
        mime_type: mime,
        file_data_base64: base64,
        captured_at: new Date().toISOString(),
        geo_lat: geo?.lat,
        geo_lng: geo?.lng,
      });

      // Build a local blob URL for the immediate thumbnail — much
      // faster than waiting for a signed URL round-trip and looks
      // identical to the user.
      const blobUrl = URL.createObjectURL(blob);
      blobUrlsRef.current.add(blobUrl);
      setAttachmentUrls((prev) => new Map(prev).set(res.attachment.id, blobUrl));
      setAttachmentMetas((prev) => new Map(prev).set(res.attachment.id, {
        file_name: res.attachment.file_name, mime_type: res.attachment.mime_type,
      }));

      setAnswer(qid, { attachment_ids: [...existing, res.attachment.id] });
      setSubmitError(null);
    } catch (e) {
      setSubmitError((e as Error)?.message ?? "Photo upload failed.");
    }
  }

  async function removePhoto(qid: string, attachmentId: string) {
    const current = answersRef.current.get(qid);
    const ids = (current?.attachment_ids ?? []).filter((x) => x !== attachmentId);
    setAnswer(qid, { attachment_ids: ids });

    // Drop the URL we were showing locally.
    setAttachmentUrls((prev) => {
      const url = prev.get(attachmentId);
      if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(url);
      }
      const next = new Map(prev);
      next.delete(attachmentId);
      return next;
    });

    // Delete server-side. Best-effort: if it fails we still drop the
    // local reference so the user isn't stuck looking at a thumbnail
    // they can't recover.
    try { await deleteAttachment(attachmentId); } catch { /* ignore */ }
  }

  // ─── Actions ────────────────────────────────────

  const submitMut = useMutation({
    mutationFn: () => createSubmission({
      assignment_id: id!,
      answers: Array.from(answers.values()).filter(
        (a) => visibleQuestionIds.has(a.question_id),
      ) as Array<Partial<SubmissionAnswer> & { question_id: string }>,
    }),
    onSuccess: (data) => {
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
    if (missingFlaggedNoteIds.length) {
      setShowErrors(true);
      const firstEl = questionRefs.current.get(missingFlaggedNoteIds[0]);
      if (firstEl) firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setSubmitError(
        `${missingFlaggedNoteIds.length} flagged fail${missingFlaggedNoteIds.length === 1 ? "" : "s"} need a note explaining what went wrong.`,
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
    if (!window.confirm("Discard your in-progress answers? Any uploaded photos will be deleted too.")) return;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try { await discardDraft(id); } catch { /* ignore */ }
    localStorage.removeItem(localKey(id));
    // Revoke any blob URLs we still hold so we don't leak.
    for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
    blobUrlsRef.current.clear();
    setAnswers(new Map());
    setAttachmentUrls(new Map());
    setAttachmentMetas(new Map());
    lastClientUpdatedAt.current = "";
    setSaveStatus("idle");
  }

  async function restartFromScratch() {
    if (!id) return;
    try { await discardDraft(id); } catch { /* ignore */ }
    localStorage.removeItem(localKey(id));
    for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
    blobUrlsRef.current.clear();
    setAnswers(new Map());
    setAttachmentUrls(new Map());
    setAttachmentMetas(new Map());
    lastClientUpdatedAt.current = "";
    setStaleDraft(false);
    setSaveStatus("idle");
  }

  // ─── Render ─────────────────────────────────────

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
      <style>{ANIMATION_CSS}</style>

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
          {auditPreview && auditPreview.anyAnswered && (
            <LiveScoreChip
              pct={auditPreview.pct}
              outcome={auditPreview.outcome}
            />
          )}
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
          <section
            key={block.kind === "section" ? block.section.id : `loose-${bIdx}`}
            className="space-y-3 ws-anim-in"
          >
            {block.kind === "section" && (
              <h2 className="text-xs uppercase tracking-wider font-semibold text-gray-500 px-1">
                {block.section.label}
              </h2>
            )}
            {block.questions.map((q) => (
              <div
                key={q.id}
                className="ws-anim-in"
                ref={(el) => {
                  if (el) questionRefs.current.set(q.id, el);
                  else questionRefs.current.delete(q.id);
                }}
              >
                <QuestionCard
                  question={q}
                  answer={answers.get(q.id)}
                  showError={showErrors}
                  attachmentUrls={attachmentUrls}
                  attachmentMetas={attachmentMetas}
                  workspaceId={workspaceId}
                  onChange={(patch) => setAnswer(q.id, patch)}
                  onAddPhoto={(file) => addPhoto(q.id, file)}
                  onRemovePhoto={(aid) => removePhoto(q.id, aid)}
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

// ─── Live score chip ──────────────────────────────────

function LiveScoreChip({
  pct, outcome,
}: { pct: number; outcome: "pass" | "fail" | "fail_critical" }) {
  const cls =
    outcome === "fail_critical" ? "bg-red-100 text-red-800 border-red-200"
    : outcome === "fail"        ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200";
  return (
    <div
      className={`hidden xs:inline-flex sm:inline-flex items-center px-2 py-1 rounded-md border text-xs font-semibold tabular-nums ${cls}`}
      aria-label={`Current audit score ${pct}%, ${outcome.replace("_", " ")}`}
    >
      {pct}%
    </div>
  );
}

// ─── Save status line ──────────────────────────────────

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

// ─── Success screen ────────────────────────────────────

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

// ─── Question card ──────────────────────────────────

function QuestionCard({
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
        <>
          <PassFailNaField answer={answer} onChange={onChange} />
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
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
          Signature capture ships in a follow-up checkpoint.
        </div>
      )}

      {missingRequired && (
        <div className="text-sm text-red-600" role="alert">
          This is required
        </div>
      )}
      {missingFlaggedNote && !missingRequired && (
        <div className="text-sm text-red-600" role="alert">
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
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2 ws-anim-in">
      <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wide">
        What went wrong?
        <span className="text-red-600 ml-1" aria-label="required">*</span>
      </label>
      <textarea
        value={answer?.answer_text ?? ""}
        onChange={(e) => onChange({ answer_text: e.target.value })}
        rows={2}
        placeholder="Brief description — this gets attached to the CAP."
        className={
          "w-full rounded-md border px-3 py-2 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent " +
          (missing ? "border-red-400" : "border-amber-300")
        }
      />
      <div>
        <label className="block text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
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
          "inline-flex items-center gap-2 h-10 px-3 rounded-md border text-sm font-medium transition " +
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
        <div className="text-xs text-gray-500">Max {MAX_PHOTOS_PER_QUESTION} reached.</div>
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
        <a href={url} target="_blank" rel="noopener noreferrer" className="block w-full h-full">
          <img src={url} alt={meta?.file_name ?? "attachment"} className="w-full h-full object-cover" />
        </a>
      ) : (
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-[10px] text-gray-600 hover:bg-gray-100"
        >
          <ImageIcon className="h-6 w-6 mb-1" />
          <div className="truncate w-full">{meta?.file_name ?? "file"}</div>
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
      >
        <XIconClose className="h-3.5 w-3.5" />
      </button>
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
    { v: "pass", label: "Yes", Icon: Check, activeCls: "bg-green-600 text-white border-green-600" },
    { v: "fail", label: "No",  Icon: X,     activeCls: "bg-red-600 text-white border-red-600" },
    { v: "na",   label: "N/A", Icon: Minus, activeCls: "bg-gray-600 text-white border-gray-600" },
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
