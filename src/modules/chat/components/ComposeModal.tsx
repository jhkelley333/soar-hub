// Chat — Compose (new chat) flow as a sheet (shared Drawer). Steps:
//   1. picker "New message": Direct / Group / About an object, plus
//      Recent people + Recent work shortcuts
//   2. per scope — pick people (direct), build the group (name + members,
//      "Create"), or pick the tied object
//   3. first message → Send  (direct / tied only; group creates directly)
// External members surface an "ext" chip + a cherry warning. Send/create
// is stubbed (toast) until the thread view + backend land.

import { useState } from "react";
import { User, Users, ClipboardList, Search, Check, X } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { cn } from "@/lib/cn";

type Scope = "direct" | "group" | "tied";
type TiedKind = "submission" | "workorder" | "store";

interface Contact {
  id: string;
  name: string;
  first: string;
  initials: string;
  role: string;
  external: boolean;
  online?: boolean;
}

const CONTACTS: Contact[] = [
  { id: "u-sarah", name: "GM Sarah Chen", first: "Sarah", initials: "SC", role: "GM · SDI 4287 · Mansfield", external: false, online: true },
  { id: "u-priya", name: "GM Priya Mehta", first: "Priya", initials: "PM", role: "GM · SDI 3961 · Burleson", external: false },
  { id: "u-diego", name: "GM Diego Alvarez", first: "Diego", initials: "DA", role: "GM · SDI 5102 · Cleburne", external: false, online: true },
  { id: "u-marcus", name: "DO Marcus Reyes · You", first: "Marcus", initials: "MR", role: "DO · D-14B · You", external: false },
  { id: "u-linda", name: "SDO Linda Chow", first: "Linda", initials: "LC", role: "SDO · Region 14 · Fort Worth", external: false, online: true },
  { id: "u-tyler", name: "GM Tyler Brooks", first: "Tyler", initials: "TB", role: "GM · SDI 4815 · Joshua", external: false },
  { id: "u-megan", name: "GM Megan O'Hara", first: "Megan", initials: "MO", role: "GM · SDI 2774 · Crowley", external: false },
  { id: "u-jenna", name: "Jenna Kim (Penguin)", first: "Jenna", initials: "JK", role: "Vendor · Refrigeration · External", external: true },
];

const RECENT_PEOPLE = ["u-sarah", "u-priya", "u-linda", "u-tyler", "u-diego"];

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

const TIED_LABEL: Record<string, string> = {};
RECENT_WORK.forEach((w) => (TIED_LABEL[w.id] = `${w.ref} · ${w.title}`));

