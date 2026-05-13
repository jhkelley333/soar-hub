// Types for Work Orders V2 — mirrors the JSON shapes returned by
// netlify/functions/facilities-v2.js. Kept narrow on purpose: only the
// fields the React page reads or writes are typed.

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

// One store the caller has access to, as returned by `getCallerStores`.
// `number` is the user-facing store number (e.g. "1082"). `name` may be
// blank for stores that don't have a friendly name set.
export interface CallerStore {
  id: string;
  number: string;
  name: string;
}

export interface CallerStoresResponse {
  ok: true;
  // "single" → auto-fill (GM / shift-manager get their primary store).
  // "list"   → render a dropdown (DO+ pick from scoped stores).
  mode: "single" | "list";
  stores: CallerStore[];
}

export interface IssueLibraryItem {
  id: string;
  category: string;
  asset_type: string;
  display_name: string;
  sort_order: number;
  troubleshooting_tips: string | null;
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
}

export interface CreateTicketResponse {
  ok: true;
  ticket: Ticket;
  woNumber: string;
}

export interface UploadPhotoBody {
  id: string;
  photoData: string;
  photoType: string;
  photoName: string;
  uploadType?: "submission" | "update" | "quote";
}

export interface UploadPhotoResponse {
  ok: true;
  photo: TicketPhoto;
}

export const APPROVAL_TIERS = [
  { value: "DO < $500",       label: "DO — under $500" },
  { value: "SDO $501-$1000",  label: "SDO — $501 to $1,000" },
  { value: "VP $1001-$1750",  label: "VP — $1,001 to $1,750" },
] as const;
export type ApprovalTier = typeof APPROVAL_TIERS[number]["value"];

export interface SubmitApprovalBody {
  id: string;
  approvalTier: ApprovalTier;
  approvalNotes: string;
  quoteUrl?: string;
}

export interface DecideApprovalBody {
  id: string;
  approvalId: string;
  decision: "Approved" | "Rejected";
  notes?: string;
}

export type ThreadType = "internal" | "vendor";

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  message: string;
  thread_type: ThreadType;
  created_at: string;
}

export interface MessagesResponse {
  ok: true;
  messages: TicketMessage[];
  threadType: ThreadType;
}

// Shape of one row returned by getRecentMessages. Lighter than the
// per-ticket message view — embeds the ticket fields the dashboard
// widget needs so it can render a link to the ticket without a second
// round-trip.
export interface RecentMessage {
  id: string;
  ticket_id: string;
  wo_number: string;
  store_number: string;
  asset_type: string | null;
  ticket_status: string | null;
  user_name: string | null;
  user_role: string | null;
  message: string;
  thread_type: ThreadType;
  created_at: string;
}

export interface RecentMessagesResponse {
  ok: true;
  messages: RecentMessage[];
  count: number;
}

export interface SendMessageBody {
  ticketId: string;
  message: string;
  threadType?: ThreadType;
}

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  service_area: string | null;
  services: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contact_person: string | null;
  notes: string | null;
  notification_preference?: string | null;
  is_active?: boolean;
  avgRating: number | null;
  totalRatings: number;
}

export interface VendorsResponse {
  ok: true;
  vendors: Vendor[];
}

export interface SaveVendorBody {
  id?: string;
  name: string;
  category?: string;
  service_area?: string;
  services?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  is_active?: boolean;
}

export interface RateVendorBody {
  vendorId: string;
  ticketId?: string;
  storeNumber?: string;
  rating: number;
  comment?: string;
}

export interface SaveIssueItemBody {
  id?: string;
  category: string;
  asset_type: string;
  display_name: string;
  sort_order?: number;
  troubleshooting_tips?: string | null;
}

// ── Email templates ──────────────────────────────────────────

// One row per event kind in `email_templates`. Mustache-ish `{{var}}`
// placeholders get replaced at send-time. is_active=false makes the
// function fall back to the hardcoded default (so a busted template
// doesn't stop sends).
export interface EmailTemplate {
  id: string;
  kind: string;
  subject: string;
  body_html: string;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface EmailTemplatesResponse {
  ok: true;
  templates: EmailTemplate[];
}

export interface SaveEmailTemplateBody {
  kind: string;
  subject: string;
  body_html: string;
  is_active?: boolean;
}

export interface PreviewEmailTemplateBody {
  subject: string;
  body_html: string;
  // Optional override; backend uses a sample ticket when omitted.
  vars?: Record<string, string | number | boolean>;
}

export interface PreviewEmailTemplateResponse {
  ok: true;
  subject: string;
  html: string;
}

// Variables the backend exposes for substitution. Keep in sync with
// `buildTicketVars` in facilities-v2.js.
export const TEMPLATE_VARS = [
  { name: "wo_number",              label: "WO Number" },
  { name: "store_number",           label: "Store Number" },
  { name: "store_name",             label: "Store Name" },
  { name: "asset_type",             label: "Asset Type" },
  { name: "category",               label: "Category" },
  { name: "priority",               label: "Priority" },
  { name: "status",                 label: "Status" },
  { name: "issue_description",      label: "Issue Description" },
  { name: "approval_level",         label: "Approval Tier" },
  { name: "approval_request_notes", label: "Approval Notes (request)" },
  { name: "approval_status",        label: "Approval Status" },
  { name: "approval_approved_by",   label: "Approved/Rejected By" },
  { name: "submitted_by",           label: "Submitted By" },
  { name: "is_business_critical",   label: "Business Critical (Yes/No)" },
  { name: "link",                   label: "App URL" },
] as const;

// Kinds the page knows about. The DB can hold more (no schema constraint
// other than uniqueness), but the UI only renders these.
export const EMAIL_TEMPLATE_KINDS = [
  { kind: "submitted",          label: "Ticket Submitted" },
  { kind: "approval_requested", label: "Approval Requested" },
  { kind: "approval_decided",   label: "Approval Decided" },
] as const;
