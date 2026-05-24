// Chat — sample inbox data matching the "Inbox D — Combined" design.
// Replace with a real Netlify function + Supabase query when the chat
// backend lands; the UI reads only from these shapes.

import type { ChatThread, ChatMessage } from "./types";

export const CURRENT_USER_ID = "u-me";

export const USERS: Record<
  string,
  { name: string; first: string; initials: string; online?: boolean }
> = {
  "u-me": { name: "You", first: "You", initials: "MR" },
  "u-sarah": { name: "Sarah Chen", first: "Sarah", initials: "SC", online: true },
  "u-priya": { name: "Priya Mehta", first: "Priya", initials: "PM" },
  "u-megan": { name: "Megan O'Hara", first: "Megan", initials: "MO", online: true },
  "u-andre": { name: "Andre Whitfield", first: "Andre", initials: "AW" },
  "u-tyler": { name: "Tyler Brooks", first: "Tyler", initials: "TB" },
  "u-diego": { name: "Diego Alvarez", first: "Diego", initials: "DA", online: true },
  "u-linda": { name: "Linda Chow", first: "Linda", initials: "LC", online: true },
  "u-janelle": { name: "Janelle Aoki", first: "Janelle", initials: "JA" },
};

// Sample messages per thread. Replace with a backend query later.
const MESSAGES: Record<string, ChatMessage[]> = {
  "grp-d14b-gms": [
    { id: "m1", threadId: "grp-d14b-gms", fromUserId: "u-sarah", text: "Yep — switched over last Friday. Zero complaints. Part #SD-LID-3X.", at: "Tue 4:18p" },
    { id: "m2", threadId: "grp-d14b-gms", fromUserId: "u-priya", text: "Filing the requisition tonight. Thanks.", at: "Tue 4:22p" },
    { id: "m3", threadId: "grp-d14b-gms", fromUserId: "u-megan", text: "@Marcus quick one — can I push the Crowley resubmission to Friday? My carhop closer is out today.", at: "Wed 8:31a" },
    { id: "m4", threadId: "grp-d14b-gms", fromUserId: "u-me", text: "Yes — push to Friday EOD. Reply here when posted so I get the heads-up.", at: "Wed 8:34a" },
    { id: "m5", threadId: "grp-d14b-gms", fromUserId: "u-megan", text: "👍 will do. (sorry, no emoji, ack.)", at: "Wed 8:35a" },
    { id: "m6", threadId: "grp-d14b-gms", fromUserId: "system", text: "GM Tyler Brooks pinned a message.", at: "Today 9:02a", system: true },
    { id: "m7", threadId: "grp-d14b-gms", fromUserId: "u-andre", text: "Pin for visibility: Sonic Day 4-week ramp doc is in the regional drive — start staffing now.", at: "Today 11:14a" },
  ],
  "dm-linda": [
    { id: "l1", threadId: "dm-linda", fromUserId: "u-linda", text: "Got 5 min after lunch? Want to talk about the Crowley resubmission.", at: "10:12a" },
  ],
};

// Members per thread (for the members strip). Falls back to participants.
const MEMBERS: Record<string, string[]> = {
  "grp-d14b-gms": ["u-sarah", "u-priya", "u-diego", "u-megan", "u-andre", "u-tyler", "u-linda", "u-me"],
};

export function getThreadById(id: string): ChatThread | undefined {
  return SAMPLE_THREADS.find((t) => t.id === id);
}

export function getMessages(id: string): ChatMessage[] {
  return MESSAGES[id] ?? [];
}

export function getMembers(id: string): string[] {
  return MEMBERS[id] ?? getThreadById(id)?.participantUserIds ?? [];
}

const PINNED: Record<string, string> = {
  "grp-d14b-gms":
    "Sonic Day 4-week ramp doc is in the regional drive — start staffing now.",
};

export function getPinned(id: string): string | undefined {
  return PINNED[id];
}

