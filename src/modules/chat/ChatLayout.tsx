// Chat — responsive shell for /chat and /chat/:threadId.
//   < lg  → mobile: full-page list, or full-screen thread (unchanged).
//   lg+   → desktop two/three-pane: conversation list | thread | context.
// Selecting a row navigates to /chat/:threadId, which just re-renders this
// layout with a new center/right pane (no page change on desktop).

import { useParams, useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { ChatList } from "./ChatList";
import { ChatThreadPage } from "./ChatThreadPage";
import { ContextPane } from "./ContextPane";

export function ChatLayout() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const open = (id: string) => navigate(`/chat/${id}`);

  if (!isDesktop) {
    if (threadId) return <ChatThreadPage />;
    return (
      <div className="mx-auto h-full w-full max-w-md">
        <ChatList onOpen={open} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-[340px] shrink-0 border-r border-midnight-100">
        <ChatList activeThreadId={threadId} onOpen={open} />
      </div>
      <div className="min-w-0 flex-1">
        {threadId ? (
          <ChatThreadPage key={threadId} embedded />
        ) : (
          <EmptyCenter />
        )}
      </div>
      {threadId && (
        <div className="hidden w-[320px] shrink-0 border-l border-midnight-100 xl:block">
          <ContextPane key={threadId} threadId={threadId} />
        </div>
      )}
    </div>
  );
}

function EmptyCenter() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface-muted text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-frost-100 text-midnight-400">
        <MessageSquare className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <p className="mt-3 text-[15px] font-semibold text-midnight-700">Select a conversation</p>
      <p className="mt-1 text-[13px] text-midnight-400">Pick a thread on the left, or start a new one.</p>
    </div>
  );
}
