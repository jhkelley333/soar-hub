// The editor for a template version — the heart of the template
// builder. Two sections: Questions and Approval Steps. Both use a
// full-replace pattern: edit locally, click Save to call upsert with
// the full array. Backend rejects edits on non-draft versions; this
// component switches to read-only when readOnly=true.

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Save, FileQuestion, ListChecks,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getTemplateVersion,
  upsertQuestions,
  upsertApprovalSteps,
} from "./api";
import { QuestionEditor } from "./QuestionEditor";
import { ApprovalStepEditor } from "./ApprovalStepEditor";
import type {
  TemplateVersion,
  TemplateQuestion,
  TemplateApprovalStep,
  TemplateType,
} from "./types";

type LocalQuestion = Omit<TemplateQuestion, "id" | "version_id" | "created_at" | "position"> & {
  _key: string;  // local stable key for React, distinct from server id
};

type LocalStep = Omit<TemplateApprovalStep, "id" | "version_id" | "created_at" | "step_number"> & {
  _key: string;
};

function makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newQuestion(type: TemplateType): LocalQuestion {
  return {
    _key: makeKey(),
    section_label: null,
    question_text: "",
    field_type: type === "audit" ? "pass_fail_na" : "short_text",
    is_required: false,
    weight: type === "audit" ? 1 : null,
    is_critical: false,
    requires_cap_on_fail: false,
    cap_assignee_rule: null,
    field_config: null,
    conditional_logic: null,
  };
}

function newStep(): LocalStep {
  return {
    _key: makeKey(),
    label: "",
    approver_rule: { kind: "role_relative", role: "do", anchor: "submission_store" },
    any_can_approve: true,
  };
}

