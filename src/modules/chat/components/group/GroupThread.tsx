// Chat — group / thread view (WhatsApp-style), full-screen takeover.
// Renders from the fetched thread payload; the composer posts via the
// send mutation and refetches.

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Search, MoreHorizontal, Paperclip, ArrowUp } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { MessageBubble } from "./MessageBubble";
import { SystemMessage } from "./SystemMessage";
import { MembersStrip, type StripMember } from "./MembersStrip";
import { ExternalBanner } from "./Banners";
import { sendChatMessage, uploadChatAttachment, type ThreadResponse } from "../../api";

export function GroupThread({
  threadId,
  data,
  currentUserId,
}: {
  threadId: string;
  data: ThreadResponse;
  currentUserId: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const send = useMutation({
    mutationFn: (text: string) => sendChatMessage(threadId, text),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Send failed.", "error"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const att = await uploadChatAttachment(threadId, file);
      await sendChatMessage(threadId, draft.trim(), [att]);
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Upload failed.", "error"),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (file) upload.mutate(file);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-muted">
      <div aria-hidden className="shrink-0 bg-midnight" style={{ height: "env(safe-area-inset-top, 0px)" }} />

      <header className="flex shrink-0 items-center gap-1 border-b border-midnight-100 bg-surface px-2 py-2">
        <button type="button" onClick={() => navigate("/chat")} className="rounded-full p-1.5 text-midnight-600 hover:bg-surface-muted" aria-label="Back to inbox">
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => isGroupy && navigate(`/chat/${threadId}/info`)}
          disabled={!isGroupy}
          className="min-w-0 flex-1 text-center disabled:cursor-default"
        >
          <p className="truncate text-[15px] font-semibold text-midnight-900">{headerTitle}</p>
          <p className="truncate text-[11.5px] text-midnight-500">{headerSubtitle}</p>
        </button>
        <button type="button" className="rounded-full p-1.5 text-midnight-500 hover:bg-surface-muted" aria-label="Search in thread">
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

      {thread.external && <ExternalBanner />}
      {isGroup && stripMembers.length > 0 && <MembersStrip members={stripMembers} />}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="py-10 text-center text-[13px] text-midnight-400">
            No messages yet — say hello.
          </p>
        )}
        {messages.map((m, i) => {
          if (m.system) return <SystemMessage key={m.id} text={m.text} at={m.at} />;
          const prev = messages[i - 1];
          const firstOfRun = !prev || prev.system || prev.fromUserId !== m.fromUserId;
          const sent = m.fromUserId === currentUserId;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              sent={sent}
              user={users[m.fromUserId]}
              showAvatar={firstOfRun}
              showName={firstOfRun && !sent}
            />
          );
        })}
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
          className="flex shrink-0 items-end gap-2.5 border-t border-midnight-100 bg-surface px-4 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          <input ref={fileInputRef} type="file" className="hidden" onChange={onPickFile} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="mb-1 shrink-0 text-midnight-400 transition hover:text-midnight-700 disabled:opacity-40"
            aria-label="Attach"
          >
            <Paperclip className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) send.mutate(draft.trim());
            }}
            placeholder={upload.isPending ? "Uploading…" : "Message"}
            disabled={upload.isPending}
            className="min-w-0 flex-1 rounded-[20px] border border-midnight-200 bg-surface px-4 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-midnight-300 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => draft.trim() && send.mutate(draft.trim())}
            disabled={!draft.trim() || send.isPending}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition disabled:bg-midnight-200"
            aria-label="Send"
          >
            <ArrowUp className="h-[20px] w-[20px]" strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}
