export type HubKind = "issue" | "idea";
export type HubStatus = "open" | "planned" | "in_progress" | "resolved" | "declined";

export interface HubTicket {
  id: string;
  kind: HubKind;
  title: string;
  description: string | null;
  status: HubStatus;
  created_by: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  upvotes: number;
  created_at: string;
  updated_at: string;
  my_vote?: boolean;
  comment_count?: number;
  has_update?: boolean;
}

export interface HubComment {
  id: string;
  author_name: string | null;
  is_admin: boolean;
  body: string;
  created_at: string;
}

export const STATUS_LABEL: Record<HubStatus, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};
