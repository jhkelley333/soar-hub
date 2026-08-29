// /myhub — MyHub issue tracker. A shared feedback board for the Hub itself:
// anyone files an issue or idea, everyone can upvote, admins triage/resolve.
// Reporters get notified (email + push + a nav badge) when their ticket moves.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Lightbulb, ChevronUp, MessageSquare, Plus, ShieldCheck, ImageIcon, MapPin } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Modal } from "@/shared/ui/Modal";
import { Segmented } from "@/shared/ui/Segmented";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  listHubTickets, getHubTicket, voteHubTicket, commentHubTicket, setHubTicketStatus,
} from "./api";
import { NewTicketModal } from "./NewTicketModal";
import type { HubTicket, HubStatus, HubKind } from "./types";
import { STATUS_LABEL } from "./types";

const STATUS_TONE: Record<HubStatus, string> = {
  open: "bg-amber-50 text-amber-700 ring-amber-200",
  planned: "bg-sky-50 text-sky-700 ring-sky-200",
  in_progress: "bg-accent-100 text-accent-700 ring-accent-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};
const STATUSES: HubStatus[] = ["open", "planned", "in_progress", "resolved", "declined"];
const relTime = (s: string) => {
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function StatusChip({ status }: { status: HubStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function MyHubPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const toast = useToast();
  const qc = useQueryClient();

  const [kind, setKind] = useState<HubKind | "">("");
  const [status, setStatus] = useState<HubStatus | "">("");
  const [mine, setMine] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["hub-tickets", { kind, status, mine }],
    queryFn: () => listHubTickets({ kind, status, mine }),
    refetchOnWindowFocus: true,
  });
  const tickets = q.data?.tickets ?? [];

  const voteMut = useMutation({
    mutationFn: (id: string) => voteHubTicket(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hub-tickets"] }),
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't vote.", "error"),
  });

  return (
    <>
      <PageHeader
        title="Support Tickets"
        description="Report an issue or share an idea for the Hub. Upvote what matters — you'll be notified when yours is resolved."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" /> New ticket</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={kind || "all"}
          onChange={(v) => setKind(v === "all" ? "" : (v as HubKind))}
          options={[{ value: "all", label: "All" }, { value: "issue", label: "Issues" }, { value: "idea", label: "Ideas" }]}
        />
        <div className="flex flex-wrap gap-1">
          <FilterChip active={status === ""} onClick={() => setStatus("")}>Any status</FilterChip>
          {STATUSES.map((s) => (
            <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</FilterChip>
          ))}
        </div>
        <FilterChip active={mine} onClick={() => setMine((v) => !v)}>Mine</FilterChip>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load MyHub" description={(q.error as Error)?.message ?? "Try again."} />
      ) : tickets.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Be the first to file an issue or idea for the Hub." />
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <TicketRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} onVote={() => voteMut.mutate(t.id)} voting={voteMut.isPending} />
          ))}
        </div>
      )}

      <NewTicketModal open={createOpen} onClose={() => setCreateOpen(false)} pagePath="" />
      {openId && <DetailModal id={openId} isAdmin={!!isAdmin} onClose={() => setOpenId(null)} />}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
        active ? "bg-accent text-white ring-accent" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")}>
      {children}
    </button>
  );
}

