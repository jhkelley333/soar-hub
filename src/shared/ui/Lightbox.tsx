// Full-screen photo lightbox. Opens over everything (z-60), tap-backdrop
// or X to close, ESC to close, arrow keys / on-screen chevrons to page
// when there's more than one image. Body scroll locks while open.
//
// Deliberately dependency-free (no carousel lib) — the evidence grids
// only need view + page + close.

import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface LightboxPhoto {
  url: string;
  name?: string | null;
}

export function Lightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const count = photos.length;
  const has = count > 0 && index >= 0 && index < count;

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [index, count, onClose, onIndexChange]);

  if (!has) return null;
  const photo = photos[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
        aria-label="Close"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>

      {count > 1 && (
        <span
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-white"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.85rem)" }}
        >
          {index + 1} / {count}
        </span>
      )}

      <img
        src={photo.url}
        alt={photo.name ?? "Photo"}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[94vw] object-contain"
      />

      {count > 1 && index > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
      {count > 1 && index < count - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Next photo"
        >
          <ChevronRight className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
