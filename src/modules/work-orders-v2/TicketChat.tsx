// Per-ticket chat — internal and vendor threads. Loads on mount,
// refetches on send, has a manual refresh button. No polling for now;
// users can hit the refresh icon to pull new messages.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { fetchMessages, sendMessage } from "./api";
import type { ThreadType, TicketMessage } from "./types";

interface Props {
  ticketId: string;
  onError: (msg: string) => void;
}

function initials(name: string | null) {
  return (name || "?")
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TicketChat({ ticketId, onError }: Props) {
  const qc = useQueryClient();
  const [thread, setThread] = useState<ThreadType>("internal");
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const msgsQ = useQuery({
    queryKey: ["wo2", "messages", ticketId, thread],
    queryFn: () => fetchMessages(ticketId, thread),
    staleTime: 15_000,
  });

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [msgsQ.data]);

  const send = useMutation({
    mutationFn: () => {
      const trimmed = draft.trim();
      if (!trimmed) return Promise.reject(new Error("Empty message."));
      return sendMessage({ ticketId, message: trimmed, threadType: thread });
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["wo2", "messages", ticketId, thread] });
    },
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Send failed."),
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send.mutate();
    }
  }

  const messages = msgsQ.data?.messages ?? [];

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Messages
        </div>
        <div className="flex gap-1">
          <ThreadTab
            label="🔒 Internal"
            active={thread === "internal"}
            onClick={() => setThread("internal")}
          />
          <ThreadTab
            label="🏢 Vendor"
            active={thread === "vendor"}
            onClick={() => setThread("vendor")}
            title="Visible to the vendor scanning the store's QR code."
          />
          <button
            type="button"
            onClick={() => msgsQ.refetch()}
            className="ml-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Refresh messages"
          >
            {msgsQ.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
        <div
          ref={listRef}
          className="max-h-72 space-y-2 overflow-y-auto p-3"
        >
          {msgsQ.isLoading && (
            <div className="text-center text-xs text-zinc-500">Loading…</div>
          )}
          {!msgsQ.isLoading && messages.length === 0 && (
            <div className="text-center text-xs text-zinc-500">
              No messages yet — start the conversation.
            </div>
          )}
          {messages.map((m) => <ChatBubble key={m.id} m={m} />)}
        </div>
        <div className="flex items-end gap-2 border-t border-zinc-100 bg-zinc-50 px-2 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={thread === "vendor" ? "Message to vendor…" : "Internal team message…"}
            className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={send.isPending || !draft.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {send.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" strokeWidth={1.75} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ThreadTab({
  label,
  active,
  onClick,
  disabled,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  let className: string;
  if (disabled) {
    className =
      "cursor-not-allowed rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-400";
  } else if (active) {
    className =
      "rounded-md border border-accent bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent";
  } else {
    className =
      "rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:text-midnight";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-disabled={disabled || undefined}
      className={className}
    >
      {label}
    </button>
  );
}

function ChatBubble({ m }: { m: TicketMessage }) {
  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
        {initials(m.user_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap rounded-md bg-zinc-50 px-3 py-2 text-sm text-midnight">
          {m.message}
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          {m.user_role && (
            <span className="mr-1 rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-semibold uppercase">
              {m.user_role}
            </span>
          )}
          {m.user_name || "Unknown"} · {fmtTime(m.created_at)}
        </div>
      </div>
    </div>
  );
}
