import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// Selector for elements that can receive keyboard focus. Used by the
// Tab-key trap to know what's reachable inside the dialog.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side slide-out drawer. Replaces a centered modal when you want
 * to keep the page (e.g. a queue table) visible while reading detail.
 *
 * - ESC closes
 * - Backdrop click closes
 * - Body scroll locks while open
 * - Tab cycles within the dialog (focus trap)
 * - On open, focus moves to the first focusable element inside
 * - On close, focus returns to the element that opened the drawer
 * - On mobile (sm breakpoint) the drawer fills the screen
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = "w-full sm:max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Capture the trigger so we can restore focus on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog so screen readers + keyboard users
    // start inside it. requestAnimationFrame waits one paint for the
    // dialog to be in the DOM and visible.
    const raf = requestAnimationFrame(() => {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR
      );
      focusables?.[0]?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR
      );
      if (!nodes || nodes.length === 0) {
        // Nothing focusable in the dialog — keep focus from escaping.
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
      // Restore focus to the trigger on close so keyboard users don't
      // get teleported back to <body>. Skip if the trigger is gone
      // (rare — mostly happens during route changes).
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  // Browsers warn (and screen readers misbehave) when an element with
  // aria-hidden still owns focus. When the drawer closes — typically as
  // the result of clicking a button inside it — blur the descendant so
  // it doesn't get trapped behind aria-hidden on the wrapper.
  useEffect(() => {
    if (open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur();
    }
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      // Use the `inert` attribute when closed instead of aria-hidden:
      // inert prevents focus + interaction AND hides from assistive
      // tech, without the focus-trapped warning aria-hidden produces.
      // Cast through unknown because TS DOM lib types lag behind the
      // standard on this attribute.
      {...({ inert: open ? undefined : "" } as Record<string, unknown>)}
    >
      <div
        className={`absolute inset-0 bg-zinc-900/40 transition-opacity ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={`absolute right-0 top-0 flex h-full ${width} flex-col bg-white shadow-2xl ring-1 ring-black/5 transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2
            id="drawer-title"
            className="text-base font-semibold tracking-tight text-midnight"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
