// Chat — conversation list. Shared by the mobile inbox and the desktop
// two-pane layout. Self-contained: owns the inbox query, search, tabs,
// the "Needs you" launcher, compose, and row selection. The parent passes
// the active thread (to highlight it) and an onOpen handler.

import { useMemo, useState } from "react";
import { Search, Plus, Archive, Inbox } from "lucide-react";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Drawer } from "@/shared/ui/Drawer";
import { useToast } from "@/shared/ui/Toaster";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { ChatTabs } from "./components/ChatTabs";
import { ActionCard } from "./components/ActionCard";
import { ConversationRow } from "./components/ConversationRow";
import { SwipeableRow } from "./components/SwipeableRow";
import { ComposeModal } from "./components/ComposeModal";
import { INBOX_VIEWER_ROLES, StoreInboxDrawer, useStoreInbox } from "./components/StoreInboxDrawer";
import { fetchInbox, setThreadArchived, markThreadRead, type InboxResponse } from "./api";
import type { ChatTab } from "./types";

const INBOX_KEY = ["chat", "inbox"];
const ARCHIVED_KEY = ["chat", "inbox", "archived"];

export function ChatList({
  activeThreadId,
  onOpen,
}: {
  activeThreadId?: string;
  onOpen: (id: string) => void;
}) {
  const toast = useToast();
  const { profile } = useAuth();
  const [tab, setTab] = useState<ChatTab>("all");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [needsYouOpen, setNeedsYouOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [storeInboxOpen, setStoreInboxOpen] = useState(false);

  // Leader Inbox — one-way floor reports from the Store Command Center
  // screens. Only leader roles see the button; the count polls lightly so
  // the badge stays honest without the drawer open.
  const role = String(profile?.role ?? "");
  const isInboxViewer = INBOX_VIEWER_ROLES.has(role);
  const storeInboxQ = useStoreInbox(isInboxViewer);
  const storeInboxCount = storeInboxQ.data?.reports.length ?? 0;

  const qc = useQueryClient();
  const inboxQ = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => fetchInbox(),
    staleTime: 30_000,
    // Re-sync the inbox when the app returns to the foreground or the
    // network reconnects (mobile drops the realtime socket while
    // backgrounded). staleTime keeps this from firing more than every 30s.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const threads = inboxQ.data?.threads ?? [];

  // Archived threads — fetched lazily when the drawer opens.
  const archivedQ = useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: () => fetchInbox({ archived: true }),
    enabled: archivedOpen,
    staleTime: 30_000,
  });
  const archivedThreads = archivedQ.data?.threads ?? [];

  // Swipe-to-archive: optimistically drop the row from the inbox, then
  // sync. The server hides it for this user only and auto-resurfaces it on
  // a newer message (migration 0100).
  const archiveMut = useMutation({
    mutationFn: (threadId: string) => setThreadArchived(threadId, true),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: INBOX_KEY });
      const prev = qc.getQueryData<InboxResponse>(INBOX_KEY);
      qc.setQueryData<InboxResponse>(INBOX_KEY, (old) =>
        old ? { ...old, threads: old.threads.filter((t) => t.id !== threadId) } : old,
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(INBOX_KEY, ctx.prev);
      toast.push("Couldn't archive — try again.", "error");
    },
    onSuccess: () => toast.push("Archived", "info"),
    onSettled: () => qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });

  // Swipe-right to mark a thread read: optimistically zero its unread, then
  // sync (last_read_at = now on the server).
  const markReadMut = useMutation({
    mutationFn: (threadId: string) => markThreadRead(threadId),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: INBOX_KEY });
      const prev = qc.getQueryData<InboxResponse>(INBOX_KEY);
      qc.setQueryData<InboxResponse>(INBOX_KEY, (old) =>
        old
          ? {
              ...old,
              threads: old.threads.map((t) =>
                t.id === threadId
                  ? { ...t, unreadCount: 0, mentionedCount: 0, needsYou: false }
                  : t,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(INBOX_KEY, ctx.prev);
      toast.push("Couldn't mark read.", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: INBOX_KEY }),
  });

  // Unarchive from the Archived drawer — drop it from that list and refresh
  // the main inbox so it reappears there.
  const unarchiveMut = useMutation({
    mutationFn: (threadId: string) => setThreadArchived(threadId, false),
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ARCHIVED_KEY });
      const prev = qc.getQueryData<InboxResponse>(ARCHIVED_KEY);
      qc.setQueryData<InboxResponse>(ARCHIVED_KEY, (old) =>
        old ? { ...old, threads: old.threads.filter((t) => t.id !== threadId) } : old,
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ARCHIVED_KEY, ctx.prev);
      toast.push("Couldn't unarchive — try again.", "error");
    },
    onSuccess: () => toast.push("Unarchived", "info"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ARCHIVED_KEY });
      qc.invalidateQueries({ queryKey: INBOX_KEY });
    },
  });

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
        <div className="flex items-center gap-3">
          {isInboxViewer && (
            <button
              type="button"
              onClick={() => setStoreInboxOpen(true)}
              className="inline-flex items-center gap-1 text-[13.5px] font-medium text-midnight-500"
              aria-label="Store floor report inbox"
            >
              <Inbox className="h-4 w-4" strokeWidth={2} /> Inbox
              {storeInboxCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                  {storeInboxCount}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setArchivedOpen(true)}
            className="inline-flex items-center gap-1 text-[13.5px] font-medium text-midnight-500"
            aria-label="Archived conversations"
          >
            <Archive className="h-4 w-4" strokeWidth={2} /> Archived
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} /> New
          </button>
        </div>
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
              <li key={t.id}>
                <SwipeableRow
                  active={t.id === activeThreadId}
                  onArchive={() => archiveMut.mutate(t.id)}
                  onMarkRead={t.unreadCount > 0 ? () => markReadMut.mutate(t.id) : undefined}
                >
                  <ConversationRow thread={t} onOpen={() => onOpen(t.id)} />
                </SwipeableRow>
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

      <StoreInboxDrawer
        open={storeInboxOpen}
        onClose={() => setStoreInboxOpen(false)}
        canEscalate={["gm", "admin", "vp", "coo"].includes(role)}
      />

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

      <Drawer open={archivedOpen} onClose={() => setArchivedOpen(false)} title="Archived">
        {archivedQ.isLoading ? (
          <p className="py-8 text-center text-[13px] text-midnight-400">Loading…</p>
        ) : archivedThreads.length === 0 ? (
          <EmptyState
            title="No archived chats"
            description="Swipe a conversation left to archive it. It comes back automatically when there's a new message."
          />
        ) : (
          <ul className="divide-y divide-midnight-100">
            {archivedThreads.map((t) => (
              <li key={t.id} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <ConversationRow
                    thread={t}
                    onOpen={() => {
                      setArchivedOpen(false);
                      onOpen(t.id);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => unarchiveMut.mutate(t.id)}
                  className="shrink-0 px-3 py-2 text-[12.5px] font-semibold text-accent"
                >
                  Unarchive
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}