export function VersionEditor({
  templateName, templateType, version, readOnly, onBack,
}: {
  templateId: string;
  templateName: string;
  templateType: TemplateType;
  version: TemplateVersion;
  readOnly: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"questions" | "steps">("questions");
  const [questions, setQuestions] = useState<LocalQuestion[]>([]);
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["template-version", version.id],
    queryFn: () => getTemplateVersion(version.id),
  });

  // Sync server data into local state on first load (and on any
  // refetch). Resets the dirty flag so we don't trip "unsaved" prompts
  // after a fresh load.
  useEffect(() => {
    if (!query.data) return;
    setQuestions(
      query.data.questions.map((q) => ({
        _key: q.id, // server id doubles as React key
        section_label: q.section_label,
        question_text: q.question_text,
        field_type: q.field_type,
        is_required: q.is_required,
        weight: q.weight,
        is_critical: q.is_critical,
        requires_cap_on_fail: q.requires_cap_on_fail,
        cap_assignee_rule: q.cap_assignee_rule,
        field_config: q.field_config,
        conditional_logic: q.conditional_logic,
      })),
    );
    setSteps(
      query.data.approval_steps.map((s) => ({
        _key: s.id,
        label: s.label,
        approver_rule: s.approver_rule,
        any_can_approve: s.any_can_approve,
      })),
    );
    setDirty(false);
  }, [query.data]);

  const saveQ = useMutation({
    mutationFn: () => upsertQuestions(
      version.id,
      questions.map((q) => ({
        section_label: q.section_label,
        question_text: q.question_text,
        field_type: q.field_type,
        is_required: q.is_required,
        weight: q.weight,
        is_critical: q.is_critical,
        requires_cap_on_fail: q.requires_cap_on_fail,
        cap_assignee_rule: q.cap_assignee_rule,
        field_config: q.field_config,
        conditional_logic: q.conditional_logic,
      })),
    ),
    onSuccess: () => { setSaveError(null); setDirty(false); query.refetch(); },
    onError: (e) => setSaveError((e as Error)?.message ?? "Save failed."),
  });

  const saveS = useMutation({
    mutationFn: () => upsertApprovalSteps(
      version.id,
      steps.map((s) => ({
        label: s.label,
        approver_rule: s.approver_rule,
        any_can_approve: s.any_can_approve,
      })),
    ),
    onSuccess: () => { setSaveError(null); setDirty(false); query.refetch(); },
    onError: (e) => setSaveError((e as Error)?.message ?? "Save failed."),
  });

  function saveAll() {
    if (tab === "questions") saveQ.mutate();
    else                     saveS.mutate();
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[idx], next[target]] = [next[target], next[idx]];
    setQuestions(next);
    setDirty(true);
  }
  function deleteQuestion(idx: number) {
    setQuestions(questions.filter((_, i) => i !== idx));
    setDirty(true);
  }
  function updateQuestion(idx: number, patch: Partial<LocalQuestion>) {
    setQuestions(questions.map((q, i) => i === idx ? { ...q, ...patch } : q));
    setDirty(true);
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSteps(next);
    setDirty(true);
  }
  function deleteStep(idx: number) {
    setSteps(steps.filter((_, i) => i !== idx));
    setDirty(true);
  }
  function updateStep(idx: number, patch: Partial<LocalStep>) {
    setSteps(steps.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setDirty(true);
  }

  const saving = saveQ.isPending || saveS.isPending;

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => {
          if (dirty && !confirm("Discard unsaved changes?")) return;
          onBack();
        }}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to template
      </button>

      <PageHeader
        title={`${templateName} · v${version.version_number}`}
        description={`Editing the ${version.status} version of this ${templateType}.`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={
              version.status === "published" ? "info"
              : version.status === "draft"   ? "neutral"
              : "neutral"
            }>
              {version.status}
            </Badge>
            {!readOnly && (
              <Button onClick={saveAll} disabled={saving || !dirty}>
                <Save className="h-4 w-4 mr-1" />
                {saving ? "Saving..." : dirty ? `Save ${tab}` : "Saved"}
              </Button>
            )}
          </div>
        }
      />

      {readOnly && (
        <Card className="p-3 text-sm bg-blue-50 border-blue-200">
          This version is <strong>{version.status}</strong> and cannot be edited. To change anything,
          fork a new draft from the template page.
        </Card>
      )}

      {/* Tab bar */}
      <div className="border-b border-gray-200 flex gap-1">
        <button
          onClick={() => setTab("questions")}
          className={
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition " +
            (tab === "questions"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900")
          }
        >
          <FileQuestion className="h-4 w-4" />
          Questions ({questions.length})
        </button>
        <button
          onClick={() => setTab("steps")}
          className={
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition " +
            (tab === "steps"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-600 hover:text-gray-900")
          }
        >
          <ListChecks className="h-4 w-4" />
          Approval steps ({steps.length})
        </button>
      </div>

      {saveError && (
        <Card className="p-3 text-sm text-red-600 bg-red-50 border-red-200">
          {saveError}
        </Card>
      )}

      {/* Questions tab */}
      {tab === "questions" && (
        <div className="space-y-3">
          {questions.length === 0 && (
            <Card className="p-6 text-center text-sm text-gray-500">
              No questions yet. {readOnly ? "" : "Click Add question to get started."}
            </Card>
          )}
          {questions.map((q, idx) => (
            <QuestionEditor
              key={q._key}
              question={q}
              index={idx}
              total={questions.length}
              templateType={templateType}
              readOnly={readOnly}
              onUpdate={(patch) => updateQuestion(idx, patch)}
              onDelete={() => deleteQuestion(idx)}
              onMoveUp={() => moveQuestion(idx, -1)}
              onMoveDown={() => moveQuestion(idx, 1)}
            />
          ))}
          {!readOnly && (
            <Button
              variant="secondary"
              onClick={() => {
                setQuestions([...questions, newQuestion(templateType)]);
                setDirty(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Add question
            </Button>
          )}
        </div>
      )}

      {/* Approval steps tab */}
      {tab === "steps" && (
        <div className="space-y-3">
          {steps.length === 0 && (
            <Card className="p-6 text-center text-sm text-gray-500">
              No approval steps. Submissions on this version will auto-approve on submit.
              {readOnly ? "" : " Click Add step to add a sign-off chain."}
            </Card>
          )}
          {steps.map((s, idx) => (
            <ApprovalStepEditor
              key={s._key}
              step={s}
              index={idx}
              total={steps.length}
              readOnly={readOnly}
              onUpdate={(patch) => updateStep(idx, patch)}
              onDelete={() => deleteStep(idx)}
              onMoveUp={() => moveStep(idx, -1)}
              onMoveDown={() => moveStep(idx, 1)}
            />
          ))}
          {!readOnly && (
            <Button
              variant="secondary"
              onClick={() => {
                setSteps([...steps, newStep()]);
                setDirty(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Add approval step
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
