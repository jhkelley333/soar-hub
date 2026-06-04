// Walkthrough preview — renders a template through the exact field components
// a GM uses, so an author sees precisely what the walk looks like before
// publishing. Fully in-memory: no Dexie, no sync, no check-in gate, no submit.
// State is local and thrown away on close.
//
// Used by the builder ("Preview" while editing) and the template list
// ("Preview" a saved template). Driven by a WalkthroughTemplate object, so it
// doesn't care whether that template is a draft or persisted.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ChecklistItem } from "./ChecklistItem";
import { SectionPager } from "./SectionPager";
import { SectionNote } from "./SectionNote";
import { scoreDraft, sectionProgress } from "./scoring";
import { effectiveRule, requirementStatus } from "./rules";
import type { SectionStatus } from "./use-walkthrough-store";
import type {
  ItemResponse,
  ItemValue,
  LocalDraft,
  PhotoRecord,
  SectionResponse,
  WalkthroughTemplate,
} from "./types";

function seedSections(template: WalkthroughTemplate): SectionResponse[] {
  return template.sections.map((s) => ({
    code: s.code,
    note: "",
    items: s.items.map<ItemResponse>((it) => ({ itemCode: it.code, value: null, photoIds: [] })),
  }));
}

export function WalkthroughPreview({
  template,
  onClose,
}: {
  template: WalkthroughTemplate;
  onClose: () => void;
}) {
  const [sections, setSections] = useState<SectionResponse[]>(() => seedSections(template));
  const [activeIndex, setActiveIndex] = useState(0);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});

  // Reset if the template identity/shape changes (e.g. live builder edits).
  useEffect(() => {
    setSections(seedSections(template));
    setActiveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  // Revoke object URLs on unmount.
  useEffect(
    () => () => {
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u);
    },
    [],
  );

  const draft: LocalDraft = useMemo(
    () => ({
      assignmentId: "preview",
      templateId: template.id,
      templateVersion: template.version,
      storeSdi: "preview",
      checkInId: null,
      rev: 0,
      clientUpdatedAt: new Date().toISOString(),
      sections,
    }),
    [sections, template.id, template.version],
  );

  const score = useMemo(() => scoreDraft(draft, template), [draft, template]);

  const sectionStatuses: SectionStatus[] = useMemo(
    () =>
      sections.map((section) => {
        const tmpl = template.sections.find((s) => s.code === section.code);
        const prog = sectionProgress(section);
        let incomplete = false;
        let hasUnanswered = false;
        for (const resp of section.items) {
          const item = tmpl?.items.find((i) => i.code === resp.itemCode);
          if (!item) continue;
          const canNa = template.globalRules.allowNa && item.allowNa !== false;
          if (resp.value == null && !canNa) hasUnanswered = true;
          const rule = effectiveRule(item, resp.value, template.globalRules);
          if (rule && !requirementStatus(rule, resp).satisfied) incomplete = true;
        }
        return { code: section.code, name: tmpl?.name ?? section.code, ...prog, incomplete, hasUnanswered };
      }),
    [sections, template],
  );

  const activeSection = sections[activeIndex];
  const tmplSection = template.sections[activeIndex];
  const isLast = activeIndex === sections.length - 1;

  // --- local mutators ---
  function patchItem(sectionCode: string, itemCode: string, patch: Partial<ItemResponse>) {
    setSections((prev) =>
      prev.map((s) =>
        s.code !== sectionCode
          ? s
          : { ...s, items: s.items.map((i) => (i.itemCode === itemCode ? { ...i, ...patch } : i)) },
      ),
    );
  }
  function setItemValue(sectionCode: string, itemCode: string, value: ItemValue) {
    const item = template.sections.find((s) => s.code === sectionCode)?.items.find((i) => i.code === itemCode);
    const stillTriggers = item && effectiveRule(item, value, template.globalRules);
    patchItem(sectionCode, itemCode, { value, ...(stillTriggers ? {} : { reason: undefined }) });
  }
  function addPhoto(sectionCode: string, itemCode: string, file: Blob) {
    const id = `pv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = URL.createObjectURL(file);
    urlsRef.current[id] = url;
    setPhotoUrls((m) => ({ ...m, [id]: url }));
    setPhotos((prev) => [
      ...prev,
      {
        id,
        assignmentId: "preview",
        itemCode,
        meta: { at: new Date().toISOString(), lat: null, lng: null },
        uploadStatus: "uploaded",
        attempts: 0,
        createdAt: new Date().toISOString(),
        remoteUrl: url,
      },
    ]);
    const existing =
      sections.find((s) => s.code === sectionCode)?.items.find((i) => i.itemCode === itemCode)?.photoIds ?? [];
    patchItem(sectionCode, itemCode, { photoIds: [...existing, id] });
  }
  function removePhoto(sectionCode: string, itemCode: string, photoId: string) {
    const u = urlsRef.current[photoId];
    if (u) {
      URL.revokeObjectURL(u);
      delete urlsRef.current[photoId];
      setPhotoUrls((m) => {
        const { [photoId]: _drop, ...rest } = m;
        return rest;
      });
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    const existing =
      sections.find((s) => s.code === sectionCode)?.items.find((i) => i.itemCode === itemCode)?.photoIds ?? [];
    patchItem(sectionCode, itemCode, { photoIds: existing.filter((p) => p !== photoId) });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-midnight-900/70 backdrop-blur-sm">
      {/* Preview chrome */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4" />
          Field preview
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
        >
          <X className="h-4 w-4" />
          Close
        </button>
      </div>

      {/* Phone frame */}
      <div className="flex-1 overflow-hidden px-3 pb-3">
        <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden rounded-2xl bg-surface-muted shadow-2xl ring-1 ring-black/10">
          <div className="flex-1 overflow-y-auto">
            {/* Header (mirrors the runner, minus the sync pill) */}
            <div className="sticky top-0 z-20 border-b border-midnight-100 bg-white">
              <div className="flex items-center gap-3 px-4 h-12">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[17px] font-semibold leading-tight text-midnight-900">
                    {template.name || "Untitled template"}
                  </div>
                  <div className="truncate text-[11.5px] text-midnight-500">Preview · not submittable</div>
                </div>
                <span className={cn("rounded px-2 py-0.5 text-[11px] font-bold tabular-nums", tierText(score.tier))}>
                  {score.score}
                </span>
              </div>
            </div>

            {sections.length === 0 || !activeSection || !tmplSection ? (
              <div className="grid min-h-[40vh] place-items-center px-6 text-center text-[13px] text-midnight-400">
                Add sections and items to preview the walk.
              </div>
            ) : (
              <>
                <SectionPager
                  sections={sectionStatuses}
                  activeIndex={activeIndex}
                  onJump={(i) => setActiveIndex(i)}
                />
                <div className="px-4 pt-4 pb-28 space-y-2.5">
                  {activeSection.items.map((resp) => {
                    const item = tmplSection.items.find((i) => i.code === resp.itemCode);
                    if (!item) return null;
                    return (
                      <ChecklistItem
                        key={resp.itemCode}
                        item={item}
                        response={resp}
                        globalRules={template.globalRules}
                        photos={photos.filter((p) => p.itemCode === resp.itemCode)}
                        photoUrls={photoUrls}
                        onChange={(v) => setItemValue(activeSection.code, resp.itemCode, v)}
                        onReason={(r) => patchItem(activeSection.code, resp.itemCode, { reason: r })}
                        onNote={(n) => patchItem(activeSection.code, resp.itemCode, { note: n })}
                        onAddPhoto={(f) => addPhoto(activeSection.code, resp.itemCode, f)}
                        onRemovePhoto={(pid) => removePhoto(activeSection.code, resp.itemCode, pid)}
                        onRetryPhoto={() => {}}
                      />
                    );
                  })}
                  <SectionNote
                    value={activeSection.note ?? ""}
                    onChange={(v) =>
                      setSections((prev) => prev.map((s) => (s.code === activeSection.code ? { ...s, note: v } : s)))
                    }
                  />
                </div>
              </>
            )}
          </div>

          {sections.length > 0 && (
            <div className="border-t border-midnight-100 bg-white/95 px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className={cn(
                    "flex-1 h-11 rounded-lg ring-1 text-[14px] font-medium inline-flex items-center justify-center gap-1.5",
                    activeIndex === 0
                      ? "ring-midnight-100 text-midnight-300 bg-white"
                      : "ring-midnight-200 text-midnight-800 bg-white",
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => (isLast ? undefined : setActiveIndex((i) => Math.min(sections.length - 1, i + 1)))}
                  disabled={isLast}
                  className={cn(
                    "flex-[1.4] h-11 rounded-lg text-[14px] font-semibold inline-flex items-center justify-center gap-1.5",
                    isLast ? "bg-midnight-200 text-white/80" : "bg-midnight-900 text-white",
                  )}
                >
                  {isLast ? "End of walk (preview)" : `Next: ${template.sections[activeIndex + 1]?.name ?? ""}`}
                  {!isLast && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function tierText(tier: string): string {
  if (tier === "green") return "bg-tier-green/15 text-tier-green";
  if (tier === "yellow") return "bg-tier-yellow/15 text-tier-yellow";
  return "bg-tier-red/15 text-tier-red";
}
