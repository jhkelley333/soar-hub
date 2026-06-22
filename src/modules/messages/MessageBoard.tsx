// Home-screen message board. Everyone sees the announcements addressed to them
// (and managers see what they posted in scope); each message shows the author,
// date, attachments, and a "I've read this" acknowledgement. GM and above get a
// "New message" button and a read count with a tap-through reader list.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Paperclip, Pin, Check, Trash2, Loader2, Users } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import {
  listMessages, markMessageRead, deleteMessage, fetchReaders,
  type StoreMessage,
} from "./api";
import { MessageComposeModal } from "./MessageComposeModal";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function MessageBoard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const q = useQuery({ queryKey: ["store-messages"], queryFn: listMessages, staleTime: 30_000 });
  const messages = q.data?.messages ?? [];
  const canPost = q.data?.canPost ?? false;

  const refresh = () => qc.invalidateQueries({ queryKey: ["store-messages"] });

  // Don't render an empty board for non-posters (keeps the dashboard clean).
  if (q.isLoading) return null;
  if (!canPost && messages.length === 0) return null;

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <Megaphone className="h-4 w-4 text-accent" /> Message board
          </div>
          {canPost && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> New message
            </button>
          )}
        </div>

        {messages.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
            No messages yet. Post one for your team.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} onChanged={refresh} />
            ))}
          </div>
        )}
      </CardBody>

      {composing && (
        <MessageComposeModal
          onClose={() => setComposing(false)}
          onPosted={() => { setComposing(false); toast.push("Message posted.", "success"); refresh(); }}
        />
      )}
    </Card>
  );
}

function MessageItem({ msg, onChanged }: { msg: StoreMessage; onChanged: () => void }) {
  const toast = useToast();
  const [showReaders, setShowReaders] = useState(false);

  const read = useMutation({
    mutationFn: () => markMessageRead(msg.id),
    onSuccess: onChanged,
    onError: (e: Error) => toast.push(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => deleteMessage(msg.id),
    onSuccess: () => { toast.push("Message removed.", "info"); onChanged(); },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-night-line">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {msg.is_pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
            <span className="text-sm font-semibold text-midnight dark:text-night-ink">{msg.title}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {msg.author_name || "—"} · {fmtDate(msg.created_at)}
            {msg.store_numbers.length > 0 && <> · Store{msg.store_numbers.length > 1 ? "s" : ""} {msg.store_numbers.join(", ")}</>}
          </div>
        </div>
        {msg.can_manage && (
          <button
            type="button"
            onClick={() => { if (confirm("Remove this message?")) remove.mutate(); }}
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
            aria-label="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {msg.body && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-night-muted">{msg.body}</p>}

      {msg.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {msg.attachments.map((a, i) => (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
            >
              <Paperclip className="h-3 w-3" /> <span className="max-w-[10rem] truncate">{a.name}</span>
            </a>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {/* Read acknowledgement */}
        {msg.has_read ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="h-3.5 w-3.5" /> You've read this
          </span>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-600">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={false} disabled={read.isPending} onChange={() => read.mutate()} />
            {read.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            I've read this
          </label>
        )}

        {msg.can_manage && (
          <button
            type="button"
            onClick={() => setShowReaders((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent"
          >
            <Users className="h-3.5 w-3.5" /> {msg.read_count} read
          </button>
        )}
      </div>

      {showReaders && msg.can_manage && <ReaderList id={msg.id} audience={msg.audience_roles} />}
    </div>
  );
}

function ReaderList({ id, audience }: { id: string; audience: UserRole[] }) {
  const q = useQuery({ queryKey: ["store-message-readers", id], queryFn: () => fetchReaders(id), staleTime: 15_000 });
  if (q.isLoading) return <div className="mt-2 text-[11px] text-zinc-400">Loading readers…</div>;
  const readers = q.data?.readers ?? [];
  const total = q.data?.recipientCount ?? 0;
  return (
    <div className="mt-2 rounded-lg bg-zinc-50 p-2 dark:bg-night-base/40">
      <div className="text-[11px] font-semibold text-zinc-600">
        {readers.length}{total ? ` of ${total}` : ""} acknowledged
        <span className="ml-1 font-normal text-zinc-400">· {audience.map((r) => ROLE_LABELS[r]).join(", ")}</span>
      </div>
      {readers.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {readers.map((r) => (
            <li key={r.user_id} className="flex items-center justify-between text-[11px] text-zinc-600">
              <span className="truncate">{r.user_name || "—"}</span>
              <span className="text-zinc-400">{fmtDate(r.read_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
