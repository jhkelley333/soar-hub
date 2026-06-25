// Chat — Supabase Realtime subscription. Listens for new messages (and,
// on the inbox, membership changes) and invalidates the relevant React
// Query caches so the UI updates without a manual refresh. RLS scopes the
// stream to the caller's threads, so we can subscribe table-wide and let
// the server decide what we're allowed to see.
//
// The inbox subscription (mounted app-wide in AppShell) also drives the
// in-app chime + toast: when a message from someone else lands while the
// app is open and focused, we alert the active user — push only fires when
// the app is backgrounded.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { useToast } from "@/shared/ui/Toaster";
import { playChime } from "@/lib/chime";
import { markThreadRead } from "./api";

// The raw chat_messages row delivered by Realtime (snake_case DB columns).
interface MessageRow {
  thread_id?: string;
  from_user_id?: string;
  text?: string;
  system?: boolean;
}

export function useChatRealtime(threadId?: string) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { push } = useToast();

  // Read these inside the realtime callback without re-subscribing the
  // channel every time they change (a re-subscribe can drop messages mid-swap).
  const myIdRef = useRef<string | null>(profile?.id ?? null);
  const pushRef = useRef(push);
  useEffect(() => {
    myIdRef.current = profile?.id ?? null;
  }, [profile]);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);

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
      // A soft-delete is an UPDATE — refresh the thread so the tombstone
      // appears and the inbox so any cleared unread count recomputes.
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
          qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
        },
      );
    } else {
      const bumpInbox = () => qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
      const onInsert = (payload: { new: MessageRow }) => {
        bumpInbox();
        const row = payload.new;
        // Alert only for someone else's real message: skip system events and
        // our own sends.
        if (!row || row.system) return;
        if (!row.from_user_id || row.from_user_id === myIdRef.current) return;
        // Backgrounded? The Web Push notification covers it (and Web Audio
        // won't play while hidden anyway).
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        // Already reading this exact thread? No need to alert.
        if (
          row.thread_id &&
          typeof window !== "undefined" &&
          window.location.pathname === `/chat/${row.thread_id}`
        ) {
          return;
        }
        playChime();
        const snippet = (row.text || "").trim();
        pushRef.current(
          snippet ? `New message: ${snippet.slice(0, 80)}` : "New message · 📎 attachment",
          "info",
        );
      };
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, onInsert)
        // A delete elsewhere clears unread/needsYou — recompute the badge.
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, bumpInbox)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_thread_members" }, bumpInbox);
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, threadId]);
}
