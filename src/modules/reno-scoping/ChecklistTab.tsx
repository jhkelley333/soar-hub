// Checklist tab — 27 items grouped by tier (collapsible), with status
// radios, notes, optional cost, and a Plus-Up "Recommend?" toggle.
//
// Persistence: every change is mirrored to localStorage immediately
// (survives reload / signal blip) AND fired off to Supabase via a
// debounced upsert. Status icon at the top reflects the current sync
// state — saved / saving / offline.
//
// Lenticulars (#260) gets an "Optional for brick/stone" badge when the
// scope is on a brick_stone building — driven by
// required_for_building_types from the seed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CloudOff,
  Cloud,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { cn } from "@/lib/cn";
import {
  fetchScopeItems,
  fetchScopePhotos,
  fetchTemplateItems,
  uploadScopePhoto,
  upsertScopeItem,
  type UpsertScopeItemInput,
} from "./api";
import { compressPhoto } from "./photoCompress";
import { readPhotoTakenAt } from "./exif";
import {
  TIER_LABELS,
  TIER_ORDER,
  itemRequiredForBuilding,
  type BuildingType,
  type RenoScopeItem,
  type ScopeItemStatus,
  type ScopeTemplateItem,
  type ScopeTier,
} from "./types";
import {
  clearDraft,
  loadDraft,
  mergeDraftItem,
  saveDraft,
  type DraftItem,
  type DraftSnapshot,
} from "./draftStorage";
import { PreConSection } from "./PreConSection";

const SAVE_DEBOUNCE_MS = 600;

type SyncStatus = "idle" | "saving" | "saved" | "offline" | "error";

const STATUS_BUTTONS: { value: ScopeItemStatus; label: string; cls: string }[] = [
  { value: "pass",       label: "Pass",       cls: "data-[active=true]:bg-green-600 data-[active=true]:text-white data-[active=true]:ring-green-600" },
  { value: "fail",       label: "Fail",       cls: "data-[active=true]:bg-red-600 data-[active=true]:text-white data-[active=true]:ring-red-600" },
  { value: "needs_work", label: "Needs Work", cls: "data-[active=true]:bg-amber-500 data-[active=true]:text-white data-[active=true]:ring-amber-500" },
  { value: "na",         label: "N/A",        cls: "data-[active=true]:bg-zinc-500 data-[active=true]:text-white data-[active=true]:ring-zinc-500" },
];

interface Props {
  scopeId: string;
  templateId: string;
  buildingType: BuildingType;
  canEdit: boolean;
  scope: import("./types").RenoScope;
}

