// Chat — Compose (new chat) flow. Sheet on mobile / dialog on desktop
// via the shared Drawer. Three steps:
//   1. scope: Direct · Group · Tied to (submission / WO / store)
//   2. pick people (Contacts) or pick the object
//   3. first message → "send" (stubbed: toasts + closes until backend)
// Adding an external participant surfaces a cherry warning inline.

import { useState } from "react";
import { User, Users, Link2, Search, Check, ChevronLeft } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { cn } from "@/lib/cn";

type Scope = "direct" | "group" | "tied";
type TiedKind = "submission" | "workorder" | "store";

interface Contact {
  id: string;
  name: string;
  initials: string;
  role: string;
  external: boolean;
}

const CONTACTS: Contact[] = [
  { id: "u-sarah", name: "Sarah Chen", initials: "SC", role: "GM · SDI 4287", external: false },
  { id: "u-priya", name: "Priya Mehta", initials: "PM", role: "GM · SDI 3961", external: false },
  { id: "u-linda", name: "Linda Chow", initials: "LC", role: "SDO · Area 9", external: false },
  { id: "u-diego", name: "Diego Alvarez", initials: "DA", role: "GM · SDI 2774", external: false },
  { id: "u-tyler", name: "Tyler Brooks", initials: "TB", role: "DO · Market 14B", external: false },
  { id: "u-penguin", name: "Penguin Refrigeration", initials: "PR", role: "Vendor · penguin-ref.com", external: true },
];

const OBJECTS: Record<TiedKind, { id: string; label: string; sub: string }[]> = {
  workorder: [
    { id: "WO-2026-0418", label: "WO-2026-0418 · Ice maker", sub: "SDI 4287 · Mansfield, TX" },
    { id: "WO-2026-0392", label: "WO-2026-0392 · Fryer", sub: "SDI 3961 · Burleson, TX" },
  ],
  submission: [
    { id: "sub-3961", label: "Safety Check · SDI 3961", sub: "Resubmitted" },
    { id: "sub-2774", label: "Walkthrough · SDI 2774", sub: "In review" },
  ],
  store: [
    { id: "4287", label: "SDI 4287 · Mansfield, TX", sub: "District 14B" },
    { id: "3961", label: "SDI 3961 · Burleson, TX", sub: "District 14B" },
  ],
};

const SCOPES: { id: Scope; label: string; sub: string; Icon: typeof User }[] = [
  { id: "direct", label: "Direct", sub: "One-on-one message", Icon: User },
  { id: "group", label: "Group", sub: "Named group conversation", Icon: Users },
  { id: "tied", label: "Tied to…", sub: "Submission, work order, or store", Icon: Link2 },
];

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
  const [tiedKind, setTiedKind] = useState<TiedKind>("workorder");
  const [people, setPeople] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [objectId, setObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");

  function reset() {
    setStep(1);
    setScope(null);
    setTiedKind("workorder");
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

  function pickScope(s: Scope) {
    setScope(s);
    setPeople([]);
    setObjectId(null);
    setStep(2);
  }

  function togglePerson(id: string) {
    if (scope === "direct") {
      setPeople([id]);
      return;
    }
    setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  const hasExternal = people.some((id) => CONTACTS.find((c) => c.id === id)?.external);

  const step2Valid =
    scope === "tied"
      ? !!objectId
      : scope === "group"
        ? people.length >= 1 && groupName.trim().length > 0
        : people.length === 1;

  const filteredContacts = q
    ? CONTACTS.filter((c) =>
        `${c.name} ${c.role}`.toLowerCase().includes(q.toLowerCase()),
      )
    : CONTACTS;

  function summaryLine(): string {
    if (scope === "tied") {
      const o = OBJECTS[tiedKind].find((x) => x.id === objectId);
      return o?.label ?? "Tied thread";
    }
    if (scope === "group") return groupName.trim() || "New group";
    const c = CONTACTS.find((x) => x.id === people[0]);
    return c?.name ?? "New chat";
  }

  function send() {
    onCreated(summaryLine());
    close();
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title="New chat"
      footer={
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2)}
              className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-[14px] font-medium text-midnight-600 hover:bg-surface-muted"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              Back
            </button>
          )}
          <div className="ml-auto">
            {step === 2 && (
              <button
                type="button"
                disabled={!step2Valid}
                onClick={() => setStep(3)}
                className="h-10 rounded-lg bg-midnight-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                disabled={!message.trim()}
                onClick={send}
                className="h-10 rounded-lg bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
        </div>
      }
    >
      {/* Step dots */}
      <div className="mb-4 flex items-center gap-1.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              "h-1.5 rounded-full transition-all",
              n === step ? "w-6 bg-accent" : "w-1.5 bg-midnight-200",
            )}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-2.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickScope(s.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-surface p-3.5 text-left ring-1 ring-midnight-100 transition hover:ring-midnight-300"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-frost-100 text-midnight-700">
                <s.Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold text-midnight-900">{s.label}</p>
                <p className="text-[12px] text-midnight-500">{s.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 2 && scope !== "tied" && (
        <div>
          {scope === "group" && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="mb-3 w-full rounded-xl border border-midnight-200 px-3 py-2.5 text-[15px] text-midnight-900 focus:border-accent focus:outline-none"
            />
          )}
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-sunk px-3 py-2.5">
            <Search className="h-4 w-4 text-midnight-400" strokeWidth={2} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people…"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-midnight-800 placeholder:text-midnight-400 focus:outline-none"
            />
          </div>
          {hasExternal && (
            <p className="mb-2 rounded-lg bg-sonic-50 px-3 py-2 text-[12px] text-sonic-700">
              Includes an external participant — they'll see this thread. Don't
              share confidential ops data.
            </p>
          )}
          <ul className="divide-y divide-midnight-100">
            {filteredContacts.map((c) => {
              const sel = people.includes(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => togglePerson(c.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-frost-100 text-[12px] font-semibold text-midnight-700">
                      {c.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-midnight-900">
                        {c.name}
                        {c.external && (
                          <span className="ml-1.5 rounded bg-sonic-50 px-1 py-0.5 text-[10px] font-semibold text-sonic-700">
                            ext
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
      )}

      {step === 2 && scope === "tied" && (
        <div>
          <div className="mb-3 flex gap-2">
            {(["workorder", "submission", "store"] as TiedKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setTiedKind(k);
                  setObjectId(null);
                }}
                className={cn(
                  "h-8 rounded-full px-3 text-[12.5px] font-medium capitalize transition",
                  tiedKind === k
                    ? "bg-midnight-900 text-white"
                    : "bg-surface-sunk text-midnight-600",
                )}
              >
                {k === "workorder" ? "Work order" : k}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-midnight-100">
            {OBJECTS[tiedKind].map((o) => {
              const sel = objectId === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setObjectId(o.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-midnight-900">
                        {o.label}
                      </p>
                      <p className="truncate text-[12px] text-midnight-500">{o.sub}</p>
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
      )}

      {step === 3 && (
        <div>
          <div className="mb-3 rounded-xl bg-surface-sunk px-3 py-2.5 text-[13px] text-midnight-700">
            To: <span className="font-semibold">{summaryLine()}</span>
            {scope !== "tied" && people.length > 1 && ` +${people.length - 1}`}
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
