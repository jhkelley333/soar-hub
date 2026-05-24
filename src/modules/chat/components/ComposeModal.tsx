// Chat — Compose (new chat) sheet. Steps: picker → people/object →
// first message. People come from the live contacts endpoint; creating
// a thread hits the backend and routes to the new thread. Recent-work
// shortcuts are still sample (real WO/submission feed is a follow-up).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Users, ClipboardList, Megaphone, Search, Check, X } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchContacts,
  createThread,
  postBroadcast,
  type ChatContact,
  type CreateThreadBody,
  type BroadcastAudience,
} from "../api";

type Scope = "direct" | "group" | "tied" | "news";
type TiedKind = "submission" | "workorder";

const NEWS_POSTER_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];
const NEWS_COMPANY_ROLES = ["coo", "admin"];

interface WorkItem {
  id: string;
  kind: TiedKind;
  ref: string;
  title: string;
  sub: string;
}
const RECENT_WORK: WorkItem[] = [
  { id: "WO-2026-0418", kind: "workorder", ref: "WO-2026-0418", title: "Ice maker · SDI 4287", sub: "$3,840 · with GM Sarah Chen" },
  { id: "sub-3961", kind: "submission", ref: "SAFETY-3961", title: "Safety Check · Burleson", sub: "Resubmitted 8:54p · with GM Priya Mehta" },
  { id: "WO-2026-0392", kind: "workorder", ref: "WO-2026-0392", title: "Patio canopy · SDI 6033", sub: "$1,210 · approved" },
];

