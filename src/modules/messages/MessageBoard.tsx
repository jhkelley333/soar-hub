// Home-screen message board. Compact rows keep the dashboard short — tapping a
// row opens the full message in a popup. GM and above get a "New message"
// button; rows hint at attachments / links and flag unread + edited.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Paperclip, Pin, Link2, GraduationCap, ChevronRight } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { useToast } from "@/shared/ui/Toaster";
import { listMessages, type StoreMessage } from "./api";
import { MessageComposeModal } from "./MessageComposeModal";
import { MessageDetailModal } from "./MessageDetailModal";

const fmtShort = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function MessageBoard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<StoreMessage | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["store-messages"], queryFn: listMessages, staleTime: 30_000 });
  const messages = q.data?.messages ?? [];
  const canPost = q.data?.canPost ?? false;
  const refresh = () => qc.invalidateQueries({ queryKey: ["store-messages"] });
  const detail = messages.find((m) => m.id === detailId) ?? null;

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
              onClick={() => { setEditing(null); setComposing(true); }}
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
          <ul className="divide-y divide-zinc-100">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(m.id)}
                  className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-zinc-50"
                >
                  {!m.has_read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
                  {m.is_pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-midnight dark:text-night-ink">{m.title}</span>
                      {(m.links ?? []).some((l) => l.training) && <GraduationCap className="h-3.5 w-3.5 shrink-0 text-qsr-azure" />}
                      {(m.links ?? []).some((l) => !l.training) && <Link2 className="h-3 w-3 shrink-0 text-zinc-400" />}
                      {m.attachments.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-zinc-400" />}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {m.author_name || "—"} · {fmtShort(m.created_at)}{m.edited_at && <span className="italic"> · edited</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {detail && (
        <MessageDetailModal
          message={detail}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
          onEdit={(m) => { setDetailId(null); setEditing(m); setComposing(true); }}
        />
      )}

      {composing && (
        <MessageComposeModal
          editing={editing}
          onClose={() => { setComposing(false); setEditing(null); }}
          onPosted={() => { setComposing(false); setEditing(null); toast.push(editing ? "Message updated." : "Message posted.", "success"); refresh(); }}
        />
      )}
    </Card>
  );
}
