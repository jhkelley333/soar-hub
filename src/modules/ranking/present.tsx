// Shared "recognition slide" pieces for the Ranker boards (Top Performers,
// 7 UP, Movers & Shakers): a slide-styled table and a full-screen capture
// modal with a one-click PNG download (html-to-image) plus a screenshot hint.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X, Download, Camera } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SlideCol<T> {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  cell: (row: T) => ReactNode;
  cellClassName?: string;
}

const alignCls = (a?: "left" | "center" | "right") =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

// A single recognition table styled like the printed slide: green title bar,
// tinted header row, banded body with hard borders. Renders on a white surface
// so it looks the same on screen and in the exported PNG (theme-independent).
export function SlideTable<T>({
  title, columns, rows, getKey,
}: {
  title: string;
  columns: SlideCol<T>[];
  rows: T[];
  getKey: (row: T, i: number) => string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border-2 border-green-700 bg-white">
      <div className="bg-green-600 px-4 py-2 text-center text-lg font-black tracking-tight text-black">
        {title}
      </div>
      <table className="w-full border-collapse text-sm text-black">
        <thead>
          <tr className="bg-green-100">
            {columns.map((c) => (
              <th key={c.key} className={cn("border border-green-700 px-3 py-1.5 font-bold", alignCls(c.align))}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={getKey(r, i)} className={i % 2 ? "bg-green-50/60" : "bg-white"}>
              {columns.map((c) => (
                <td key={c.key} className={cn("border border-green-700 px-3 py-1.5 tabular-nums", alignCls(c.align), c.cellClassName)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Full-screen capture modal. Children are the slide content; the toolbar offers
// a PNG download (rasterizes the card) and a hint to just screenshot the window.
export function PresentModal({
  open, onClose, filename, children, maxWidth = "max-w-[1400px]",
}: {
  open: boolean;
  onClose: () => void;
  filename: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const download = useCallback(async () => {
    if (!cardRef.current) return;
    setBusy(true); setErr(null);
    try {
      const { toPng } = await import("html-to-image"); // lazy — keeps the bundle lean
      const url = await toPng(cardRef.current, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't render the image — try a screenshot instead.");
    } finally {
      setBusy(false);
    }
  }, [filename]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center overflow-auto bg-zinc-900/80 p-4 sm:p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cn("mb-3 flex w-full items-center justify-between gap-3", maxWidth)}>
        <div className="flex items-center gap-2 text-xs text-white/80">
          <Camera className="h-4 w-4" />
          <span>Screenshot this card, or download it as a PNG.</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={download}
            disabled={busy}
            className={cn("inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-midnight hover:bg-zinc-100", busy && "opacity-50")}
          >
            <Download className="h-4 w-4" />{busy ? "Rendering…" : "Download PNG"}
          </button>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-white hover:bg-white/25" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {err && <div className={cn("mb-2 w-full rounded-lg bg-red-500/90 px-3 py-2 text-sm text-white", maxWidth)}>{err}</div>}
      {/* The capture target — white slide surface. */}
      <div ref={cardRef} className={cn("w-full rounded-xl bg-white p-6", maxWidth)}>
        {children}
      </div>
    </div>
  );
}
