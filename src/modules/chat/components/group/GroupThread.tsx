// Chat — group / thread view (WhatsApp-style), full-screen takeover.
// Renders from the fetched thread payload; the composer posts via the
// send mutation and refetches.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Search, MoreHorizontal, Paperclip, ArrowUp, X, FileText } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { MessageBubble } from "./MessageBubble";
import { SwipeToDelete } from "./SwipeToDelete";
import { SystemMessage } from "./SystemMessage";
import { MembersStrip, type StripMember } from "./MembersStrip";
import { ExternalBanner } from "./Banners";
import {
  sendChatMessage,
  deleteChatMessage,
  uploadChatAttachment,
  type ThreadResponse,
  type AttachmentInput,
} from "../../api";
import type { ChatMessage } from "../../types";

export function GroupThread({
  threadId,
  data,
  currentUserId,
  embedded = false,
}: {
  threadId: string;
  data: ThreadResponse;
  currentUserId: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [searchQ, setSearchQ] = useState<string | null>(null);
  const [pending, setPending] = useState<
    { id: string; file: File; url: string; isImage: boolean }[]
  >([]);
  // Message tapped/long-pressed for the actions menu (delete).
  const [actionMsg, setActionMsg] = useState<ChatMessage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Open search when arrived from the Group Info "Search" tile.
  useEffect(() => {
    if ((location.state as { openSearch?: boolean } | null)?.openSearch) setSearchQ("");
  }, [location.state]);

  const { thread, members, users, messages } = data;
  const isGroup = thread.kind === "group";
  const isGroupy = thread.kind === "group"; // has a Group Info screen
  const myRole = members.find((m) => m.user_id === currentUserId)?.role;
  const readOnly = thread.kind === "broadcast" && myRole !== "owner";

  // Who you're talking with — names of everyone but you. Direct threads
  // store no title, so the header gets the other person's name here.
  const otherNames = members
    .filter((m) => m.user_id !== currentUserId)
    .map((m) => users[m.user_id]?.name || users[m.user_id]?.first)
    .filter(Boolean) as string[];

  let headerTitle = thread.title;
  let headerSubtitle = thread.subtitle || "";
  if (thread.kind === "direct") {
    headerTitle = otherNames[0] || thread.title || "Direct message";
    headerSubtitle = "Direct message";
  } else if (isGroup) {
    headerTitle = thread.title || "Group";
    headerSubtitle = otherNames.length ? otherNames.join(", ") : `${members.length} members`;
  } else if (thread.kind === "broadcast") {
    headerTitle = thread.title || "Announcement";
    headerSubtitle = thread.subtitle || "Announcement";
  }

  const stripMembers: StripMember[] = members.map((m) => ({
    id: m.user_id,
    first: users[m.user_id]?.first ?? "",
    initials: users[m.user_id]?.initials ?? "?",
    isYou: m.user_id === currentUserId,
  }));

  // Staged-then-send: picking files adds local previews; nothing uploads
  // until Send, which uploads everything and posts one message (optional
  // caption + attachments) — like iMessage / WhatsApp.
  const threadKey = ["chat", "thread", threadId];
  const send = useMutation({
    // Text + staged files are captured at submit so the instant draft-clear
    // in onMutate can never race what actually gets sent.
    mutationFn: async (vars: { text: string; files: typeof pending }) => {
      let atts: AttachmentInput[] = [];
      if (vars.files.length) {
        atts = await Promise.all(vars.files.map((p) => uploadChatAttachment(threadId, p.file)));
      }
      await sendChatMessage(threadId, vars.text, atts);
    },
    onMutate: async (vars) => {
      // Optimistic: show the text bubble immediately and empty the composer,
      // so sending feels instant instead of waiting on the round-trip.
      // Attachment-only sends fall through to the post-send refetch (their
      // previews need signed URLs we don't have yet), but stay visible in
      // the composer until success.
      await qc.cancelQueries({ queryKey: threadKey });
      const prev = qc.getQueryData<ThreadResponse>(threadKey);
      if (vars.text && prev) {
        const optimistic: ChatMessage = {
          id: `optimistic-${crypto.randomUUID()}`,
          threadId,
          fromUserId: currentUserId,
          text: vars.text,
          at: new Date().toISOString(),
        };
        qc.setQueryData<ThreadResponse>(threadKey, {
          ...prev,
          messages: [...prev.messages, optimistic],
        });
      }
      setDraft("");
      return { prev, text: vars.text };
    },
    onError: (e: unknown, _vars, ctx) => {
      // Roll back the optimistic bubble and put the text back so nothing is lost.
      if (ctx?.prev) qc.setQueryData(threadKey, ctx.prev);
      if (ctx?.text) setDraft(ctx.text);
      toast.push(e instanceof Error ? e.message : "Send failed.", "error");
    },
    onSuccess: () => {
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: threadKey });
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
    },
  });

  // Delete a message. Optimistically swap it for a tombstone, then let the
  // refetch (and the recipient's realtime UPDATE) settle the real state and
  // clear the unread / "needs you" badge.
  const del = useMutation({
    mutationFn: (m: ChatMessage) => deleteChatMessage(m.id),
    onMutate: async (m) => {
      setActionMsg(null);
      await qc.cancelQueries({ queryKey: threadKey });
      const prev = qc.getQueryData<ThreadResponse>(threadKey);
      if (prev) {
        qc.setQueryData<ThreadResponse>(threadKey, {
          ...prev,
          messages: prev.messages.map((x) =>
            x.id === m.id ? { ...x, deleted: true, text: "", attachments: [] } : x,
          ),
        });
      }
      return { prev };
    },
    onError: (e: unknown, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(threadKey, ctx.prev);
      toast.push(e instanceof Error ? e.message : "Couldn't delete message.", "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: threadKey });
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
    },
  });

  // Sender deletes their own; owners/admins can delete anyone's.
  const canDeleteMsg = (m: ChatMessage) =>
    !m.system && (m.fromUserId === currentUserId || myRole === "owner" || myRole === "admin");

  const canSend = (draft.trim().length > 0 || pending.length > 0) && !send.isPending;

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        isImage: file.type.startsWith("image/"),
      })),
    ]);
  };

  const removePending = (id: string) =>
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });

  const submit = () => {
    if (canSend) send.mutate({ text: draft.trim(), files: pending });
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-surface-muted",
        embedded ? "relative h-full min-h-0" : "fixed inset-0 z-40",
      )}
    >
      {!embedded && (
        <div aria-hidden className="shrink-0 bg-midnight" style={{ height: "env(safe-area-inset-top, 0px)" }} />
      )}

      <header className="flex shrink-0 items-center gap-1 border-b border-midnight-100 bg-surface px-2 py-2">
        {!embedded && (
          <button type="button" onClick={() => navigate("/chat")} className="rounded-full p-1.5 text-midnight-600 hover:bg-surface-muted" aria-label="Back to inbox">
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={() => isGroupy && navigate(`/chat/${threadId}/info`)}
          disabled={!isGroupy}
          className="min-w-0 flex-1 text-center disabled:cursor-default"
        >
          <p className="truncate text-[15px] font-semibold text-midnight-900">{headerTitle}</p>
          <p className="truncate text-[11.5px] text-midnight-500">{headerSubtitle}</p>
        </button>
        <button
          type="button"
          onClick={() => setSearchQ((s) => (s === null ? "" : null))}
          className={cn(
            "rounded-full p-1.5 hover:bg-surface-muted",
            searchQ !== null ? "text-accent" : "text-midnight-500",
          )}
          aria-label="Search in thread"
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        {isGroupy ? (
          <button type="button" onClick={() => navigate(`/chat/${threadId}/info`)} className="rounded-full p-1.5 text-midnight-500 hover:bg-surface-muted" aria-label="Group info">
            <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        ) : (
          <span className="w-8" />
        )}
      </header>

      {searchQ !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-midnight-100 bg-surface px-3 py-2">
          <Search className="h-4 w-4 text-midnight-400" strokeWidth={2} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            autoFocus
            placeholder="Search this conversation…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-midnight-900 placeholder:text-midnight-400 focus:outline-none"
          />
          <button type="button" onClick={() => setSearchQ(null)} aria-label="Close search" className="text-midnight-400 hover:text-midnight-700">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {thread.external && <ExternalBanner />}
      {isGroup && stripMembers.length > 0 && searchQ === null && <MembersStrip members={stripMembers} />}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {(() => {
          const query = (searchQ || "").trim().toLowerCase();
          const visible = query
            ? messages.filter((m) => !m.system && m.text.toLowerCase().includes(query))
            : messages;
          if (query && visible.length === 0) {
            return <p className="py-10 text-center text-[13px] text-midnight-400">No matches.</p>;
          }
          if (!query && messages.length === 0) {
            return (
              <p className="py-10 text-center text-[13px] text-midnight-400">
                No messages yet — say hello.
              </p>
            );
          }
          return visible.map((m, i) => {
            if (m.system) return <SystemMessage key={m.id} text={m.text} at={m.at} />;
            const prev = visible[i - 1];
            const firstOfRun = !prev || prev.system || prev.fromUserId !== m.fromUserId;
            const sent = m.fromUserId === currentUserId;
            const deletable = canDeleteMsg(m) && !m.deleted;
            return (
              <SwipeToDelete key={m.id} enabled={deletable} onDelete={() => del.mutate(m)}>
                <MessageBubble
                  message={m}
                  sent={sent}
                  user={users[m.fromUserId]}
                  showAvatar={firstOfRun}
                  showName={firstOfRun && !sent}
                  canDelete={canDeleteMsg(m)}
                  onRequestActions={() => setActionMsg(m)}
                />
              </SwipeToDelete>
            );
          });
        })()}
      </div>

      {readOnly ? (
        <div
          className="shrink-0 border-t border-midnight-100 bg-surface px-5 pt-3 text-center text-[13px] text-midnight-500"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          This is an announcement — replies are disabled.
        </div>
      ) : (
        <div
          className="shrink-0 border-t border-midnight-100 bg-surface px-4 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          {/* Staged attachments — preview before sending. */}
          {pending.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1.5 pb-1 pt-2.5">
              {pending.map((p) => (
                <div key={p.id} className="relative shrink-0">
                  {p.isImage ? (
                    <img src={p.url} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-midnight-100" />
                  ) : (
                    <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl bg-surface-sunk px-1 text-midnight-500 ring-1 ring-midnight-100">
                      <FileText className="h-5 w-5" strokeWidth={1.75} />
                      <span className="w-full truncate text-center text-[9px] leading-none">{p.file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePending(p.id)}
                    aria-label="Remove attachment"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-midnight-900 text-white ring-2 ring-surface"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2.5">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={send.isPending}
              className="mb-1 shrink-0 text-midnight-400 transition hover:text-midnight-700 disabled:opacity-40"
              aria-label="Attach"
            >
              <Paperclip className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={
                send.isPending ? "Sending…" : pending.length > 0 ? "Add a caption…" : "Message"
              }
              disabled={send.isPending}
              className="min-w-0 flex-1 rounded-[20px] border border-midnight-200 bg-surface px-4 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-midnight-300 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition disabled:bg-midnight-200"
              aria-label="Send"
            >
              <ArrowUp className="h-[20px] w-[20px]" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {/* Message actions — long-press / right-click a message to delete it. */}
      {actionMsg && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-midnight-900/40"
          onClick={() => setActionMsg(null)}
        >
          <div
            className="m-3 w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ marginBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
          >
            <button
              type="button"
              onClick={() => del.mutate(actionMsg)}
              disabled={del.isPending}
              className="block w-full px-4 py-3.5 text-center text-[15px] font-semibold text-sonic-700 hover:bg-surface-muted disabled:opacity-50"
            >
              {del.isPending ? "Deleting…" : "Delete message"}
            </button>
            <div className="h-px bg-midnight-100" />
            <button
              type="button"
              onClick={() => setActionMsg(null)}
              className="block w-full px-4 py-3.5 text-center text-[15px] text-midnight-700 hover:bg-surface-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
