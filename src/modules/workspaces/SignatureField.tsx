// src/modules/workspaces/SignatureField.tsx
//
// Canvas-based signature capture. On save we rasterize to PNG and pipe
// through the same uploadAttachment path that photos use, so the field
// behaves like any other attached-id column for storage + scoring.
//
// Split into two components on purpose: SignaturePad has the canvas +
// hooks, SignaturePreview is the "already signed" view. Keeping them
// distinct means the hook-call order is stable and we never have to
// reason about "what if useEffect runs before / after the early
// return".

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Check, Trash2 } from "lucide-react";

interface Point { x: number; y: number; }
type Stroke = Point[];

const PAD_HEIGHT = 160;       // px, mobile-first; canvas is full-width
const STROKE_WIDTH = 2.5;

export interface SignatureFieldProps {
  ids: string[];
  attachmentUrls: Map<string, string>;
  attachmentMetas: Map<string, { file_name: string; mime_type: string | null }>;
  disabled?: boolean;
  // onAdd is shared with the photo field — it takes a File, compresses
  // (no-op for already-small PNGs), and pushes the attachment_id onto
  // the answer's attachment_ids array. Signature is a single-image
  // field but we reuse the multi-id contract for simplicity.
  onAdd: (file: File) => void | Promise<void>;
  onRemove: (attachmentId: string) => void;
}

export function SignatureField(props: SignatureFieldProps) {
  if (props.ids.length > 0) {
    return <SignaturePreview {...props} />;
  }
  return <SignaturePad {...props} />;
}

function SignaturePreview({
  ids, attachmentUrls, attachmentMetas, disabled, onRemove,
}: SignatureFieldProps) {
  const aid = ids[0];
  const url = attachmentUrls.get(aid);
  const meta = attachmentMetas.get(aid);
  return (
    <div className="space-y-2">
      <div className="inline-block rounded-md border border-gray-200 bg-gray-50 p-2">
        {url ? (
          <img
            src={url}
            alt={meta?.file_name ?? "Signature"}
            className="max-h-24 object-contain"
          />
        ) : (
          <div className="text-xs text-gray-500">Signature saved.</div>
        )}
      </div>
      <div>
        <button
          type="button"
          onClick={() => onRemove(aid)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Replace signature"
        >
          <Trash2 className="h-4 w-4" />
          Replace signature
        </button>
      </div>
    </div>
  );
}

function SignaturePad({
  disabled, onAdd,
}: SignatureFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke>([]);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  // Setup + DPI scaling. Recomputed on resize so a tablet rotating
  // doesn't end up with a stretched / blurry pad.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    function resize() {
      if (!canvas || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(PAD_HEIGHT * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${PAD_HEIGHT}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.lineWidth = STROKE_WIDTH;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0f172a"; // slate-900
      }
      redrawAll();
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);
    return () => ro.disconnect();
    // redrawAll is stable across renders since it only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getCtx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function redrawAll() {
    const c = getCtx();
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    // Clearing has to use the css pixel size since ctx is dpr-scaled.
    const w = parseFloat(canvas.style.width) || canvas.width;
    const h = parseFloat(canvas.style.height) || canvas.height;
    c.clearRect(0, 0, w, h);
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      c.beginPath();
      c.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) c.lineTo(stroke[i].x, stroke[i].y);
      c.stroke();
    }
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || busy) return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    currentStrokeRef.current = [pointFromEvent(e)];
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const p = pointFromEvent(e);
    const stroke = currentStrokeRef.current;
    const last = stroke[stroke.length - 1];
    stroke.push(p);
    const c = getCtx();
    if (c && last) {
      c.beginPath();
      c.moveTo(last.x, last.y);
      c.lineTo(p.x, p.y);
      c.stroke();
    }
  }
  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentStrokeRef.current.length >= 2) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      setHasInk(true);
    }
    currentStrokeRef.current = [];
  }

  function clear() {
    strokesRef.current = [];
    setHasInk(false);
    redrawAll();
  }
  function undo() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setHasInk(strokesRef.current.some((s) => s.length >= 2));
    redrawAll();
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    setBusy(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Couldn't capture signature.");
      const name = `signature-${Date.now()}.png`;
      const file = new File([blob], name, { type: "image/png" });
      await onAdd(file);
      // After onAdd succeeds the parent re-renders us with ids.length
      // > 0, swapping to SignaturePreview. No need to clear locally.
    } catch {
      // The shared addPhoto path surfaces errors via the form's
      // submitError; nothing more to do here.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className="rounded-md border border-gray-300 bg-white"
        // touch-none stops touch scrolling while the user is drawing —
        // otherwise mobile Safari treats the swipe as a page scroll
        // and you can't capture a continuous stroke.
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block w-full cursor-crosshair"
          aria-label="Signature pad. Sign by clicking or touching and dragging."
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={busy || strokesRef.current.length === 0}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Undo last stroke"
        >
          <RotateCcw className="h-4 w-4" />
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={busy || !hasInk}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !hasInk || disabled}
          className="ml-auto inline-flex items-center gap-1.5 h-10 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {busy ? "Saving…" : "Save signature"}
        </button>
      </div>
    </div>
  );
}
