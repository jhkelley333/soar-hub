// Swipe a chat message to the RIGHT to delete it. Pointer Events
// (touch + mouse + pen) with an axis lock so a vertical drag still scrolls
// the conversation and only a clearly-horizontal, rightward drag arms the
// delete. Past the trigger distance on release, onDelete fires (a soft
// delete — the bubble becomes a tombstone). Coexists with the long-press
// actions menu: a horizontal drag cancels the long-press timer, a stationary
// long-press never moves the row.

import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

const TRIGGER = 72; // px of right-swipe that commits the delete
const MAX = 104; // cap how far the bubble travels
const AXIS_LOCK = 8; // px before we commit to a horizontal/vertical axis

export function SwipeToDelete({
  children,
  enabled,
  onDelete,
}: {
  children: ReactNode;
  enabled: boolean;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const start = useRef({ x: 0, y: 0 });
  const axis = useRef<"none" | "h" | "v">("none");

  // Hooks above always run; only the gesture wiring is conditional.
  if (!enabled) return <>{children}</>;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "none";
    setAnimating(false);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.buttons === 0) return; // not pressed
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axis.current === "h") {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
    }
    if (axis.current !== "h") return; // vertical → let the list scroll
    setOffset(Math.max(0, Math.min(MAX, dx))); // right-only
  }

  function onPointerUp(e: PointerEvent) {
    if (axis.current === "h") {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setAnimating(true);
      if (offset >= TRIGGER) onDelete(); // committed — fire the delete
      setOffset(0); // snap back; the row turns into a tombstone on success
    }
    axis.current = "none";
  }

  const armed = offset >= TRIGGER;
  return (
    <div className="relative">
      {/* Delete indicator revealed on the left as the bubble slides right. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
        style={{ width: offset, opacity: offset ? 1 : 0 }}
        aria-hidden
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-white transition-colors",
            armed ? "bg-sonic" : "bg-sonic/50",
          )}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? "transform 0.18s ease" : "none",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
