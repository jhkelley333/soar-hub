// Photos tab — three sections:
//   1. 10 required named slots (Front Elevation, etc.) shown as a grid
//      of thumbnails. Empty = "Add photo" call-to-action; filled =
//      thumbnail with a delete affordance.
//   2. 8 generic overflow slots, same grid pattern.
//   3. Per-item ad-hoc photos (scope_item_id set, photo_slot_id null) —
//      grouped under their checklist item label.
//
// Upload pipeline: tap → file picker (capture="environment" on mobile,
// so phones jump straight to the camera) → compress to ~1 MB →
// best-effort EXIF taken_at → upload → insert row → invalidate query.

import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  Loader2,
  Trash2,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { cn } from "@/lib/cn";
import {
  deleteScopePhoto,
  fetchPhotoSlots,
  fetchScopePhotos,
  fetchTemplateItems,
  getPhotoSignedUrl,
  uploadScopePhoto,
  type UploadPhotoInput,
} from "./api";
import { compressPhoto } from "./photoCompress";
import { readPhotoTakenAt } from "./exif";
import type {
  RenoScopePhoto,
  ScopeTemplateItem,
} from "./types";

interface Props {
  scopeId: string;
  templateId: string;
  canEdit: boolean;
}

export function PhotosTab({ scopeId, templateId, canEdit }: Props) {
  const queryClient = useQueryClient();

  const slotsQuery = useQuery({
    queryKey: ["reno-photo-slots", templateId],
    queryFn: () => fetchPhotoSlots(templateId),
    staleTime: 5 * 60_000,
  });
  const itemsQuery = useQuery({
    queryKey: ["reno-template-items", templateId],
    queryFn: () => fetchTemplateItems(templateId),
    staleTime: 5 * 60_000,
  });
  const photosQuery = useQuery({
    queryKey: ["reno-scope-photos", scopeId],
    queryFn: () => fetchScopePhotos(scopeId),
  });

  const uploadMutation = useMutation({
    mutationFn: (input: UploadPhotoInput) => uploadScopePhoto(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope-photos", scopeId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (photo: RenoScopePhoto) => deleteScopePhoto(photo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope-photos", scopeId] });
    },
  });

  const photos = photosQuery.data ?? [];
  const slots = slotsQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const photosBySlot = useMemo(() => {
    const m: Record<string, RenoScopePhoto> = {};
    for (const p of photos) {
      if (p.photo_slot_id) m[p.photo_slot_id] = p;
    }
    return m;
  }, [photos]);

  const photosByItem = useMemo(() => {
    const m: Record<string, RenoScopePhoto[]> = {};
    for (const p of photos) {
      if (p.scope_item_id) {
        (m[p.scope_item_id] = m[p.scope_item_id] ?? []).push(p);
      }
    }
    return m;
  }, [photos]);

  const requiredSlots = slots.filter((s) => s.is_required).sort((a, b) => a.sort_order - b.sort_order);
  const overflowSlots = slots.filter((s) => !s.is_required).sort((a, b) => a.sort_order - b.sort_order);

  // Only show item-photo sections for items that actually have photos
  // attached. Otherwise we'd render 27 empty buckets and clutter the page.
  const itemIdsWithPhotos = Object.keys(photosByItem);
  const itemsWithPhotos = items
    .filter((i) => itemIdsWithPhotos.includes(i.id))
    .sort((a, b) => a.sort_order - b.sort_order);

  if (slotsQuery.isLoading || photosQuery.isLoading || itemsQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  async function handleUpload(
    file: File,
    slotId: string | null,
    itemId: string | null,
    caption: string | null = null,
  ) {
    try {
      const compressed = await compressPhoto(file);
      const takenAt = await readPhotoTakenAt(compressed.blob);
      await uploadMutation.mutateAsync({
        scope_id: scopeId,
        photo_slot_id: slotId,
        scope_item_id: itemId,
        file: compressed.blob,
        filename: compressed.filename,
        taken_at: takenAt,
        caption,
      });
    } catch (e) {
      // Surface in the uploadMutation.error state below; nothing more to do
      // here because the mutation already captured it.
      console.error("[reno-scoping] photo upload failed", e);
    }
  }

  // Overflow uploads prompt for a short caption so the photo can be
  // identified later (e.g. "rusted DT handrail", "drain @ SE corner").
  // Caption is optional — submitting empty / cancelling still uploads
  // the photo with no caption, in which case the slot name shows as the
  // label.
  function handleOverflowUpload(file: File, slotId: string) {
    const raw = window.prompt(
      "Name this photo (optional — e.g. 'rusted DT handrail')",
      "",
    );
    if (raw === null) return; // user hit Cancel
    const caption = raw.trim() || null;
    return handleUpload(file, slotId, null, caption);
  }

  return (
    <div className="space-y-4">
      {uploadMutation.isError && (
        <Card className="bg-red-50 ring-red-200">
          <div className="flex items-start gap-2 p-3 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>{(uploadMutation.error as Error)?.message ?? "Upload failed. Try again."}</span>
          </div>
        </Card>
      )}

      <PhotoSection
        title="Required photos"
        subtitle="One per slot. Tap to capture."
      >
        <PhotoGrid
          cells={requiredSlots.map((slot) => ({
            key: slot.id,
            label: slot.slot_name,
            photo: photosBySlot[slot.id] ?? null,
            onUpload: (f) => handleUpload(f, slot.id, null),
            uploading: uploadMutation.isPending && uploadMutation.variables?.photo_slot_id === slot.id,
            onDelete: photosBySlot[slot.id]
              ? () => {
                  const photo = photosBySlot[slot.id];
                  if (window.confirm(`Delete photo for ${slot.slot_name}?`)) deleteMutation.mutate(photo);
                }
              : undefined,
            canEdit,
          }))}
        />
      </PhotoSection>

      <PhotoSection
        title="+Up / repair overflow"
        subtitle="Optional. Use for plus-up evidence or anything that doesn't fit a named slot. You'll be asked to name each photo."
      >
        <PhotoGrid
          cells={overflowSlots.map((slot) => {
            const photo = photosBySlot[slot.id] ?? null;
            // Caption (if set on upload) takes precedence over the
            // generic slot name so the user can tell the overflow
            // photos apart at a glance.
            const label = photo?.caption ?? slot.slot_name;
            return {
              key: slot.id,
              label,
              photo,
              onUpload: (f) => handleOverflowUpload(f, slot.id),
              uploading: uploadMutation.isPending && uploadMutation.variables?.photo_slot_id === slot.id,
              onDelete: photo
                ? () => {
                    if (window.confirm(`Delete photo "${label}"?`)) deleteMutation.mutate(photo);
                  }
                : undefined,
              canEdit,
            };
          })}
        />
      </PhotoSection>

      <ItemPhotosSection
        items={items}
        itemsWithPhotos={itemsWithPhotos}
        photosByItem={photosByItem}
        canEdit={canEdit}
        onUpload={handleUpload}
        onDelete={(photo, itemLabel) => {
          if (window.confirm(`Delete this photo from "${itemLabel}"?`)) deleteMutation.mutate(photo);
        }}
        uploadingItemId={
          uploadMutation.isPending && uploadMutation.variables?.scope_item_id
            ? uploadMutation.variables.scope_item_id
            : null
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// PhotoSection — labeled card around a PhotoGrid
// ----------------------------------------------------------------------------

function PhotoSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-midnight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// PhotoGrid — uniform thumbnail grid
// ----------------------------------------------------------------------------

interface PhotoCell {
  key: string;
  label: string;
  photo: RenoScopePhoto | null;
  onUpload: (file: File) => void | Promise<void>;
  uploading: boolean;
  onDelete?: () => void;
  canEdit: boolean;
}

function PhotoGrid({ cells }: { cells: PhotoCell[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map(({ key, ...rest }) => (
        <PhotoCellView key={key} {...rest} />
      ))}
    </div>
  );
}

function PhotoCellView({
  label,
  photo,
  onUpload,
  uploading,
  onDelete,
  canEdit,
}: PhotoCell) {
  const url = useSignedUrl(photo?.storage_path);

  return (
    <div className="space-y-1">
      <div className="group relative aspect-square overflow-hidden rounded-md bg-zinc-100 ring-1 ring-zinc-200">
        {photo && url ? (
          <>
            <img
              src={url}
              alt={label}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {canEdit && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
                aria-label="Delete photo"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </>
        ) : photo ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" strokeWidth={2} />
          </div>
        ) : (
          <label
            className={cn(
              "flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-xs text-zinc-500 transition",
              canEdit ? "hover:bg-zinc-50" : "cursor-not-allowed opacity-60",
            )}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" strokeWidth={2} />
            ) : (
              <>
                <Camera className="h-5 w-5 text-zinc-400" strokeWidth={1.75} />
                <span>Add photo</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={!canEdit || uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
        )}
      </div>
      <p className="line-clamp-1 text-[11px] text-zinc-500" title={label}>
        {label}
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Per-item ad-hoc photos
// ----------------------------------------------------------------------------

function ItemPhotosSection({
  items,
  itemsWithPhotos,
  photosByItem,
  canEdit,
  onUpload,
  onDelete,
  uploadingItemId,
}: {
  items: ScopeTemplateItem[];
  itemsWithPhotos: ScopeTemplateItem[];
  photosByItem: Record<string, RenoScopePhoto[]>;
  canEdit: boolean;
  onUpload: (file: File, slotId: string | null, itemId: string | null) => void | Promise<void>;
  onDelete: (photo: RenoScopePhoto, itemLabel: string) => void;
  uploadingItemId: string | null;
}) {
  // A simple "add a photo to any checklist item" picker — pick an item,
  // then snap. The full per-item photo picker UX (camera button on each
  // checklist row) is on the roadmap for a follow-up; this section keeps
  // ad-hoc uploads possible without leaving the Photos tab.
  const [pickItemId, setPickItemId] = useState<string>("");

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-midnight">Item photos</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Ad-hoc photos attached to a specific checklist item — typically for fail / needs-work
            documentation or plus-up evidence.
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 p-2 ring-1 ring-zinc-200">
            <select
              value={pickItemId}
              onChange={(e) => setPickItemId(e.target.value)}
              className="flex-1 rounded border-0 bg-white px-2 py-1.5 text-sm text-midnight ring-1 ring-inset ring-zinc-200 focus:ring-2 focus:ring-frost"
            >
              <option value="">Pick a checklist item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  #{i.sort_order} — {i.item_label}
                </option>
              ))}
            </select>
            <label
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-midnight px-3 py-1.5 text-xs font-medium text-white",
                pickItemId
                  ? "cursor-pointer hover:bg-midnight/90"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              {uploadingItemId === pickItemId && uploadingItemId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Camera className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Add photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={!pickItemId}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && pickItemId) {
                    void onUpload(f, null, pickItemId);
                    setPickItemId("");
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
            </label>
          </div>
        )}

        {itemsWithPhotos.length === 0 ? (
          <p className="text-xs text-zinc-500">No item-attached photos yet.</p>
        ) : (
          <div className="space-y-4">
            {itemsWithPhotos.map((it) => {
              const itemPhotos = photosByItem[it.id] ?? [];
              return (
                <div key={it.id} className="space-y-2">
                  <p className="text-xs font-medium text-zinc-700">
                    <span className="text-zinc-400">#{it.sort_order}</span>{" "}
                    {it.item_label}
                  </p>
                  <PhotoGrid
                    cells={itemPhotos.map((p, idx) => ({
                      key: p.id,
                      label: p.caption ?? `Photo ${idx + 1}`,
                      photo: p,
                      onUpload: () => {
                        /* no-op — item photos add via the picker above */
                      },
                      uploading: false,
                      onDelete: () => onDelete(p, it.item_label),
                      canEdit,
                    }))}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// useSignedUrl — react-query'd signed URL with 1h expiry
// ----------------------------------------------------------------------------

function useSignedUrl(storagePath: string | undefined): string | null {
  const q = useQuery({
    queryKey: ["reno-photo-signed-url", storagePath],
    queryFn: () => getPhotoSignedUrl(storagePath!),
    enabled: !!storagePath,
    staleTime: 50 * 60_000, // refresh shortly before the 1h URL expires
  });
  return q.data ?? null;
}
