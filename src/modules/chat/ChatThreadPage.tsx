// Chat — thread route (/chat/:threadId). Resolves the thread from sample
// data and renders the conversation view. Group / direct / WO / submission
// all use the same bubble view for now (the view adapts its header +
// members strip by kind); the desktop two-pane is a later step.

import { useParams, useNavigate } from "react-router-dom";
import { EmptyState } from "@/shared/ui/EmptyState";
import { GroupThread } from "./components/group/GroupThread";
import { getThreadById } from "./sampleData";

export function ChatThreadPage() {
  const { threadId = "" } = useParams();
  const navigate = useNavigate();
  const thread = getThreadById(threadId);

  if (!thread) {
    return (
      <div className="p-6">
        <EmptyState
          title="Thread not found"
          description="It may have been archived or you don't have access."
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

  return <GroupThread thread={thread} />;
}
