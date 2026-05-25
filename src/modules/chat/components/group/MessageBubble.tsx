// Chat — message bubble. Sent (you) = navy, right; received = light,
// left, with avatar + name on the first message of a run. @mentions are
// highlighted (cherry received, frost sent). Attachments render above
// the text bubble; a text bubble only appears when there's text.

import { cn } from "@/lib/cn";
import type { ChatMessage } from "../../types";
import type { ChatUserLite } from "../../api";
import { AttachmentView } from "./AttachmentView";

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
}: {
  message: ChatMessage;
  sent: boolean;
  user?: ChatUserLite;
  showName: boolean;
  showAvatar: boolean;
}) {
  const atts = message.attachments ?? [];
  const hasText = Boolean(message.text && message.text.trim());

  if (sent) {
    return (
      <div className="mt-1 flex flex-col items-end gap-1">
        {atts.map((a) => (
          <div key={a.id} className="max-w-[80%]">
            <AttachmentView att={a} sent />
          </div>
        ))}
        {hasText && (
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-midnight-900 px-3.5 py-2 text-[14px] leading-snug text-white">
            {renderText(message.text, true)}
          </div>
        )}
        <span className="mr-1 mt-0.5 text-[10.5px] text-midnight-400">{message.at}</span>
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
          {atts.map((a) => (
            <div key={a.id} className="max-w-[80%]">
              <AttachmentView att={a} sent={false} />
            </div>
          ))}
          {hasText && (
            <div className="inline-block max-w-[80%] rounded-2xl rounded-tl-md bg-surface px-3.5 py-2 text-[14px] leading-snug text-midnight-900 ring-1 ring-midnight-100">
              {renderText(message.text, false)}
            </div>
          )}
        </div>
        <span className="ml-1 mt-0.5 block text-[10.5px] text-midnight-400">{message.at}</span>
      </div>
    </div>
  );
}
