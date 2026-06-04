// Walkthrough builder — wizard orchestrator.
//
// Four steps: Details → Sections → Scoring → Review. The draft lives
// in useTemplateDraft (localStorage-backed); Save persists to
// walkthrough_templates. An inactive template saves as a draft even if
// incomplete; activating it requires a clean validation pass.
//
// Global rules (photo-on-fail, allow-N/A) live inside the Scoring step.

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Eye, Loader2, Save } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { getTemplate, saveTemplate } from "./api";
import { emptyDraft } from "./types";
import { useTemplateDraft } from "./useTemplateDraft";
import { StepDetails } from "./steps/StepDetails";
import { StepStructure } from "./steps/StepStructure";
import { StepScoring } from "./steps/StepScoring";
import { StepReview } from "./steps/StepReview";
import { WalkthroughPreview } from "../WalkthroughPreview";
import type { WalkthroughTemplate } from "../types";

const STEPS = [
  { id: "details", label: "Details" },
  { id: "structure", label: "Sections" },
  { id: "scoring", label: "Scoring" },
  { id: "review", label: "Review" },
] as const;

const LIST_PATH = "/admin/walkthrough-templates";

export function WalkthroughBuilderPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["wt-template", id],
    queryFn: () => getTemplate(id!),
    enabled: isEdit,
  });

  const initial = useMemo(
    () => (isEdit ? query.data ?? null : emptyDraft()),
    [isEdit, query.data],
  );
  const store = useTemplateDraft(initial, id);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const isLast = step === STEPS.length - 1;

  // Map the in-progress draft to the runtime template the field renders.
  const previewTemplate: WalkthroughTemplate | null = useMemo(() => {
    const d = store.draft;
    if (!d) return null;
    return {
      id: d.id ?? "preview",
      name: d.name,
      type: d.type,
      version: d.version,
      sections: d.sections,
      scoring: d.scoring,
      tiers: d.tiers,
      globalRules: d.globalRules,
    };
  }, [store.draft]);

  if (isEdit && query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!store.draft) return null;

  const { draft, validation } = store;
  const canActivate = !draft.name.trim()
    ? false
    : draft.isActive
      ? validation.ok
      : true;

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.push("Give the template a name first", "info");
      setStep(0);
      return;
    }
    if (draft.isActive && !validation.ok) {
      toast.push("Resolve the issues on Review before activating", "info");
      setStep(STEPS.length - 1);
      return;
    }
    setSaving(true);
    try {
      const savedId = await saveTemplate(draft);
      store.clearLocal();
      toast.push(draft.isActive ? "Template published" : "Draft saved", "success");
      navigate(LIST_PATH);
      void savedId;
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isEdit ? "Edit template" : "New walkthrough template"}
        description="Build the checklist GMs run in the field."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPreviewing(true)}>
              <Eye className="mr-1.5 h-4 w-4" />
              Preview
            </Button>
            <Button variant="ghost" onClick={() => navigate(LIST_PATH)}>
              Cancel
            </Button>
          </>
        }
      />

      {previewing && previewTemplate && (
        <WalkthroughPreview template={previewTemplate} onClose={() => setPreviewing(false)} />
      )}

      {/* Stepper */}
      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const state = i === step ? "current" : i < step ? "done" : "todo";
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(i)}
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                    state === "current" && "bg-accent text-accent-fg",
                    state === "done" && "bg-accent/15 text-accent",
                    state === "todo" && "bg-zinc-100 text-zinc-400",
                  )}
                >
                  {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    state === "current" ? "font-semibold text-midnight" : "text-zinc-500",
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-zinc-200" />}
            </li>
          );
        })}
      </ol>

      {/* Active step */}
      <div className="min-h-[24vh]">
        {step === 0 && <StepDetails store={store} />}
        {step === 1 && <StepStructure store={store} />}
        {step === 2 && <StepScoring store={store} />}
        {step === 3 && <StepReview store={store} />}
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-4">
        <Button
          variant="secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save
          </Button>
          {isLast ? (
            <Button onClick={save} disabled={saving || !canActivate}>
              {draft.isActive ? "Publish" : "Save draft"}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Next
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