export function ComposeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (summary: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [scope, setScope] = useState<Scope | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [objectId, setObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");

  function reset() {
    setStep(1);
    setScope(null);
    setPeople([]);
    setGroupName("");
    setObjectId(null);
    setMessage("");
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
    .map((id) => CONTACTS.find((c) => c.id === id))
    .filter(Boolean) as Contact[];
  const hasExternal = selectedContacts.some((c) => c.external);

  const filtered = q
    ? CONTACTS.filter((c) => `${c.name} ${c.role}`.toLowerCase().includes(q.toLowerCase()))
    : CONTACTS;

  function summaryLine(): string {
    if (scope === "tied") return objectId ? TIED_LABEL[objectId] ?? "Tied thread" : "Tied thread";
    if (scope === "group") return groupName.trim() || "New group";
    return CONTACTS.find((c) => c.id === people[0])?.name ?? "New chat";
  }
  function create(summary: string) {
    onCreated(summary);
    close();
  }

  const title =
    step === 1
      ? "New message"
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
            disabled={people.length === 0 || !groupName.trim()}
            onClick={() => create(groupName.trim())}
            className="ml-auto h-10 rounded-lg bg-midnight-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
          >
            Create group · {people.length} {people.length === 1 ? "member" : "members"}
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
            disabled={!message.trim()}
            onClick={() => create(summaryLine())}
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
      {/* STEP 1 — picker */}
      {step === 1 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Start something
          </p>
          <div className="space-y-2.5">
            <PickOption
              Icon={User}
              tint="frost"
              title="Direct message"
              sub="One-on-one with a teammate"
              onClick={() => {
                setScope("direct");
                setStep(2);
              }}
            />
            <PickOption
              Icon={Users}
              tint="frost"
              title="New group"
              sub="Multiple people · name + member list"
              onClick={() => {
                setScope("group");
                setStep(2);
              }}
            />
            <PickOption
              Icon={ClipboardList}
              tint="sonic"
              title="About a submission, WO, or store"
              sub="Auto-pulls participants and history"
              onClick={() => {
                setScope("tied");
                setStep(2);
              }}
            />
          </div>

          <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Recent
          </p>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {RECENT_PEOPLE.map((id) => {
              const c = CONTACTS.find((x) => x.id === id)!;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => startDirectWith(id)}
                  className="flex w-14 shrink-0 flex-col items-center gap-1"
                >
                  <span className="relative">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-frost-100 text-[13px] font-semibold text-midnight-700">
                      {c.initials}
                    </span>
                    {c.online && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-ok" />
                    )}
                  </span>
                  <span className="truncate text-[11px] text-midnight-600">{c.first}</span>
                </button>
              );
            })}
          </div>

          <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Recent work
          </p>
          <ul className="divide-y divide-midnight-100">
            {RECENT_WORK.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => startTied(w)}
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl",
                      w.kind === "submission"
                        ? "bg-frost-100 text-midnight-700"
                        : "bg-sonic-50 text-sonic",
                    )}
                  >
                    <ClipboardList className="h-[17px] w-[17px]" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[10.5px] uppercase tracking-wide text-midnight-400">
                      {w.ref}
                    </span>
                    <span className="block truncate text-[14px] font-medium text-midnight-900">
                      {w.title}
                    </span>
                    <span className="block truncate text-[12px] text-midnight-500">{w.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* STEP 2 — group */}
      {step === 2 && scope === "group" && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Group name
          </p>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-sunk text-midnight-400">
              <Users className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Name this group"
              className="min-w-0 flex-1 border-b border-midnight-200 pb-1 text-[16px] font-semibold text-midnight-900 placeholder:font-normal placeholder:text-midnight-400 focus:border-accent focus:outline-none"
            />
          </div>

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
            Members
          </p>
          {selectedContacts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedContacts.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-sunk py-1 pl-1 pr-2 text-[12.5px] text-midnight-800"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-frost-100 text-[9px] font-semibold text-midnight-700">
                    {c.initials}
                  </span>
                  {c.first}
                  <button type="button" onClick={() => togglePerson(c.id)} aria-label={`Remove ${c.first}`}>
                    <X className="h-3.5 w-3.5 text-midnight-400" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PeopleList
            contacts={filtered}
            q={q}
            setQ={setQ}
            selected={people}
            onToggle={togglePerson}
            hasExternal={hasExternal}
          />
        </div>
      )}

      {/* STEP 2 — direct */}
      {step === 2 && scope === "direct" && (
        <PeopleList
          contacts={filtered}
          q={q}
          setQ={setQ}
          selected={people}
          onToggle={togglePerson}
          hasExternal={hasExternal}
        />
      )}

      {/* STEP 2 — tied */}
      {step === 2 && scope === "tied" && (
        <ul className="divide-y divide-midnight-100">
          {RECENT_WORK.map((w) => {
            const sel = objectId === w.id;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setObjectId(w.id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block font-mono text-[10.5px] uppercase tracking-wide text-midnight-400">
                      {w.ref}
                    </span>
                    <span className="block truncate text-[14px] font-medium text-midnight-900">
                      {w.title}
                    </span>
                    <span className="block truncate text-[12px] text-midnight-500">{w.sub}</span>
                  </div>
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border",
                      sel ? "border-accent bg-accent text-white" : "border-midnight-300",
                    )}
                  >
                    {sel && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* STEP 3 — message */}
      {step === 3 && (
        <div>
          <div className="mb-3 rounded-xl bg-surface-sunk px-3 py-2.5 text-[13px] text-midnight-700">
            To: <span className="font-semibold">{summaryLine()}</span>
            {scope === "direct" && people.length > 1 && ` +${people.length - 1}`}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            autoFocus
            placeholder="Write the first message…"
            className="w-full resize-none rounded-xl border border-midnight-200 px-3 py-2.5 text-[15px] text-midnight-900 placeholder:text-midnight-400 focus:border-accent focus:outline-none"
          />
        </div>
      )}
    </Drawer>
  );
}

function PickOption({
  Icon,
  tint,
  title,
  sub,
  onClick,
}: {
  Icon: typeof User;
  tint: "frost" | "sonic";
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl bg-surface p-3.5 text-left ring-1 ring-midnight-100 transition hover:ring-midnight-300"
    >
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl",
          tint === "sonic" ? "bg-sonic-50 text-sonic" : "bg-frost-100 text-midnight-700",
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-midnight-900">{title}</p>
        <p className="text-[12px] text-midnight-500">{sub}</p>
      </div>
    </button>
  );
}

function PeopleList({
  contacts,
  q,
  setQ,
  selected,
  onToggle,
  hasExternal,
}: {
  contacts: Contact[];
  q: string;
  setQ: (v: string) => void;
  selected: string[];
  onToggle: (id: string) => void;
  hasExternal: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-sunk px-3 py-2.5">
        <Search className="h-4 w-4 text-midnight-400" strokeWidth={2} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add people…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-midnight-800 placeholder:text-midnight-400 focus:outline-none"
        />
      </div>
      {hasExternal && (
        <p className="mb-2 rounded-lg bg-sonic-50 px-3 py-2 text-[12px] text-sonic-700">
          Includes an external participant — they'll see this thread. Don't share
          confidential ops data.
        </p>
      )}
      <ul className="divide-y divide-midnight-100">
        {contacts.map((c) => {
          const sel = selected.includes(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onToggle(c.id)}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <span className="relative">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-frost-100 text-[12px] font-semibold text-midnight-700">
                    {c.initials}
                  </span>
                  {c.online && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-midnight-900">
                    {c.name}
                    {c.external && (
                      <span className="ml-1.5 rounded bg-sonic-50 px-1 py-0.5 text-[10px] font-semibold text-sonic-700">
                        external
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-midnight-500">{c.role}</p>
                </div>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    sel ? "border-accent bg-accent text-white" : "border-midnight-300",
                  )}
                >
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
