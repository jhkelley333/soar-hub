// 360 Tour tab — upload equirectangular .jpg spheres, list them, render
// the selected one in a Pannellum viewer. Pannellum is lazy-loaded from
// the jsDelivr CDN on first mount.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { cn } from "@/lib/cn";
import {
  deleteScopeTour,
  fetchScopeTours,
  getTourSignedUrl,
  uploadScopeTour,
  type UploadTourInput,
} from "./api";
import { loadPannellum, type PannellumViewer } from "./pannellum";
import type { RenoScopeTour } from "./types";

const MAX_TOUR_BYTES = 30 * 1024 * 1024; // matches the 30 MB bucket cap

interface Props {
  scopeId: string;
  canEdit: boolean;
}

export function TourTab({ scopeId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const toursQuery = useQuery({
    queryKey: ["reno-scope-tours", scopeId],
    queryFn: () => fetchScopeTours(scopeId),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capturePosition, setCapturePosition] = useState("");
  const [picked, setPicked] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (input: UploadTourInput) => uploadScopeTour(input),
    onSuccess: (tour) => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope-tours", scopeId] });
      setSelectedId(tour.id);
      setCapturePosition("");
      setPicked(null);
      setUploadError(null);
    },
    onError: (err) => setUploadError((err as Error)?.message ?? "Upload failed."),
  });

  const deleteMutation = useMutation({
    mutationFn: (tour: RenoScopeTour) => deleteScopeTour(tour),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reno-scope-tours", scopeId] }),
  });

  // Auto-select the first tour when the list loads.
  useEffect(() => {
    if (!selectedId && toursQuery.data && toursQuery.data.length > 0) {
      setSelectedId(toursQuery.data[0].id);
    }
  }, [toursQuery.data, selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return toursQuery.data?.find((t) => t.id === selectedId) ?? null;
  }, [selectedId, toursQuery.data]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_TOUR_BYTES) {
      setUploadError(
        `File is ${(f.size / 1024 / 1024).toFixed(1)} MB — the 30 MB bucket cap is exceeded.`,
      );
      e.target.value = "";
      return;
    }
    setUploadError(null);
    setPicked(f);
  }

  function onSubmitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !capturePosition.trim()) return;
    uploadMutation.mutate({
      scope_id: scopeId,
      file: picked,
      filename: picked.name,
      contentType: picked.type || "image/jpeg",
      capture_position: capturePosition.trim(),
      sort_order: toursQuery.data?.length ?? 0,
    });
  }

  if (toursQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const tours = toursQuery.data ?? [];

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <form onSubmit={onSubmitUpload} className="space-y-3 p-4">
            <div>
              <h3 className="text-sm font-semibold text-midnight">Upload sphere</h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Equirectangular .jpg or .png exported from your 360 camera (Ricoh Theta, Insta360, etc.).
                30 MB cap.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="tour-file">Sphere file</Label>
                <Input
                  id="tour-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={onPick}
                />
                {picked && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {picked.name} · {(picked.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="tour-position">Capture position</Label>
                <Input
                  id="tour-position"
                  value={capturePosition}
                  onChange={(e) => setCapturePosition(e.target.value)}
                  placeholder="e.g. Front entrance facing parking"
                />
              </div>
            </div>
            {uploadError && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>{uploadError}</span>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!picked || !capturePosition.trim() || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {uploadMutation.isPending ? "Uploading…" : "Upload sphere"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tours.length === 0 ? (
        <Card>
          <div className="p-6 text-center text-sm text-zinc-500">
            No 360 spheres uploaded yet.
          </div>
        </Card>
      ) : (
        <>
          {/* Thumbnail strip + selector */}
          <Card>
            <div className="space-y-2 p-3">
              <div className="flex flex-wrap gap-1.5">
                {tours.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
                      selectedId === t.id
                        ? "bg-midnight text-white ring-midnight"
                        : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {t.capture_position}
                  </button>
                ))}
              </div>
              {selected && canEdit && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete "${selected.capture_position}"?`)) {
                        deleteMutation.mutate(selected);
                        setSelectedId(null);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Delete sphere
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {selected && <PannellumViewerCard tour={selected} />}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Pannellum viewer card
// ----------------------------------------------------------------------------

function PannellumViewerCard({ tour }: { tour: RenoScopeTour }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PannellumViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function mount() {
      try {
        const [api, signedUrl] = await Promise.all([
          loadPannellum(),
          getTourSignedUrl(tour.storage_path, 60 * 60),
        ]);
        if (cancelled || !containerRef.current) return;
        // Tear down any previous viewer before re-mounting.
        viewerRef.current?.destroy();
        viewerRef.current = api.viewer(containerRef.current, {
          type: "equirectangular",
          panorama: signedUrl,
          autoLoad: true,
          showControls: true,
          showZoomCtrl: true,
          showFullscreenCtrl: true,
          hfov: 100,
        });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error)?.message ?? "Failed to load sphere.");
        setLoading(false);
      }
    }

    mount();
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [tour.id, tour.storage_path]);

  return (
    <Card>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-midnight">{tour.capture_position}</p>
          <p className="text-[11px] text-zinc-400">
            Uploaded {new Date(tour.uploaded_at).toLocaleDateString()}
          </p>
        </div>
        <div
          className="relative aspect-video w-full overflow-hidden rounded-md bg-black"
          ref={containerRef}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