export function ChecklistTab({ scopeId, templateId, buildingType, canEdit, scope }: Props) {
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ["reno-template-items", templateId],
    queryFn: () => fetchTemplateItems(templateId),
    staleTime: 5 * 60_000,
  });
  const answersQuery = useQuery({
    queryKey: ["reno-scope-items", scopeId],
    queryFn: () => fetchScopeItems(scopeId),
  });
  // Same query key as PhotosTab — they share the cache, and uploads
  // from either tab invalidate the other.
  const photosQuery = useQuery({
    queryKey: ["reno-scope-photos", scopeId],
    queryFn: () => fetchScopePhotos(scopeId),
  });

  // Merge server answers + local draft into the working state. Server is
  // the baseline; draft items override (last-write-wins, surfaced via the
  // saveStatus pill if the server is ahead).
  const [working, setWorking] = useState<Record<string, DraftItem>>({});
  const workingRef = useRef<Record<string, DraftItem>>({});
  workingRef.current = working;
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [collapsed, setCollapsed] = useState<Record<ScopeTier, boolean>>({
    existing_condition: false,
    minimum_standard: false,
    plus_up: false,
    optional: false,
  });
  const debounceRef = useRef<number | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());

  // Hydrate working state from server + draft on first load.
  useEffect(() => {
    if (!answersQuery.data) return;
    const draft = loadDraft(scopeId);
    const merged: Record<string, DraftItem> = {};
    for (const a of answersQuery.data) {
      merged[a.template_item_id] = serverToDraft(a);
    }
    if (draft) {
      for (const [k, v] of Object.entries(draft.items)) {
        merged[k] = { ...(merged[k] ?? { template_item_id: k }), ...v };
      }
    }
    setWorking(merged);
  }, [answersQuery.data, scopeId]);

  const upsertMutation = useMutation({
    mutationFn: (input: UpsertScopeItemInput) => upsertScopeItem(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope-items", scopeId] });
    },
  });

  // Per-item photo upload (camera button on each row). Compresses +
  // reads EXIF, then writes via uploadScopePhoto with scope_item_id set.
  const photoUploadMutation = useMutation({
    mutationFn: async (args: { itemId: string; file: File }) => {
      const compressed = await compressPhoto(args.file);
      const takenAt = await readPhotoTakenAt(compressed.blob);
      return uploadScopePhoto({
        scope_id: scopeId,
        scope_item_id: args.itemId,
        file: compressed.blob,
        filename: compressed.filename,
        taken_at: takenAt,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope-photos", scopeId] });
    },
  });

  // Photo count per template_item_id for the camera-button badge.
  const photoCountByItem: Record<string, number> = {};
  for (const p of photosQuery.data ?? []) {
    if (p.scope_item_id) {
      photoCountByItem[p.scope_item_id] = (photoCountByItem[p.scope_item_id] ?? 0) + 1;
    }
  }

  function flushPending() {
    const ids = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (ids.length === 0) {
      setSyncStatus("saved");
      return;
    }
    setSyncStatus("saving");
    Promise.all(
      ids.map((id) => {
        const item = workingRef.current[id];
        if (!item) return Promise.resolve();
        const payload: UpsertScopeItemInput = {
          scope_id: scopeId,
          template_item_id: id,
          status: item.status ?? null,
          notes: item.notes ?? null,
          estimated_cost: item.estimated_cost ?? null,
          recommend_for_plus_up: item.recommend_for_plus_up ?? null,
        };
        return upsertMutation.mutateAsync(payload);
      }),
    )
      .then(() => {
        // If nothing new queued during the network call, clear the draft
        // and surface "saved". Anything queued during it stays in the
        // pendingRef and will get the next debounce window.
        if (pendingRef.current.size === 0) {
          clearDraft(scopeId);
          setSyncStatus("saved");
        }
      })
      .catch(() => {
        setSyncStatus(navigator.onLine ? "error" : "offline");
      });
  }

  function applyPatch(templateItemId: string, patch: Partial<Omit<DraftItem, "template_item_id">>) {
    if (!canEdit) return;
    setWorking((prev) => {
      const next = { ...prev };
      const existing = next[templateItemId] ?? { template_item_id: templateItemId };
      next[templateItemId] = { ...existing, ...patch, template_item_id: templateItemId };
      // mirror to localStorage immediately
      const draftSnap: DraftSnapshot = mergeDraftItem(
        loadDraft(scopeId),
        scopeId,
        templateItemId,
        patch,
      );
      saveDraft(draftSnap);
      pendingRef.current.add(templateItemId);
      setSyncStatus("saving");
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(flushPending, SAVE_DEBOUNCE_MS);
      return next;
    });
  }

  const grouped = useMemo(() => groupByTier(itemsQuery.data ?? [], buildingType), [
    itemsQuery.data,
    buildingType,
  ]);

  if (itemsQuery.isLoading || answersQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (itemsQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load checklist"
        description={(itemsQuery.error as Error)?.message ?? "Try again."}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SyncBadge status={syncStatus} />
      <PreConSection scope={scope} canEdit={canEdit} />
      {TIER_ORDER.map((tier) => {
        const tierItems = grouped[tier];
        if (!tierItems || tierItems.length === 0) return null;
        const counts = tierCounts(tierItems, working);
        return (
          <Card key={tier}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [tier]: !c[tier] }))}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                {collapsed[tier] ? (
                  <ChevronRight className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-400" strokeWidth={2} />
                )}
                <span className="text-sm font-semibold text-midnight">{TIER_LABELS[tier]}</span>
                <Badge tone="neutral">{counts.answered} / {counts.total}</Badge>
                {counts.fail > 0 && <Badge tone="danger">{counts.fail} fail</Badge>}
                {counts.needsWork > 0 && <Badge tone="warning">{counts.needsWork} needs work</Badge>}
              </div>
            </button>
            {!collapsed[tier] && (
              <div className="divide-y divide-zinc-100 border-t border-zinc-100">
                {tierItems.map((it) => (
                  <ChecklistRow
                    key={it.id}
                    item={it}
                    buildingType={buildingType}
                    state={working[it.id]}
                    photoCount={photoCountByItem[it.id] ?? 0}
                    onChange={(patch) => applyPatch(it.id, patch)}
                    onUploadPhoto={(file) =>
                      photoUploadMutation.mutateAsync({ itemId: it.id, file })
                    }
                    photoUploading={
                      photoUploadMutation.isPending &&
                      photoUploadMutation.variables?.itemId === it.id
                    }
                    disabled={!canEdit}
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------

function ChecklistRow({
  item,
  buildingType,
  state,
  photoCount,
  onChange,
  onUploadPhoto,
  photoUploading,
  disabled,
}: {
  item: ScopeTemplateItem;
  buildingType: BuildingType;
  state: DraftItem | undefined;
  photoCount: number;
  onChange: (patch: Partial<Omit<DraftItem, "template_item_id">>) => void;
  onUploadPhoto: (file: File) => Promise<unknown>;
  photoUploading: boolean;
  disabled: boolean;
}) {
  const required = itemRequiredForBuilding(item, buildingType);
  const showsRecommend = item.tier === "plus_up" || item.tier === "optional";
  const [notesOpen, setNotesOpen] = useState((state?.notes ?? "").length > 0);

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-zinc-400">#{item.sort_order}</span>
            <span className="text-sm font-medium text-midnight">{item.item_label}</span>
            {!required && item.applies_to_building_types.includes(buildingType) && (
              <Badge tone="info">Optional for {labelForBrickStone(buildingType)}</Badge>
            )}
            {item.tier === "optional" && <Badge tone="neutral">Optional</Badge>}
            {item.photo_required && <Badge tone="neutral">Photo required</Badge>}
          </div>
          {item.item_description && (
            <p className="mt-1 flex items-start gap-1 text-xs leading-snug text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" strokeWidth={2} />
              <span>{item.item_description}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_BUTTONS.map((b) => (
          <button
            key={b.value}
            type="button"
            disabled={disabled}
            data-active={state?.status === b.value}
            onClick={() => onChange({ status: state?.status === b.value ? null : b.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-60",
              "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
              b.cls,
            )}
          >
            {b.label}
          </button>
        ))}

        {showsRecommend && (
          <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700 ring-1 ring-zinc-200">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={!!state?.recommend_for_plus_up}
              disabled={disabled}
              onChange={(e) => onChange({ recommend_for_plus_up: e.target.checked })}
            />
            Recommend for project
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <CostInput
            value={state?.estimated_cost ?? null}
            disabled={disabled}
            onChange={(v) => onChange({ estimated_cost: v })}
          />
          <CameraButton
            count={photoCount}
            uploading={photoUploading}
            disabled={disabled}
            onPick={async (file) => {
              await onUploadPhoto(file);
            }}
          />
          <button
            type="button"
            onClick={() => setNotesOpen((o) => !o)}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-midnight hover:underline"
          >
            {notesOpen ? "Hide notes" : (state?.notes ? "Notes ✓" : "Add notes")}
          </button>
        </div>
      </div>

      {notesOpen && (
        <textarea
          value={state?.notes ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          placeholder="Field notes for this item…"
          className="w-full resize-none rounded-md border-0 bg-zinc-50 px-3 py-2 text-sm text-midnight ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-frost disabled:cursor-not-allowed"
        />
      )}
    </div>
  );
}

// Camera button shown to the right of the cost input on each checklist
// row. Tap → file picker (camera on mobile via capture="environment")
// → handles upload via the row's onUploadPhoto callback. Shows a small
// count badge when photos are already attached.
function CameraButton({
  count,
  uploading,
  disabled,
  onPick,
}: {
  count: number;
  uploading: boolean;
  disabled: boolean;
  onPick: (file: File) => Promise<void>;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ring-1 ring-inset transition",
        disabled
          ? "cursor-not-allowed bg-zinc-50 text-zinc-400 ring-zinc-200"
          : "cursor-pointer bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
      )}
      title="Attach a photo to this item"
    >
      {uploading ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <Camera className="h-3 w-3" strokeWidth={2} />
      )}
      {count > 0 && <span className="font-semibold">{count}</span>}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled || uploading}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await onPick(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function CostInput({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <div className="inline-flex items-center gap-1 text-xs text-zinc-500">
      <span>$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = text.trim() === "" ? null : Number(text);
          onChange(Number.isFinite(n as number) ? (n as number) : null);
        }}
        placeholder="Est."
        className="w-20 rounded border-0 bg-zinc-50 px-2 py-1 text-right text-zinc-700 ring-1 ring-inset ring-zinc-200 focus:bg-white focus:ring-2 focus:ring-frost disabled:cursor-not-allowed"
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sync badge
// ----------------------------------------------------------------------------

function SyncBadge({ status }: { status: SyncStatus }) {
  const map: Record<SyncStatus, { Icon: typeof Check; label: string; cls: string }> = {
    idle:    { Icon: CircleDashed, label: "Ready",            cls: "text-zinc-500" },
    saving:  { Icon: Loader2,      label: "Saving…",          cls: "text-zinc-600" },
    saved:   { Icon: Cloud,        label: "Saved",            cls: "text-green-700" },
    offline: { Icon: CloudOff,     label: "Offline — saved locally", cls: "text-amber-800" },
    error:   { Icon: TriangleAlert, label: "Save failed — retrying", cls: "text-red-700" },
  };
  const m = map[status];
  return (
    <div className={cn("inline-flex items-center gap-1.5 text-xs", m.cls)}>
      <m.Icon className={cn("h-3.5 w-3.5", status === "saving" && "animate-spin")} strokeWidth={2} />
      {m.label}
    </div>
  );
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function serverToDraft(r: RenoScopeItem): DraftItem {
  return {
    template_item_id: r.template_item_id,
    status: r.status,
    notes: r.notes,
    estimated_cost: r.estimated_cost,
    recommend_for_plus_up: r.recommend_for_plus_up,
  };
}

function groupByTier(
  items: ScopeTemplateItem[],
  buildingType: BuildingType,
): Partial<Record<ScopeTier, ScopeTemplateItem[]>> {
  const out: Partial<Record<ScopeTier, ScopeTemplateItem[]>> = {};
  for (const it of items) {
    if (!it.applies_to_building_types.includes(buildingType)) continue;
    (out[it.tier] = out[it.tier] ?? []).push(it);
  }
  for (const tier of Object.keys(out) as ScopeTier[]) {
    out[tier]!.sort((a, b) => a.sort_order - b.sort_order);
  }
  return out;
}

function tierCounts(
  items: ScopeTemplateItem[],
  state: Record<string, DraftItem>,
): { total: number; answered: number; fail: number; needsWork: number } {
  let answered = 0;
  let fail = 0;
  let needsWork = 0;
  for (const it of items) {
    const s = state[it.id]?.status;
    if (s) {
      answered += 1;
      if (s === "fail") fail += 1;
      if (s === "needs_work") needsWork += 1;
    }
  }
  return { total: items.length, answered, fail, needsWork };
}

function labelForBrickStone(bt: BuildingType): string {
  return bt === "brick_stone" ? "brick/stone" : bt;
}
