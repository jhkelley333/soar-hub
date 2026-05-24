// Chat — inbox (the "Inbox D — Combined" design). Home of the Chat tab:
// sticky header, search, a "Needs you" strip (0–2 action cards), the
// All / Direct / Groups / News tab bar, and the conversation list.
//
// Sample data only for now (see ./sampleData). Tapping rows/actions and
// the compose FAB are stubbed with toasts until the thread view + compose
// flow + backend land. "Needs you" is treated as a server-derived flag.

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { ChatTabs } from "./components/ChatTabs";
import { ActionCard } from "./components/ActionCard";
import { ConversationRow } from "./components/ConversationRow";
import { ComposeModal } from "./components/ComposeModal";
import { SAMPLE_THREADS } from "./sampleData";
import type { ChatTab } from "./types";

export function ChatInboxPage() {
  const toast = useToast();
  const [tab, setTab] = useState<ChatTab>("all");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  const threads = SAMPLE_THREADS;

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
        return true; // all
      })
      .filter((t) =>
        q
          ? `${t.title} ${t.subtitle} ${t.lastMessage.text}`.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [threads, tab, search]);

  const openThread = (title: string) =>
    toast.push(`Opening "${title}" — the thread view is next.`, "info");

  return (
    <div className="relative mx-auto min-h-full w-full max-w-md bg-surface-muted">
      <AppHeader
        title="Chat"
        subtitle={`${needsYou.length} need you · ${counts.all} unread`}
        trailing={
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="text-midnight-600 hover:text-midnight-900"
            aria-label="New chat"
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        }
      />

      {/* Search */}
      <div className="sticky top-12 z-10 bg-surface-muted px-4 pb-2 pt-2">
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

      {/* Needs you */}
      {needsYou.length > 0 && (
        <section className="px-4 pb-1 pt-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-midnight-500">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Needs you · {needsYou.length}
            </div>
            <button
              type="button"
              onClick={() => toast.push("Needs-you list is coming next.", "info")}
              className="text-[12.5px] font-medium text-accent hover:underline"
            >
              See all
            </button>
          </div>
          <div className="space-y-2.5">
            {needsYou.slice(0, 2).map((t) => (
              <ActionCard
                key={t.id}
                thread={t}
                onOpen={() => openThread(t.title)}
                onAction={(a) => toast.push(`"${a}" — wired to the work flow next.`, "info")}
              />
            ))}
          </div>
        </section>
      )}

      {/* Tabs */}
      <div className="sticky top-[5.5rem] z-10 mt-2 bg-surface-muted">
        <ChatTabs active={tab} counts={counts} onChange={setTab} />
      </div>

      {/* Conversation list */}
      <div className="overflow-hidden">
        {list.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={search ? "No threads match" : "Nothing here yet"}
              description={
                search
                  ? "Try a different search."
                  : "New conversations will show up in this tab."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-midnight-100">
            {list.map((t) => (
              <li key={t.id}>
                <ConversationRow thread={t} onOpen={() => openThread(t.title)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Compose FAB */}
      <button
        type="button"
        onClick={() => setComposeOpen(true)}
        aria-label="New chat"
        className="fixed bottom-20 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-midnight-900 text-white shadow-float transition active:scale-95"
      >
        <Plus className="h-6 w-6" strokeWidth={2.25} />
      </button>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={(s) =>
          toast.push(`Started "${s}" — opening the thread is next.`, "success")
        }
      />
    </div>
  );
}
