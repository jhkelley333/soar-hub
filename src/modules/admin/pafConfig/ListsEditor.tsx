import { useMemo, useState } from "react";
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
import { GripVertical, Lock, Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { LIST_LABELS } from "./defaults";
import type { ListKey, PafFormConfig, PafLists, ReferralTier } from "./types";
import { cn } from "@/lib/cn";

const TABS: ListKey[] = [
  "categories",
  "positions",
  "bonusTypes",
  "payBases",
  "referralTiers",
  "statuses",
  "termTypes",
];

export function ListsEditor({
  draft,
  onChange,
}: {
  draft: PafFormConfig;
  onChange: (next: PafFormConfig) => void;
}) {
  const [active, setActive] = useState<ListKey>("categories");

  function setList(next: PafLists[ListKey]) {
    onChange({
      ...draft,
      lists: { ...draft.lists, [active]: next } as PafLists,
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              active === t
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:text-midnight"
            )}
          >
            {LIST_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      {active === "referralTiers" ? (
        <ReferralTierEditor
          tiers={(draft.lists.referralTiers ?? []) as ReferralTier[]}
          onChange={(next) => setList(next)}
        />
      ) : (
        <StringListEditor
          listKey={active}
          list={(draft.lists[active] ?? []) as string[]}
          lockedStatuses={draft.lists.lockedStatuses ?? []}
          onChange={(next) => setList(next)}
        />
      )}
    </div>
  );
}

function StringListEditor({
  listKey,
  list,
  lockedStatuses,
  onChange,
}: {
  listKey: ListKey;
  list: string[];
  lockedStatuses: string[];
  onChange: (next: string[]) => void;
}) {
  const lockedSet = useMemo(
    () =>
      listKey === "statuses" ? new Set(lockedStatuses) : new Set<string>(),
    [listKey, lockedStatuses]
  );

  return (
    <>
      <p className="mb-3 text-xs text-zinc-500">
        Drag items to reorder.
        {listKey === "statuses" && (
          <span>
            {" "}Locked statuses ({Array.from(lockedSet).join(", ")}) cannot be
            removed; they can be reordered.
          </span>
        )}
      </p>

      <SortableList items={list} lockedSet={lockedSet} onChange={onChange} />

      <AddRow
        onAdd={(value) => {
          const trimmed = value.trim();
          if (!trimmed) return;
          if (
            list.some(
              (existing) => existing.toLowerCase() === trimmed.toLowerCase()
            )
          ) {
            return;
          }
          onChange([...list, trimmed]);
        }}
      />
    </>
  );
}

// Object-row editor used only for the referralTiers list. Each row is
// {label, amount}. No dnd-kit reorder for now — order doesn't carry
// any semantic weight here, the form auto-fills the amount on selection.
function ReferralTierEditor({
  tiers,
  onChange,
}: {
  tiers: ReferralTier[];
  onChange: (next: ReferralTier[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  function add() {
    const lbl = label.trim();
    const amt = Number(amount);
    if (!lbl || !Number.isFinite(amt) || amt < 0) return;
    if (tiers.some((t) => t.label.toLowerCase() === lbl.toLowerCase())) return;
    onChange([...tiers, { label: lbl, amount: amt }]);
    setLabel("");
    setAmount("");
  }

  return (
    <>
      <p className="mb-3 text-xs text-zinc-500">
        Tiers auto-fill the bonus amount when selected on the form. Submitter
        can still override.
      </p>

      {tiers.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
          No tiers yet — add one below.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {tiers.map((t) => (
            <li
              key={t.label}
              className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-2"
            >
              <span className="flex-1 text-sm text-zinc-800">{t.label}</span>
              <span className="text-sm tabular-nums text-zinc-700">
                ${t.amount.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Remove "${t.label}"?`)) return;
                  onChange(tiers.filter((x) => x.label !== t.label));
                }}
                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Remove ${t.label}`}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Tier label (e.g. Crew Member)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          step="0.01"
          placeholder="Amount"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={!label.trim() || !amount}
        >
          <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
          Add
        </Button>
      </div>
    </>
  );
}

function SortableList({
  items,
  lockedSet,
  onChange,
}: {
  items: string[];
  lockedSet: Set<string>;
  onChange: (next: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = items.indexOf(String(active.id));
    const toIdx = items.indexOf(String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    onChange(arrayMove(items, fromIdx, toIdx));
  }

  function onRemove(value: string) {
    onChange(items.filter((x) => x !== value));
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
        No items yet — add one below.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {items.map((value) => (
            <SortableRow
              key={value}
              value={value}
              locked={lockedSet.has(value)}
              onRemove={() => {
                if (!window.confirm(`Remove "${value}"?`)) return;
                onRemove(value);
              }}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  value,
  locked,
  onRemove,
}: {
  value: string;
  locked: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: value });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight active:cursor-grabbing"
        aria-label={`Drag ${value}`}
      >
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <span className="flex-1 text-sm text-zinc-800">{value}</span>
      {locked ? (
        <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
          <Lock className="h-3 w-3" strokeWidth={2} />
          Locked
        </span>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
          aria-label={`Remove ${value}`}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

function AddRow({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-3 flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add new item"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd(value);
            setValue("");
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onAdd(value);
          setValue("");
        }}
        disabled={!value.trim()}
      >
        <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
        Add
      </Button>
    </div>
  );
}
