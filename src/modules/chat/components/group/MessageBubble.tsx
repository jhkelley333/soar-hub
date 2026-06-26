// Chat — message bubble. Sent (you) = navy, right; received = light,
// left, with avatar + name on the first message of a run. @mentions are
// highlighted (cherry received, frost sent). Attachments render above
// the text bubble; a text bubble only appears when there's text.

import { useRef } from "react";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "../../types";
import type { ChatUserLite } from "../../api";
import { AttachmentView } from "./AttachmentView";
import { formatChatTime } from "../../time";

// Long-press (touch) / right-click (desktop) to surface the message actions
// menu. A small move cancels so it never hijacks a scroll.
function useLongPress(onLong: (() => void) | undefined, enabled: boolean) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  if (!enabled || !onLong) return {} as React.HTMLAttributes<HTMLDivElement>;
  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        onLong();
        clear();
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (
        start.current &&
        (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8)
      ) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onLong();
    },
  } as React.HTMLAttributes<HTMLDivElement>;
}

function renderText(text: string, sent: boolean) {
  return text.split(/(@\w+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className={cn("font-semibold", sent ? "text-frost-300" : "text-sonic")}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function MessageBubble({
  message,
  sent,
  user,
  showName,
  showAvatar,
  canDelete = false,
  onRequestActions,
}: {
  message: ChatMessage;
  sent: boolean;
  user?: ChatUserLite;
  showName: boolean;
  showAvatar: boolean;
  /** Caller may delete this message — enables the long-press actions menu. */
  canDelete?: boolean;
  /** Open the actions menu (long-press / right-click). */
  onRequestActions?: () => void;
}) {
  const atts = message.attachments ?? [];
  const hasText = Boolean(message.text && message.text.trim());
  const press = useLongPress(onRequestActions, canDelete && !message.deleted);

  if (sent) {
    return (
      <div className="mt-1 flex flex-col items-end gap-1">
        {message.deleted ? (
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-midnight-100 px-3.5 py-2 text-[13px] italic leading-snug text-midnight-400">
            You deleted this message
          </div>
        ) : (
          <>
            {atts.map((a) => (
              <div key={a.id} {...press} className="max-w-[80%]">
                <AttachmentView att={a} sent />
              </div>
            ))}
            {hasText && (
              <div
                {...press}
                className="max-w-[80%] cursor-default select-none rounded-2xl rounded-br-md bg-midnight-900 px-3.5 py-2 text-[14px] leading-snug text-white"
              >
                {renderText(message.text, true)}
              </div>
            )}
          </>
        )}
        <span className="mr-1 mt-0.5 text-[10.5px] text-midnight-400">{formatChatTime(message.at)}</span>
      </div>
    );
  }

  return (
    <div className="mt-1 flex gap-2">
      <div className="w-8 shrink-0">
        {showAvatar && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-frost-100 text-[11px] font-semibold text-midnight-700">
            {user?.initials ?? "?"}
          </div>
        )}
      </div>
      <div className="min-w-0">
        {showName && (
          <p className="mb-0.5 ml-1 text-[12px] font-medium text-midnight-600">
            {user?.name ?? "Unknown"}
          </p>
        )}
        <div className="flex flex-col items-start gap-1">
          {message.deleted ? (
            <div className="inline-block max-w-[80%] rounded-2xl rounded-tl-md bg-surface px-3.5 py-2 text-[13px] italic leading-snug text-midnight-400 ring-1 ring-midnight-100">
              This message was deleted
            </div>
          ) : (
            <>
              {atts.map((a) => (
                <div key={a.id} {...press} className="max-w-[80%]">
                  <AttachmentView att={a} sent={false} />
                </div>
              ))}
              {hasText && (
                <div
                  {...press}
                  className="inline-block max-w-[80%] cursor-default select-none rounded-2xl rounded-tl-md bg-surface px-3.5 py-2 text-[14px] leading-snug text-midnight-900 ring-1 ring-midnight-100"
                >
                  {renderText(message.text, false)}
                </div>
              )}
            </>
          )}
        </div>
        <span className="ml-1 mt-0.5 block text-[10.5px] text-midnight-400">{formatChatTime(message.at)}</span>
      </div>
    </div>
  );
}
