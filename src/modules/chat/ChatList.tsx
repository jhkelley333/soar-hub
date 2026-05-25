// Chat — conversation list. Shared by the mobile inbox and the desktop
// two-pane layout. Self-contained: owns the inbox query, search, tabs,
// the "Needs you" launcher, compose, and row selection. The parent passes
// the active thread (to highlight it) and an onOpen handler.

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Drawer } from "@/shared/ui/Drawer";
import { useToast } from "@/shared/ui/Toaster";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { ChatTabs } from "./components/ChatTabs";
import { ActionCard } from "./components/ActionCard";
import { ConversationRow } from "./components/ConversationRow";
import { ComposeModal } from "./components/ComposeModal";
import { fetchInbox } from "./api";
import type { ChatTab } from "./types";

export function ChatList({
  activeThreadId,
  onOpen,
}: {
  activeThreadId?: string;
  onOpen: (id: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<ChatTab>("all");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [needsYouOpen, setNeedsYouOpen] = useState(false);

  const inboxQ = useQuery({
    queryKey: ["chat", "inbox"],
    queryFn: fetchInbox,
    staleTime: 30_000,
  });
  const threads = inboxQ.data?.threads ?? [];

  const needsYou = useMemo(() => threads.filter((t) => t.needsYou), [threads]);

  const counts = useMemo<Record<ChatTab, number>>(() => {
    const sum = (pred: (k: string) => boolean) =>
      threads.filter((t) => pred(t.kind)).reduce((s, t) => s + t.unreadCount, 0);
    return {
      all: threads.reduce((s, t) => s + t.unreadCount, 0),
      direct: sum((k) => k === "direct"),
      groups: sum((k) => k === "group"),
      news: sum((k) => k === "broadcast"),
    };
  }, [threads]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads
      .filter((t) => !t.needsYou)
      .filter((t) => {
        if (tab === "direct") return t.kind === "direct";
        if (tab === "groups") return t.kind === "group";
        if (tab === "news") return t.kind === "broadcast";
        return true;
      })
      .filter((t) =>
        q ? `${t.title} ${t.subtitle} ${t.lastMessage.text}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [threads, tab, search]);

  return (
    <div className="relative flex h-full flex-col bg-surface-muted">
      <header className="flex shrink-0 items-center justify-between border-b border-midnight-100 px-4 py-3">
        <h1 className="text-[17px] font-semibold text-midnight-900">Chat</h1>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} /> New
        </button>
      </header>

      <div className="shrink-0 px-3 pb-2 pt-2">
        <div className="flex items-center gap-2 rounded-xl bg-surface-sunk px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-midnight-400" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads, people, stores…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-midnight-800 placeholder:text-midnight-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="shrink-0">
        <ChatTabs
          active={tab}
          counts={counts}
          onChange={setTab}
          trailing={
            needsYou.length > 0 ? (
              <button
                type="button"
                onClick={() => setNeedsYouOpen(true)}
                className="my-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[12.5px] font-semibold text-accent"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Needs you
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                  {needsYou.length}
                </span>
              </button>
            ) : null
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
        {inboxQ.isLoading ? (
          <div className="p-8 text-center text-[13px] text-midnight-400">Loading chats…</div>
        ) : inboxQ.isError ? (
          <div className="p-6">
            <EmptyState
              title="Couldn't load chats"
              description={(inboxQ.error as Error)?.message ?? "Try again."}
            />
          </div>
        ) : list.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={search ? "No threads match" : "Nothing here yet"}
              description={search ? "Try a different search." : "Tap New to start a conversation."}
            />
          </div>
        ) : (
          <ul className="divide-y divide-midnight-100">
            {list.map((t) => (
              <li key={t.id} className={cn(t.id === activeThreadId && "bg-frost-100/60")}>
                <ConversationRow thread={t} onOpen={() => onOpen(t.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Floating compose button — mobile only. Mirrors the top "New"
          action; desktop keeps just the header button since the list is a
          narrow pane. Anchored to this container so it floats above the
          list rows and clears the bottom tab bar (list has pb-24). */}
      <button
        type="button"
        onClick={() => setComposeOpen(true)}
        aria-label="New chat"
        className="absolute bottom-5 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-midnight text-white shadow-lg shadow-midnight/30 transition active:scale-95 lg:hidden"
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />

      <Drawer
        open={needsYouOpen}
        onClose={() => setNeedsYouOpen(false)}
        title={`Needs you · ${needsYou.length}`}
      >
        <div className="space-y-2.5">
          {needsYou.map((t) => (
            <ActionCard
              key={t.id}
              thread={t}
              onOpen={() => {
                setNeedsYouOpen(false);
                onOpen(t.id);
              }}
              onAction={(a) => toast.push(`"${a}" — wired to the work flow next.`, "info")}
            />
          ))}
        </div>
      </Drawer>
    </div>
  );
}
