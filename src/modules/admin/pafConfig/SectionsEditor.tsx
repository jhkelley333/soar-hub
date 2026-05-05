import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import type { PafFormConfig, SectionConfig } from "./types";

export function SectionsEditor({
  draft,
  onChange,
}: {
  draft: PafFormConfig;
  onChange: (next: PafFormConfig) => void;
}) {
  // Always render in current order. Reordering rewrites the .order field.
  const ordered = [...draft.sections].sort((a, b) => a.order - b.order);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = ordered.findIndex((s) => s.key === active.id);
    const toIdx = ordered.findIndex((s) => s.key === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = arrayMove(ordered, fromIdx, toIdx).map((s, i) => ({
      ...s,
      order: i + 1,
    }));
    onChange({ ...draft, sections: moved });
  }

  function patch(key: string, p: Partial<SectionConfig>) {
    onChange({
      ...draft,
      sections: draft.sections.map((s) =>
        s.key === key ? { ...s, ...p } : s
      ),
    });
  }

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Drag the handle to reorder. You can rename a section and add a
        description; you cannot delete sections or change which categories
        trigger them (that's wired to the cost calculation logic).
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={ordered.map((s) => s.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {ordered.map((s) => (
              <SortableSection
                key={s.key}
                section={s}
                triggers={draft.sectionTriggers?.[s.key] ?? []}
                onPatch={(p) => patch(s.key, p)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSection({
  section,
  triggers,
  onPatch,
}: {
  section: SectionConfig;
  triggers: string[];
  onPatch: (patch: Partial<SectionConfig>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.key });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="rounded-md border border-zinc-200 bg-white p-3"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab touch-none rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight active:cursor-grabbing"
          aria-label={`Drag ${section.title}`}
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`sec-${section.key}-title`}>Title</Label>
              <Input
                id={`sec-${section.key}-title`}
                value={section.title}
                onChange={(e) => onPatch({ title: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={`sec-${section.key}-desc`}>Description</Label>
              <Input
                id={`sec-${section.key}-desc`}
                value={section.description}
                onChange={(e) => onPatch({ description: e.target.value })}
                placeholder="Optional caption shown under the title"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400">
              Triggered by:
            </span>
            {triggers.length === 0 ? (
              <span className="text-zinc-400">—</span>
            ) : (
              triggers.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))
            )}
            <span className="ml-2 text-[10px] text-zinc-400">
              (read-only — wired to calculation logic)
            </span>
          </div>
        </div>
        <div className="text-xs font-mono text-zinc-400">#{section.order}</div>
      </div>
    </li>
  );
}
