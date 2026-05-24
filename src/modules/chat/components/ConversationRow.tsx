// Chat — conversation row variants for the inbox list: direct (1:1),
// group (WhatsApp-style), and broadcast (News). A dispatcher picks the
// variant by thread kind.

import { Megaphone } from "lucide-react";
import { cn } from "@/lib/cn";
import { UnreadBubble } from "./UnreadBubble";
import type { ChatThread } from "../types";

function Avatar({
  initials,
  online,
}: {
  initials: string;
  online?: boolean;
}) {
  return (
    <div className="relative shrink-0">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-frost-100 text-[13px] font-semibold text-midnight-700">
        {initials}
      </div>
      {online && (
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-ok" />
      )}
    </div>
  );
}

function GroupAvatar({ initials }: { initials: string[] }) {
  return (
    <div className="relative h-11 w-11 shrink-0">
      <div className="absolute left-0 top-0 flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-frost-100 text-[11px] font-semibold text-midnight-700">
        {initials[0] ?? ""}
      </div>
      <div className="absolute bottom-0 right-0 flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-midnight-900 text-[10px] font-semibold text-white ring-2 ring-surface">
        {initials[1] ?? ""}
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .replace(/^(SDO|RVP|DO|GM|VP|COO)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-muted";

function DirectRow({ thread, onOpen }: { thread: ChatThread; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={ROW}>
      <Avatar initials={initialsOf(thread.title)} online />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14.5px] font-semibold text-midnight-900">
            {thread.title}
          </span>
          <span className="shrink-0 text-[11px] text-midnight-400">
            {thread.lastMessage.at}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] text-midnight-500">
            {thread.lastMessage.text}
          </span>
          <UnreadBubble count={thread.unreadCount} />
        </div>
      </div>
    </button>
  );
}

function GroupRow({ thread, onOpen }: { thread: ChatThread; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn(ROW, "items-start")}>
      <GroupAvatar initials={thread.memberInitials ?? []} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14.5px] font-semibold text-midnight-900">
            {thread.title}
          </span>
          <span className="shrink-0 text-[11px] text-midnight-400">
            {thread.lastMessage.at}
          </span>
        </div>
        <div className="text-[11.5px] text-midnight-400">
          {thread.memberCount} members
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] text-midnight-500">
            {thread.lastMessage.text}
          </span>
          <UnreadBubble count={thread.unreadCount} />
        </div>
      </div>
    </button>
  );
}

function BroadcastRow({ thread, onOpen }: { thread: ChatThread; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn(ROW, "items-start")}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-midnight-900 text-white">
        <Megaphone className="h-[18px] w-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14.5px] font-semibold text-midnight-900">
            {thread.title}
          </span>
          <span className="shrink-0 text-[11px] text-midnight-400">
            {thread.lastMessage.at}
          </span>
        </div>
        {thread.fromLabel && (
          <div className="text-[11.5px] text-midnight-400">{thread.fromLabel}</div>
        )}
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-midnight-600">
          {thread.lastMessage.text}
        </p>
      </div>
    </button>
  );
}

export function ConversationRow({
  thread,
  onOpen,
}: {
  thread: ChatThread;
  onOpen: () => void;
}) {
  if (thread.kind === "group") return <GroupRow thread={thread} onOpen={onOpen} />;
  if (thread.kind === "broadcast")
    return <BroadcastRow thread={thread} onOpen={onOpen} />;
  return <DirectRow thread={thread} onOpen={onOpen} />;
}
