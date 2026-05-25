// Chat — shared types for the SOAR Field App inbox. Frontend shapes
// mirror the brief's data model; "needsYou" is treated as a derived
// flag (server-computed in production; sample data sets it directly).

export type ThreadKind =
  | "direct"
  | "group"
  | "submission"
  | "workorder"
  | "broadcast";

export type ChatTab = "all" | "direct" | "groups" | "news";

// Status pill tones map to the app's semantic colors.
export type StatusPillKind = "info" | "review" | "warn" | "ok" | "neutral";

export interface ThreadStatus {
  kind: StatusPillKind;
  label: string;
}

export type Presence = "online" | "away" | "offline";

export interface ChatUser {
  id: string;
  name: string;
  initials: string;
  presence?: Presence;
}

export interface ChatThread {
  id: string;
  kind: ThreadKind;
  title: string;
  subtitle: string;
  scope?: { kind: "submission" | "workorder" | "store"; refId: string };
  participantUserIds: string[];
  external: boolean;
  pinned: boolean;
  mutedUntil?: string;
  needsYou: boolean;
  status?: ThreadStatus;
  lastMessage: { fromUserId: string; text: string; at: string };
  unreadCount: number;
  mentionedCount: number;
  updatedAt: string;
  /** Broadcast attribution line, e.g. "From RVP Janelle Aoki". */
  fromLabel?: string;
  /** Group member count for the subtitle / avatar stack. */
  memberCount?: number;
  /** Up to two member initials for the group avatar stack. */
  memberInitials?: string[];
}

export interface ChatAttachment {
  id: string;
  /** Storage path within the chat-attachments bucket. */
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  /** "system" for state-change events. */
  fromUserId: string;
  text: string;
  /** Pre-formatted display time, e.g. "Tue 4:18p". */
  at: string;
  system?: boolean;
  attachments?: ChatAttachment[];
}
