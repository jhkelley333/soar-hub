// Chat — Supabase Realtime subscription. Listens for new messages (and,
// on the inbox, membership changes) and invalidates the relevant React
// Query caches so the UI updates without a manual refresh. RLS scopes the
// stream to the caller's threads, so we can subscribe table-wide and let
// the server decide what we're allowed to see.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { markThreadRead } from "./api";

export function useChatRealtime(threadId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel(threadId ? `chat-thread-${threadId}` : "chat-inbox");

    if (threadId) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
          qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
          // Viewing the thread when a message lands ⇒ it's already read.
          markThreadRead(threadId).catch(() => {});
        },
      );
    } else {
      const bumpInbox = () => qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, bumpInbox)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_thread_members" }, bumpInbox);
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, threadId]);
}