function TicketRow({ t, onOpen, onVote, voting }: { t: HubTicket; onOpen: () => void; onVote: () => void; voting: boolean }) {
  const Icon = t.kind === "idea" ? Lightbulb : Bug;
  return (
    <Card>
      <CardBody className="flex items-center gap-3 p-3">
        <button type="button" onClick={onVote} disabled={voting}
          className={cn("flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5 transition",
            t.my_vote ? "border-accent-300 bg-accent-50 text-accent-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-accent-200")}>
          <ChevronUp className="h-4 w-4" />
          <span className="text-sm font-semibold tabular-nums">{t.upvotes}</span>
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", t.kind === "idea" ? "text-amber-500" : "text-sonic-500")} />
            <span className="truncate text-sm font-medium text-midnight dark:text-night-ink">{t.title}</span>
            <StatusChip status={t.status} />
            {t.has_update && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Updated" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span>{t.created_by_name || "Someone"}</span>
            <span>· {relTime(t.created_at)}</span>
            {(t.comment_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" /> {t.comment_count}</span>
            )}
            {t.has_photo && <ImageIcon className="h-3 w-3" aria-label="Has photo" />}
            {t.page_path && (
              <span className="inline-flex items-center gap-0.5 font-mono text-zinc-400"><MapPin className="h-3 w-3" /> {t.page_path}</span>
            )}
          </div>
        </button>
      </CardBody>
    </Card>
  );
}

function DetailModal({ id, isAdmin, onClose }: { id: string; isAdmin: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [statusDraft, setStatusDraft] = useState<HubStatus | null>(null);
  const [note, setNote] = useState("");

  const q = useQuery({ queryKey: ["hub-ticket", id], queryFn: () => getHubTicket(id) });
  const ticket = q.data?.ticket;
  const comments = q.data?.comments ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hub-ticket", id] });
    qc.invalidateQueries({ queryKey: ["hub-tickets"] });
    qc.invalidateQueries({ queryKey: ["hub-my-updates"] });
  };

  const commentMut = useMutation({
    mutationFn: () => commentHubTicket(id, comment.trim()),
    onSuccess: () => { setComment(""); refresh(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't post.", "error"),
  });
  const voteMut = useMutation({
    mutationFn: () => voteHubTicket(id),
    onSuccess: refresh,
  });
  const statusMut = useMutation({
    mutationFn: (s: HubStatus) => setHubTicketStatus(id, s, note.trim() || undefined),
    onSuccess: () => { setStatusDraft(null); setNote(""); refresh(); toast.push("Status updated.", "success"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update.", "error"),
  });

  return (
    <Modal open onClose={onClose} title={ticket?.title || "Ticket"} maxWidth="max-w-2xl">
      {q.isLoading || !ticket ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={ticket.status} />
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {ticket.kind === "idea" ? "Idea" : "Issue"}
            </span>
            <button type="button" onClick={() => voteMut.mutate()}
              className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                ticket.my_vote ? "bg-accent-50 text-accent-700 ring-accent-200" : "bg-white text-zinc-600 ring-zinc-200")}>
              <ChevronUp className="h-3.5 w-3.5" /> {ticket.upvotes}
            </button>
            <span className="text-[11px] text-zinc-400">by {ticket.created_by_name || "Someone"} · {relTime(ticket.created_at)}</span>
          </div>

          {ticket.page_path && (
            <p className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="h-3.5 w-3.5 text-zinc-400" /> Reported from <span className="font-mono">{ticket.page_path}</span>
            </p>
          )}
          {ticket.description && <p className="whitespace-pre-wrap text-sm text-zinc-700">{ticket.description}</p>}
          {ticket.photo_url && (
            <a href={ticket.photo_url} target="_blank" rel="noreferrer" className="block">
              <img src={ticket.photo_url} alt="attachment" className="max-h-72 rounded-lg ring-1 ring-zinc-200" />
            </a>
          )}
          {ticket.resolution_note && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span className="font-semibold">Resolution:</span> {ticket.resolution_note}
            </div>
          )}

          {/* Admin controls */}
          {isAdmin && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </div>
              <div className="flex flex-wrap gap-1">
                {STATUSES.map((s) => (
                  <button key={s} type="button" onClick={() => setStatusDraft(s)}
                    className={cn("rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition",
                      (statusDraft ?? ticket.status) === s ? "bg-accent text-white ring-accent" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              {statusDraft && statusDraft !== ticket.status && (
                <div className="mt-2 space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
                    placeholder="Note to the reporter (optional) — included in their notification."
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => statusMut.mutate(statusDraft)} disabled={statusMut.isPending}>
                      Set to {STATUS_LABEL[statusDraft]}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setStatusDraft(null); setNote(""); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Comments */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Discussion</h3>
            <div className="space-y-2">
              {comments.length === 0 && <p className="text-xs text-zinc-400">No comments yet.</p>}
              {comments.map((c) => (
                <div key={c.id} className={cn("rounded-lg px-3 py-2 text-sm", c.is_admin ? "bg-accent-50" : "bg-zinc-50")}>
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="font-semibold text-zinc-700">{c.author_name || "Someone"}</span>
                    {c.is_admin && <span className="rounded bg-accent-100 px-1 text-[9px] font-bold uppercase text-accent-700">Admin</span>}
                    <span>· {relTime(c.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-zinc-700">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…"
                onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) commentMut.mutate(); }} />
              <Button onClick={() => commentMut.mutate()} disabled={!comment.trim() || commentMut.isPending}>Post</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