// Relative timestamps are pre-baked as display strings in `at`; updatedAt
// is a real ISO so sort order works. (When wired to a backend, format
// `at` from updatedAt instead.)
export const SAMPLE_THREADS: ChatThread[] = [
  {
    id: "wo-2026-0418",
    kind: "workorder",
    title: "WO-2026-0418 · Ice maker",
    subtitle: "SDI 4287 · Mansfield, TX",
    scope: { kind: "workorder", refId: "WO-2026-0418" },
    participantUserIds: ["u-sarah", "u-me"],
    external: false,
    pinned: false,
    needsYou: true,
    status: { kind: "warn", label: "Needs info" },
    lastMessage: {
      fromUserId: "u-sarah",
      text: "GM Sarah Chen: Posted the warranty doc — Penguin says they'll honor it.",
      at: "11:42a",
    },
    unreadCount: 0,
    mentionedCount: 0,
    updatedAt: "2026-05-24T11:42:00Z",
  },
  {
    id: "sub-safety-3961",
    kind: "submission",
    title: "Safety Check · SDI 3961",
    subtitle: "Burleson, TX · Resubmitted",
    scope: { kind: "submission", refId: "sub-3961" },
    participantUserIds: ["u-priya", "u-me"],
    external: false,
    pinned: false,
    needsYou: true,
    status: { kind: "review", label: "Awaiting review" },
    lastMessage: {
      fromUserId: "u-priya",
      text: "GM Priya Mehta: Here's the dusk shot. Top-right segment is dead, the rest flickers.",
      at: "8:54p",
    },
    unreadCount: 0,
    mentionedCount: 0,
    updatedAt: "2026-05-23T20:54:00Z",
  },
  {
    id: "dm-linda",
    kind: "direct",
    title: "SDO Linda Chow",
    subtitle: "",
    participantUserIds: ["u-linda", "u-me"],
    external: false,
    pinned: false,
    needsYou: false,
    lastMessage: {
      fromUserId: "u-linda",
      text: "Got 5 min after lunch? Want to talk about the Crowley resubmission.",
      at: "10:12a",
    },
    unreadCount: 1,
    mentionedCount: 0,
    updatedAt: "2026-05-24T10:12:00Z",
  },
  {
    id: "bc-region14-weekly",
    kind: "broadcast",
    title: "Region 14 · Weekly note",
    subtitle: "",
    participantUserIds: [],
    external: false,
    pinned: false,
    needsYou: false,
    fromLabel: "From RVP Janelle Aoki",
    lastMessage: {
      fromUserId: "u-janelle",
      text: "Quick thanks to District 14B — best week-over-week move in the region.",
      at: "7:30a",
    },
    unreadCount: 0,
    mentionedCount: 0,
    updatedAt: "2026-05-24T07:30:00Z",
  },
  {
    id: "grp-d14b-gms",
    kind: "group",
    title: "District 14B · GMs",
    subtitle: "8 members",
    participantUserIds: ["u-sarah", "u-priya", "u-diego", "u-me"],
    external: false,
    pinned: false,
    needsYou: false,
    memberCount: 8,
    memberInitials: ["SC", "M"],
    lastMessage: {
      fromUserId: "u-diego",
      text: "Diego Alvarez: Anyone tried that new lid SKU for the large cups?",
      at: "Yesterday",
    },
    unreadCount: 3,
    mentionedCount: 0,
    updatedAt: "2026-05-23T16:00:00Z",
  },
  {
    id: "grp-region14-dos",
    kind: "group",
    title: "Region 14 · DOs",
    subtitle: "4 members",
    participantUserIds: ["u-heath", "u-tyler", "u-me"],
    external: false,
    pinned: false,
    needsYou: false,
    memberCount: 4,
    memberInitials: ["HF", "TB"],
    lastMessage: {
      fromUserId: "u-tyler",
      text: "Tyler Brooks: Pushing the ramp doc review to Thursday.",
      at: "Mon",
    },
    unreadCount: 2,
    mentionedCount: 0,
    updatedAt: "2026-05-19T09:00:00Z",
  },
];
