// Chat — thread route (/chat/:threadId). Fetches the thread + messages,
// marks it read, and renders the conversation view.

import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { GroupThread } from "./components/group/GroupThread";
import { fetchThread, markThreadRead } from "./api";
import { useChatRealtime } from "./useChatRealtime";

export function ChatThreadPage() {
  const { threadId = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const q = useQuery({
    queryKey: ["chat", "thread", threadId],
    queryFn: () => fetchThread(threadId),
    enabled: !!threadId,
  });

  useEffect(() => {
    if (threadId) markThreadRead(threadId).catch(() => {});
  }, [threadId]);

  useChatRealtime(threadId);

  if (q.isLoading) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-muted text-sm text-midnight-500">
        Loading…
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <EmptyState
          title="Couldn't open this thread"
          description={
            (q.error as Error)?.message ??
            "It may have been archived or you don't have access."
          }
          action={
            <button
              type="button"
              onClick={() => navigate("/chat")}
              className="rounded-lg bg-midnight-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Back to Chat
            </button>
          }
        />
      </div>
    );
  }

  return (
    <GroupThread threadId={threadId} data={q.data} currentUserId={profile?.id ?? ""} />
  );
}
