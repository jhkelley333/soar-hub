// Swipe a conversation row to reveal quick actions. Pointer Events
// (touch + mouse + pen) with an axis lock so a vertical drag still scrolls
// the list and only a clearly-horizontal drag opens an action.
//   swipe LEFT  → trailing "Archive" (always available)
//   swipe RIGHT → leading "Read"     (only when onMarkRead is provided,
//                 i.e. the thread has unread messages)
// The row content stays a normal tappable button; we suppress its click
// when the gesture was a drag, or when an open row is tapped to close it.

import { useRef, useState, type ReactNode, type PointerEvent, type MouseEvent } from "react";
import { Archive, MailOpen } from "lucide-react";

const ACTION_W = 88; // px of action revealed behind the row
const OPEN_THRESHOLD = ACTION_W * 0.4; // drag past this snaps open
const AXIS_LOCK = 8; // px of movement before we commit to an axis

export function SwipeableRow({
  children,
  onArchive,
  onMarkRead,
  active = false,
}: {
  children: ReactNode;
  onArchive: () => void;
  onMarkRead?: () => void;
  active?: boolean;
}) {
  const [offset, setOffset] = useState(0); // -ACTION_W (archive) .. 0 .. +ACTION_W (read)
  const [animating, setAnimating] = useState(false);

  const start = useRef({ x: 0, y: 0, base: 0 });
  const axis = useRef<"none" | "h" | "v">("none");
  const dragged = useRef(false);

  // Right-swipe is only allowed when there's a Read action to reveal.
  const maxOffset = onMarkRead ? ACTION_W : 0;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, base: offset };
    axis.current = "none";
    dragged.current = false;
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

    dragged.current = true;
    setOffset(Math.max(-ACTION_W, Math.min(maxOffset, start.current.base + dx)));
  }

  function onPointerUp(e: PointerEvent) {
    if (axis.current === "h") {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setAnimating(true);
      setOffset((o) => {
        if (o <= -OPEN_THRESHOLD) return -ACTION_W; // archive open
        if (o >= OPEN_THRESHOLD) return maxOffset; // read open (0 if disabled)
        return 0;
      });
    }
    axis.current = "none";
  }

  function close() {
    setAnimating(true);
    setOffset(0);
  }

  function onClickCapture(e: MouseEvent) {
    // A drag, or a tap on an already-open row, should never open the thread.
    if (dragged.current || offset !== 0) {
      e.preventDefault();
      e.stopPropagation();
      if (offset !== 0 && !dragged.current) close();
      dragged.current = false;
    }
  }

  return (
    <div className="relative overflow-hidden">
      {/* Leading action (swipe right) — mark read */}
      {onMarkRead && (
        <div className="absolute inset-y-0 left-0 flex" style={{ width: ACTION_W }}>
          <button
            type="button"
            onClick={() => {
              close();
              onMarkRead();
            }}
            aria-label="Mark as read"
            tabIndex={offset >= OPEN_THRESHOLD ? 0 : -1}
            className="flex w-full flex-col items-center justify-center gap-0.5 bg-frost-500 text-white"
          >
            <MailOpen className="h-5 w-5" strokeWidth={2} />
            <span className="text-[11px] font-semibold">Read</span>
          </button>
        </div>
      )}

      {/* Trailing action (swipe left) — archive */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: ACTION_W }}>
        <button
          type="button"
          onClick={() => {
            close();
            onArchive();
          }}
          aria-label="Archive conversation"
          tabIndex={offset <= -OPEN_THRESHOLD ? 0 : -1}
          className="flex w-full flex-col items-center justify-center gap-0.5 bg-amber-500 text-white"
        >
          <Archive className="h-5 w-5" strokeWidth={2} />
          <span className="text-[11px] font-semibold">Archive</span>
        </button>
      </div>

      {/* Foreground row. Opaque base hides the actions when closed; the
          active-thread tint sits above that base so it can't bleed through
          to reveal an action color. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? "transform 0.2s ease" : "none",
          touchAction: "pan-y",
        }}
        className="relative bg-surface-muted"
      >
        {active && <div className="pointer-events-none absolute inset-0 bg-frost-100/60" aria-hidden />}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