export function ComposeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();

  const role = String(profile?.role || "").toLowerCase();
  const canPostNews = NEWS_POSTER_ROLES.includes(role);
  const canPostCompany = NEWS_COMPANY_ROLES.includes(role);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [scope, setScope] = useState<Scope | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [objectId, setObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [newsTitle, setNewsTitle] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("subtree");
  const [q, setQ] = useState("");

  const contactsQ = useQuery({
    queryKey: ["chat", "contacts"],
    queryFn: fetchContacts,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const contacts: ChatContact[] = contactsQ.data?.contacts ?? [];

  const createMut = useMutation({
    mutationFn: (body: CreateThreadBody) => createThread(body),
    onSuccess: ({ threadId }) => {
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
      onCreated?.();
      close();
      navigate(`/chat/${threadId}`);
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't create the chat.", "error"),
  });

  const broadcastMut = useMutation({
    mutationFn: () =>
      postBroadcast({ title: newsTitle.trim(), text: message.trim(), audience }),
    onSuccess: ({ threadId }) => {
      qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
      onCreated?.();
      close();
      navigate(`/chat/${threadId}`);
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't post the update.", "error"),
  });

  function reset() {
    setStep(1);
    setScope(null);
    setPeople([]);
    setGroupName("");
    setObjectId(null);
    setMessage("");
    setNewsTitle("");
    setAudience("subtree");
    setQ("");
  }
  function close() {
    reset();
    onClose();
  }

  function startDirectWith(id: string) {
    setScope("direct");
    setPeople([id]);
    setStep(3);
  }
  function startTied(w: WorkItem) {
    setScope("tied");
    setObjectId(w.id);
    setStep(3);
  }
  function togglePerson(id: string) {
    if (scope === "direct") {
      setPeople([id]);
      setStep(3);
      return;
    }
    setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const selectedContacts = people
    .map((id) => contacts.find((c) => c.id === id))
    .filter(Boolean) as ChatContact[];
  const hasExternal = selectedContacts.some((c) => c.external);
  const filtered = q
    ? contacts.filter((c) => `${c.name} ${c.role}`.toLowerCase().includes(q.toLowerCase()))
    : contacts;

  function summaryLine(): string {
    if (scope === "tied") {
      const w = RECENT_WORK.find((x) => x.id === objectId);
      return w ? `${w.ref} · ${w.title}` : "Tied thread";
    }
    if (scope === "group") return groupName.trim() || "New group";
    return contacts.find((c) => c.id === people[0])?.name ?? "New chat";
  }

  function submit() {
    if (scope === "news") {
      broadcastMut.mutate();
      return;
    }
    let body: CreateThreadBody;
    if (scope === "group") {
      body = { kind: "group", title: groupName.trim(), participantUserIds: people };
    } else if (scope === "direct") {
      body = { kind: "direct", participantUserIds: [people[0]], firstMessage: message.trim() };
    } else {
      const w = RECENT_WORK.find((x) => x.id === objectId);
      if (!w) return;
      body = {
        kind: w.kind,
        title: `${w.ref} · ${w.title}`,
        subtitle: w.sub,
        scopeKind: w.kind,
        scopeRef: w.ref,
        firstMessage: message.trim(),
      };
    }
    createMut.mutate(body);
  }

  const title =
    step === 1
      ? "New message"
      : scope === "news"
        ? "Post an update"
        : scope === "group"
          ? "New group"
          : scope === "tied"
            ? "Tie to…"
            : step === 3
              ? "Message"
              : "Direct message";

  const footer = (() => {
    if (step === 1) return null;
    const back = (
      <button
        type="button"
        onClick={() => setStep(1)}
        className="h-10 rounded-lg px-3 text-[14px] font-medium text-midnight-600 hover:bg-surface-muted"
      >
        Back
      </button>
    );
    if (step === 2 && scope === "group") {
      return (
        <div className="flex items-center gap-2">
          {back}
          <button
            type="button"
            disabled={people.length === 0 || !groupName.trim() || createMut.isPending}
            onClick={submit}
            className="ml-auto h-10 rounded-lg bg-midnight-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            Create group · {people.length} {people.length === 1 ? "member" : "members"}
          </button>
        </div>
      );
    }
    if (step === 2 && scope === "news") {
      return (
        <div className="flex items-center gap-2">
          {back}
          <button
            type="button"
            disabled={!message.trim() || broadcastMut.isPending}
            onClick={submit}
            className="ml-auto h-10 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            {broadcastMut.isPending
              ? "Posting…"
              : audience === "company"
                ? "Post company-wide"
                : "Post to my team"}
          </button>
        </div>
      );
    }
    if (step === 2 && scope === "tied") {
      return (
        <div className="flex items-center gap-2">
          {back}
          <button
            type="button"
            disabled={!objectId}
            onClick={() => setStep(3)}
            className="ml-auto h-10 rounded-lg bg-midnight-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            Next
          </button>
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep(scope === "direct" ? 1 : 2)}
            className="h-10 rounded-lg px-3 text-[14px] font-medium text-midnight-600 hover:bg-surface-muted"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!message.trim() || createMut.isPending}
            onClick={submit}
            className="ml-auto h-10 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      );
    }
    return null;
  })();

  return (
    <Drawer open={open} onClose={close} title={title} footer={footer}>
      {step === 1 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Start something
          </p>
          <div className="space-y-2.5">
            <PickOption Icon={User} tint="frost" title="Direct message" sub="One-on-one with a teammate" onClick={() => { setScope("direct"); setStep(2); }} />
            <PickOption Icon={Users} tint="frost" title="New group" sub="Multiple people · name + member list" onClick={() => { setScope("group"); setStep(2); }} />
            <PickOption Icon={ClipboardList} tint="sonic" title="About a submission, WO, or store" sub="Auto-pulls participants and history" onClick={() => { setScope("tied"); setStep(2); }} />
            {canPostNews && (
              <PickOption Icon={Megaphone} tint="sonic" title="Post an update" sub="Announcement to your team — shows in News" onClick={() => { setScope("news"); setStep(2); }} />
            )}
          </div>

          {contacts.length > 0 && (
            <>
              <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Recent</p>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {contacts.slice(0, 6).map((c) => (
                  <button key={c.id} type="button" onClick={() => startDirectWith(c.id)} className="flex w-14 shrink-0 flex-col items-center gap-1">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-frost-100 text-[13px] font-semibold text-midnight-700">
                      {c.initials}
                    </span>
                    <span className="truncate text-[11px] text-midnight-600">{c.first}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Recent work</p>
          <ul className="divide-y divide-midnight-100">
            {RECENT_WORK.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => startTied(w)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", w.kind === "submission" ? "bg-frost-100 text-midnight-700" : "bg-sonic-50 text-sonic")}>
                    <ClipboardList className="h-[17px] w-[17px]" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[10.5px] uppercase tracking-wide text-midnight-400">{w.ref}</span>
                    <span className="block truncate text-[14px] font-medium text-midnight-900">{w.title}</span>
                    <span className="block truncate text-[12px] text-midnight-500">{w.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 2 && scope === "group" && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Group name</p>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-sunk text-midnight-400">
              <Users className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Name this group" className="min-w-0 flex-1 border-b border-midnight-200 pb-1 text-[16px] font-semibold text-midnight-900 placeholder:font-normal placeholder:text-midnight-400 focus:border-accent focus:outline-none" />
          </div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Members</p>
          {selectedContacts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedContacts.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-surface-sunk py-1 pl-1 pr-2 text-[12.5px] text-midnight-800">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-frost-100 text-[9px] font-semibold text-midnight-700">{c.initials}</span>
                  {c.first}
                  <button type="button" onClick={() => togglePerson(c.id)} aria-label={`Remove ${c.first}`}>
                    <X className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PeopleList contacts={filtered} q={q} setQ={setQ} selected={people} onToggle={togglePerson} hasExternal={hasExternal} loading={contactsQ.isLoading} />
        </div>
      )}

      {step === 2 && scope === "direct" && (
        <PeopleList contacts={filtered} q={q} setQ={setQ} selected={people} onToggle={togglePerson} hasExternal={hasExternal} loading={contactsQ.isLoading} />
      )}

      {step === 2 && scope === "news" && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Audience</p>
          <div className="mb-4 space-y-2">
            <AudienceOption
              active={audience === "subtree"}
              title="My team"
              sub="Everyone in your reporting line"
              onClick={() => setAudience("subtree")}
            />
            {canPostCompany && (
              <AudienceOption
                active={audience === "company"}
                title="Company-wide"
                sub="Every active user"
                onClick={() => setAudience("company")}
              />
            )}
          </div>

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Title (optional)</p>
          <input
            value={newsTitle}
            onChange={(e) => setNewsTitle(e.target.value)}
            placeholder="e.g. Q3 store standards update"
            className="mb-4 w-full rounded-xl border border-midnight-200 px-3 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-accent focus:outline-none"
          />

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">Message</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Write your announcement…"
            className="w-full resize-none rounded-xl border border-midnight-200 px-3 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-accent focus:outline-none"
          />
          <p className="mt-2 text-[12px] text-midnight-500">
            Recipients can read but not reply. They'll see it in their News tab.
          </p>
        </div>
      )}

      {step === 2 && scope === "tied" && (
        <ul className="divide-y divide-midnight-100">
          {RECENT_WORK.map((w) => {
            const sel = objectId === w.id;
            return (
              <li key={w.id}>
                <button type="button" onClick={() => setObjectId(w.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <div className="min-w-0 flex-1">
                    <span className="block font-mono text-[10.5px] uppercase tracking-wide text-midnight-400">{w.ref}</span>
                    <span className="block truncate text-[14px] font-medium text-midnight-900">{w.title}</span>
                    <span className="block truncate text-[12px] text-midnight-500">{w.sub}</span>
                  </div>
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", sel ? "border-accent bg-accent text-white" : "border-midnight-300")}>
                    {sel && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {step === 3 && (
        <div>
          <div className="mb-3 rounded-xl bg-surface-sunk px-3 py-2.5 text-[13px] text-midnight-700">
            To: <span className="font-semibold">{summaryLine()}</span>
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} autoFocus placeholder="Write the first message…" className="w-full resize-none rounded-xl border border-midnight-200 px-3 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-accent focus:outline-none" />
        </div>
      )}
    </Drawer>
  );
}

function PickOption({ Icon, tint, title, sub, onClick }: { Icon: typeof User; tint: "frost" | "sonic"; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl bg-surface p-3.5 text-left ring-1 ring-midnight-100 transition hover:ring-midnight-300">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tint === "sonic" ? "bg-sonic-50 text-sonic" : "bg-frost-100 text-midnight-700")}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-midnight-900">{title}</p>
        <p className="text-[12px] text-midnight-500">{sub}</p>
      </div>
    </button>
  );
}

function AudienceOption({ active, title, sub, onClick }: { active: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition",
        active ? "bg-accent/5 ring-accent" : "bg-surface ring-midnight-100 hover:ring-midnight-300",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-midnight-900">{title}</p>
        <p className="text-[12px] text-midnight-500">{sub}</p>
      </div>
      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", active ? "border-accent bg-accent text-white" : "border-midnight-300")}>
        {active && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

function PeopleList({ contacts, q, setQ, selected, onToggle, hasExternal, loading }: { contacts: ChatContact[]; q: string; setQ: (v: string) => void; selected: string[]; onToggle: (id: string) => void; hasExternal: boolean; loading: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-sunk px-3 py-2.5">
        <Search className="h-4 w-4 text-midnight-400" strokeWidth={2} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people…" className="min-w-0 flex-1 bg-transparent text-[14px] text-midnight-800 placeholder:text-midnight-400 focus:outline-none" />
      </div>
      {hasExternal && (
        <p className="mb-2 rounded-lg bg-sonic-50 px-3 py-2 text-[12px] text-sonic-700">
          Includes an external participant — they'll see this thread. Don't share confidential ops data.
        </p>
      )}
      {loading && <p className="py-4 text-center text-[12.5px] text-midnight-400">Loading people…</p>}
      <ul className="divide-y divide-midnight-100">
        {contacts.map((c) => {
          const sel = selected.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => onToggle(c.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-frost-100 text-[12px] font-semibold text-midnight-700">{c.initials}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-midnight-900">
                    {c.name}
                    {c.external && <span className="ml-1.5 rounded bg-sonic-50 px-1 py-0.5 text-[10px] font-semibold text-sonic-700">external</span>}
                  </p>
                  <p className="truncate text-[12px] text-midnight-500">{c.role}</p>
                </div>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", sel ? "border-accent bg-accent text-white" : "border-midnight-300")}>
                  {sel && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
