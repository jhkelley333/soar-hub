// Types for Work Orders V2 — mirrors the JSON shapes returned by
// netlify/functions/facilities-v2.js. Kept narrow on purpose: only the
// fields the React page reads or writes are typed. Anything else
// passes through as `unknown` so we don't drift on every backend tweak.

export type TicketStatus =
  | "Received"
  | "Pending Approval"
  | "Approved"
  | "Rejected - See Notes"
  | "Scheduled"
  | "In Progress"
  | "On Hold"
  | "Part on Order"
  | "New Equipment Ordered"
  | "Closed";

export const TICKET_STATUSES: TicketStatus[] = [
  "Received",
  "Pending Approval",
  "Approved",
  "Rejected - See Notes",
  "Scheduled",
  "In Progress",
  "On Hold",
  "Part on Order",
  "New Equipment Ordered",
  "Closed",
];

export type TicketPriority = "Emergency" | "Urgent" | "Standard" | "Planned";
export const TICKET_PRIORITIES: TicketPriority[] = [
  "Emergency",
  "Urgent",
  "Standard",
  "Planned",
];

export interface TicketPhoto {
  id: string;
  file_url: string;
  file_name: string | null;
  upload_type: string | null;
  created_at: string;
}

export interface TicketApproval {
  id: string;
  approval_tier: string;
  status: "Pending" | "Approved" | "Rejected";
  requested_at: string;
  approved_at: string | null;
  approved_by: string | null;
  notes: string | null;
  quote_url: string | null;
}

export interface TicketUpdate {
  id: string;
  user_name: string | null;
  update_type: string;
  notes: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  wo_number: string;
  store_number: string;
  store_name: string | null;
  category: string | null;
  asset_type: string | null;
  model_number: string | null;
  issue_description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  is_business_critical: boolean;
  vendor_name: string | null;
  cost_estimate: number | string | null;
  submitted_by: string | null;
  date_submitted: string;
  date_completed: string | null;
  latest_comment: string | null;
  // joined children (may be missing on some endpoints)
  ticket_photos?: TicketPhoto[];
  ticket_approvals?: TicketApproval[];
  ticket_updates?: TicketUpdate[];
}

export interface TicketsResponse {
  ok: true;
  tickets: Ticket[];
}

export interface StatsResponse {
  ok: true;
  stats: {
    open: number;
    closed: number;
    critical: number;
    aged: number;
    total: number;
    byStatus: Partial<Record<TicketStatus, number>>;
  };
}

export interface UpdateTicketBody {
  id: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  vendorName?: string;
  notes?: string;
}

export interface IssueLibraryItem {
  id: string;
  category: string;
  asset_type: string;
  display_name: string;
  sort_order: number;
}

export interface IssueLibraryResponse {
  ok: true;
  items: IssueLibraryItem[];
}

export interface CreateTicketBody {
  storeNumber: string;
  storeName?: string;
  storeEmail?: string;
  doEmail?: string;
  sdoEmail?: string;
  category?: string;
  assetType?: string;
  modelNumber?: string;
  issueDescription: string;
  priority?: TicketPriority;
  isBusinessCritical?: boolean;
  troubleshootingChecked?: boolean;
  vendorContacted?: boolean;
  vendorName?: string;
  costEstimate?: number | null;
}

export interface CreateTicketResponse {
  ok: true;
  ticket: Ticket;
  woNumber: string;
}

export interface UploadPhotoBody {
  id: string;
  photoData: string;     // base64 (no data: prefix)
  photoType: string;     // mime
  photoName: string;
  uploadType?: "submission" | "update" | "quote";
}

export interface UploadPhotoResponse {
  ok: true;
  photo: TicketPhoto;
}
