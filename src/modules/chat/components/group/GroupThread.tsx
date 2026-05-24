// Chat — group thread (WhatsApp-style). Full-screen takeover: status
// strip + header, optional external/pinned banners, members strip,
// grouped message bubbles + system events, and a composer. Sample data;
// send is stubbed until the backend lands.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Search, MoreHorizontal, Paperclip, Send } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { MessageBubble } from "./MessageBubble";
import { SystemMessage } from "./SystemMessage";
import { MembersStrip } from "./MembersStrip";
import { ExternalBanner, PinnedBanner } from "./Banners";
import { CURRENT_USER_ID, getMembers, getMessages, getPinned } from "../../sampleData";
import type { ChatThread } from "../../types";

export function GroupThread({ thread }: { thread: ChatThread }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState("");

  const messages = getMessages(thread.id);
  const members = getMembers(thread.id);
  const pinned = getPinned(thread.id);

  function send() {
    if (!draft.trim()) return;
    toast.push("Sent (sample) — wired to the backend next.", "success");
    setDraft("");
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-muted">
      {/* status-bar strip */}
      <div
        aria-hidden
        className="shrink-0 bg-midnight"
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />

      {/* header */}
      <header className="flex shrink-0 items-center gap-1 border-b border-midnight-100 bg-surface px-2 py-2">
        <button
          type="button"
          onClick={() => navigate("/chat")}
          className="rounded-full p-1.5 text-midnight-600 hover:bg-surface-muted"
          aria-label="Back to inbox"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[15px] font-semibold text-midnight-900">{thread.title}</p>
          <p className="truncate text-[11.5px] text-midnight-500">
            {thread.kind === "group"
              ? `${thread.memberCount ?? members.length} members`
              : thread.subtitle || "Direct message"}
          </p>
        </div>
        <button type="button" className="rounded-full p-1.5 text-midnight-500 hover:bg-surface-muted" aria-label="Search in thread">
          <Search className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => toast.push("Thread options — coming next.", "info")}
          className="rounded-full p-1.5 text-midnight-500 hover:bg-surface-muted"
          aria-label="Thread options"
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </header>

      {thread.external && <ExternalBanner />}
      {thread.kind === "group" && members.length > 0 && (
        <MembersStrip memberIds={members} />
      )}
      {pinned && <PinnedBanner text={pinned} />}

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.map((m, i) => {
          if (m.system) return <SystemMessage key={m.id} text={m.text} at={m.at} />;
          const prev = messages[i - 1];
          const firstOfRun = !prev || prev.system || prev.fromUserId !== m.fromUserId;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              showAvatar={firstOfRun}
              showName={firstOfRun && m.fromUserId !== CURRENT_USER_ID}
            />
          );
        })}
      </div>

      {/* composer */}
      <div
        className="flex shrink-0 items-end gap-2 border-t border-midnight-100 bg-surface px-3 pt-2.5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) / 2 + 10px)" }}
      >
        <button type="button" className="mb-1 text-midnight-400 hover:text-midnight-700" aria-label="Attach">
          <Paperclip className="h-5 w-5" strokeWidth={2} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={`Message ${thread.title}…`}
          className="min-w-0 flex-1 rounded-full bg-surface-sunk px-4 py-2.5 text-[14px] text-midnight-900 placeholder:text-midnight-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-midnight-900 text-white disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
