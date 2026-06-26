// Message detail popup — opened from a board row so the dashboard stays short.
// Shows the full message + attachments + prominent links (training reads
// "Click here"), a collapsed store list, the read acknowledgement, and author
// actions (edit / delete / who's read).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Pin, Paperclip, GraduationCap, Link2, Check, Loader2, Users, Pencil, Trash2, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { markMessageRead, deleteMessage, fetchReaders, type StoreMessage } from "./api";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function MessageDetailModal({
  message: m, onClose, onChanged, onEdit,
}: {
  message: StoreMessage;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (m: StoreMessage) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showStores, setShowStores] = useState(false);
  const [showReaders, setShowReaders] = useState(false);

  const read = useMutation({
    mutationFn: () => markMessageRead(m.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["store-messages"] }); onChanged(); },
    onError: (e: Error) => toast.push(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => deleteMessage(m.id),
    onSuccess: () => { toast.push("Message removed.", "info"); onChanged(); onClose(); },
    onError: (e: Error) => toast.push(e.message, "error"),
  });

  const links = m.links ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-zinc-100 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {m.is_pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
              <span className="text-base font-semibold tracking-tight text-midnight">{m.title}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {m.author_name || "—"} · {fmtDate(m.created_at)}
              {m.edited_at && <span className="italic"> · edited</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {m.body && <p className="whitespace-pre-wrap text-sm text-zinc-700">{m.body}</p>}

          {/* Prominent links */}
          {links.length > 0 && (
            <div className="space-y-2">
              {links.map((l, i) => {
                const internal = l.url.startsWith("/");
                const label = l.training ? `Click here — ${l.label}` : (l.label || l.url);
                const cls = `flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold ${l.training ? "bg-qsr-azure text-white hover:opacity-90" : "border border-accent/40 bg-accent/5 text-accent hover:bg-accent/10"}`;
                const Icon = l.training ? GraduationCap : (internal ? Link2 : ExternalLink);
                const inner = <><Icon className="h-4 w-4" /> <span className="truncate">{label}</span></>;
                return internal
                  ? <Link key={i} to={l.url} onClick={onClose} className={cls}>{inner}</Link>
                  : <a key={i} href={l.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
              })}
            </div>
          )}

          {/* Attachments */}
          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50">
                  <Paperclip className="h-3 w-3" /> <span className="max-w-[12rem] truncate">{a.name}</span>
                </a>
              ))}
            </div>
          )}

          {/* Collapsed store list */}
          {m.store_numbers.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowStores((s) => !s)} className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                {showStores ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Posted to {m.store_numbers.length} store{m.store_numbers.length === 1 ? "" : "s"}
              </button>
              {showStores && <div className="mt-1 text-[11px] text-zinc-500">{m.store_numbers.join(", ")}</div>}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-zinc-100 px-5 py-3">
          {/* Read acknowledgement */}
          {m.has_read ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check className="h-3.5 w-3.5" /> You've read this
            </span>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-700">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={false} disabled={read.isPending} onChange={() => read.mutate()} />
              {read.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              I've read this
            </label>
          )}

          {m.can_manage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onEdit(m)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <button type="button" onClick={() => setShowReaders((s) => !s)} className="inline-flex items-center gap-1 text-[11px] font-medium text-accent">
                <Users className="h-3.5 w-3.5" /> {m.read_count} read
              </button>
              <button type="button" onClick={() => { if (confirm("Remove this message?")) remove.mutate(); }} className="ml-auto inline-flex items-center gap-1 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {showReaders && m.can_manage && <ReaderList id={m.id} audience={m.audience_roles} />}
        </div>
      </div>
    </div>
  );
}

function ReaderList({ id, audience }: { id: string; audience: UserRole[] }) {
  const q = useQuery({ queryKey: ["store-message-readers", id], queryFn: () => fetchReaders(id), staleTime: 15_000 });
  if (q.isLoading) return <div className="text-[11px] text-zinc-400">Loading readers…</div>;
  const readers = q.data?.readers ?? [];
  const total = q.data?.recipientCount ?? 0;
  return (
    <div className="rounded-lg bg-zinc-50 p-2">
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
