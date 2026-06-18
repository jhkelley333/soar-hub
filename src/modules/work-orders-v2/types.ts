// Types for Work Orders V2 — mirrors the JSON shapes returned by
// netlify/functions/facilities-v2.js. Kept narrow on purpose: only the
// fields the React page reads or writes are typed.

// v2 status enum (Phase 1). The API returns this on `Ticket.status` and
// also carries the legacy text on `Ticket.status_legacy` for one release
// cycle (PR 1 → PR 3 cleanup). UI should use `statusLabel()` for human
// display so it doesn't have to know the underlying enum spelling.
export type TicketStatus =
  | "submitted"
  | "in_progress"
  | "scheduled"
  | "on_site"
  | "awaiting_equipment"
  | "parts_on_order"
  | "completed"
  | "closed"
  | "cancelled";

export const TICKET_STATUSES: TicketStatus[] = [
  "submitted",
  "in_progress",
  "scheduled",
  "on_site",
  "awaiting_equipment",
  "parts_on_order",
  "completed",
  "closed",
  "cancelled",
];

// Orthogonal pause state. Only meaningful when status is in_progress
// or scheduled — the server auto-resets to 'none' on any other status.
export type PauseState =
  | "none"
  | "on_hold"
  | "awaiting_parts"
  | "awaiting_replacement";

// Reason / resolution enums — surfaced by the new endpoints + the
// "Why are you closing?" / "Why reopen?" pickers shipping in PR 2.
export type StoreCloseReason =
  | "user_error"
  | "resolved_internally"
  | "duplicate"
  | "no_longer_needed";

export type AdminCloseReason =
  | "completed_and_verified"
  | "auto_closed_no_verification"
  | "cancelled_by_ops"
  | "cancelled_by_submitter"
  | "equipment_replaced"
  | "written_off"
  | "deferred_to_capex";

export type ReopenReason =
  | "not_fixed"
  | "recurred"
  | "wrong_diagnosis"
  | "other";

export type ResolutionCategory =
  | "repaired"
  | "replaced"
  | "no_issue_found"
  | "deferred"
  | "migrated_unknown";

// Human-readable label for a v2 status. Used for display only —
// comparisons and routing should always use the raw enum.
export function statusLabel(s: TicketStatus | string | null | undefined): string {
  switch (s) {
    case "submitted":   return "Submitted";
    case "in_progress": return "In Progress";
    case "scheduled":   return "Scheduled";
    case "on_site":     return "On Site";
    case "awaiting_equipment": return "Awaiting Equipment";
    case "parts_on_order": return "Parts on Order";
    case "completed":   return "Completed";
    case "closed":      return "Closed";
    case "cancelled":   return "Cancelled";
    default:            return s ? String(s) : "—";
  }
}

// Treats `completed`, `closed`, `cancelled` as not-open. The existing
// "Open only" filter uses this. `completed` is intentionally NOT open
// — it's a working state awaiting store confirmation, but reporting
// and the open-count badge should treat it as closed-pending-signoff.
export function isOpenStatus(s: TicketStatus | string | null | undefined): boolean {
  if (!s) return true;
  return s !== "completed" && s !== "closed" && s !== "cancelled";
}

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
  approved_via_whatsapp?: boolean;
}

// Activity feed entry — one row per state-changing action on a ticket
// (status change, vendor assignment, ETA set, photo upload, comment,
// approval, etc.). event_data is unstructured JSON; the shape varies
// by event_type.
export interface TicketActivity {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  notes: string | null;
  visibility: "store" | "admin" | "vendor" | "all";
  created_at: string;
}

// One row of a work order's cost breakdown. amount_cents is the LINE
// total (qty already factored in). Stored as a jsonb array on the
// ticket (migration 0075); the ticket's cost_estimate is kept in sync
// by the backend as the sum.
export interface LineItem {
  label: string;
  qty: number;
  amount_cents: number;
}

// A vendor quote attached to a work order (migration 0076). A WO can
// carry several for comparison; the recommended one drives cost_estimate.
export interface WorkOrderQuote {
  id: string;
  ticket_id: string;
  vendor_name: string;
  amount_cents: number;
  file_url: string | null;
  file_name: string | null;
  note: string | null;
  is_recommended: boolean;
  source: "internal" | "vendor";
  submitted_by_name: string | null;
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
  pause_state?: PauseState | null;
  pause_reason_note?: string | null;
  resolution_category?: ResolutionCategory | null;
  store_close_reason?: StoreCloseReason | null;
  admin_close_reason?: AdminCloseReason | null;
  closed_by_store?: boolean;
  callback_of?: string | null;
  related_to?: string | null;
  completed_at?: string | null;
  closed_at?: string | null;
  priority: TicketPriority;
  is_business_critical: boolean;
  vendor_id: string | null;
  vendor_name: string | null;
  // Raised when a store submits without choosing a vendor ("Need help
  // finding a vendor") — flags the ticket for the DO to assign one.
  // Cleared automatically once a vendor name is set.
  needs_vendor_help: boolean | null;
  vendor_help_at: string | null;
  // Replacement-equipment fields. Populated when the team decides to
  // replace rather than repair (the Order Replacement action sets
  // them; status transitions to "awaiting_equipment").
  replacement_manufacturer: string | null;
  replacement_model: string | null;
  replacement_supplier: string | null;
  replacement_cost: number | string | null;
  replacement_eta: string | null;
  replacement_ordered_at: string | null;
  // V3-asset-capture columns. All optional at order time, filled in
  // as data becomes available. When V3 ships an `assets` table these
  // fields migrate forward via INSERT ... SELECT FROM tickets.
  replacement_asset_tag: string | null;
  replacement_po_number: string | null;
  replacement_warranty_labor_days: number | null;
  replacement_warranty_parts_days: number | null;
  replacement_warranty_parts_source: "vendor" | "manufacturer" | "none" | null;
  // Parts-on-order fields. Populated when the team orders a repair part
  // (the Order Parts action sets them; status transitions to
  // "parts_on_order"). Parallel to the replacement_* fields above.
  parts_description: string | null;
  parts_supplier: string | null;
  parts_cost: number | string | null;
  parts_eta: string | null;
  parts_po_number: string | null;
  parts_ordered_at: string | null;
  cost_estimate: number | string | null;
  submitted_by: string | null;
  submitted_by_user_id: string | null;
  // Server-decorated count of messages on this ticket that the
  // current caller has not yet seen (other users' messages newer
  // than the caller's ticket_views.last_seen_at). 0 when there's
  // nothing new or when the call failed to decorate.
  unread_message_count?: number;
  date_submitted: string;
  date_completed: string | null;
  latest_comment: string | null;
  line_items?: LineItem[];
  // Vendor's proposed scope of work (the "Request"), distinct from
  // issue_description (the store's narrative, shown as "Justification").
  work_requested?: string | null;
  // Rationale captured when an approval is requested (the vendor's
  // justification on a quote submission). Shown as "Justification".
  approval_request_notes?: string | null;
  // Needs-info: set while an approver's "Request more info" is awaiting a
  // reply. Pauses the approval clock; cleared on reply or a decision.
  awaiting_info?: boolean;
  awaiting_info_at?: string | null;
  info_request_note?: string | null;
  ticket_photos?: TicketPhoto[];
  ticket_approvals?: TicketApproval[];
  ticket_activities?: TicketActivity[];
  ticket_quotes?: WorkOrderQuote[];
}

export interface TicketActivitiesResponse {
  ok: true;
  activities: TicketActivity[];
}

// New endpoint shapes (PR 1).

export type TransitionPayload = Partial<{
  vendor_id: string;
  vendor_name: string;
  store_close_reason: StoreCloseReason;
  admin_close_reason: AdminCloseReason;
  admin_close_notes: string;
  resolution_category: ResolutionCategory;
  reopen_reason: ReopenReason;
  reopen_reason_text: string;
  // Replacement-equipment payload — required when transitioning to
  // awaiting_equipment via the Order Replacement action.
  replacement_manufacturer: string;
  replacement_model: string;
  replacement_supplier: string;
  replacement_cost: number;
  replacement_eta: string;
  replacement_asset_tag: string;
  replacement_po_number: string;
  replacement_warranty_labor_days: number;
  replacement_warranty_parts_days: number;
  replacement_warranty_parts_source: "vendor" | "manufacturer" | "none";
  // Parts-on-order payload — required when transitioning to
  // parts_on_order via the Order Parts action.
  parts_description: string;
  parts_supplier: string;
  parts_cost: number;
  parts_eta: string;
  parts_po_number: string;
}>;

export interface TransitionTicketBody {
  id: string;
  to: TicketStatus;
  payload?: TransitionPayload;
}

export interface SetPauseStateBody {
  id: string;
  pause_state: PauseState;
  reason_note?: string;
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
  // Corrected asset / issue type (DO+ only in the UI).
  assetType?: string;
  vendorName?: string;
  vendorId?: string | null;
  notes?: string;
  // Replaces the cost breakdown; backend recomputes cost_estimate.
  lineItems?: LineItem[];
  // Vendor's proposed scope of work.
  workRequested?: string;
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
  workRequested?: string;
  priority?: TicketPriority;
  isBusinessCritical?: boolean;
  troubleshootingChecked?: boolean;
  vendorContacted?: boolean;
  vendorName?: string;
  // Set when the store submits without a vendor ("Need help finding a
  // vendor"); flags the ticket for the DO. Mutually exclusive with a
  // non-empty vendorName.
  needsVendorHelp?: boolean;
  // Optional cost breakdown. When present the backend sets cost_estimate
  // to the sum, so callers don't send costEstimate separately.
  lineItems?: LineItem[];
  // The first (required) photo, base64, bound to creation server-side so a
  // ticket can never be created without a photo. Additional photos upload
  // after via uploadPhoto.
  photos?: { data: string; name: string; type: string }[];
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
  uploadType?: "submission" | "update" | "quote" | "replacement_receipt" | "replacement_warranty" | "parts_receipt";
}

export interface UploadPhotoResponse {
  ok: true;
  photo: TicketPhoto;
}

// One rung of the editable approval authority ladder (migration 0077).
// nte_cents = the not-to-exceed amount this role can approve solo. A
// quote routes to the lowest is_active role whose NTE covers it.
export interface ApprovalThreshold {
  role: string;
  label: string;
  nte_cents: number;
  is_active: boolean;
  sort_order: number;
  updated_at?: string;
}

export const APPROVAL_TIERS = [
  { value: "DO < $500",       label: "DO — under $500" },
  { value: "SDO $501-$1000",  label: "SDO — $501 to $1,000" },
  { value: "RVP $1001-$1750", label: "RVP — $1,001 to $1,750" },
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
  // When approving, commits this quote: it becomes recommended and its
  // total becomes the ticket's cost.
  quoteId?: string;
  // True when recording an out-of-system (verbal / Owner) approval for an
  // amount above the top active tier.
  verbal?: boolean;
}

export interface AddQuoteBody {
  ticketId: string;
  vendorName: string;
  amountCents: number;
  note?: string;
  // The Request — scope of work (e.g. "Replaced motor and belt"). Sets
  // tickets.work_requested, keeping internal entry aligned with the
  // vendor portal. Optional so existing callers don't break.
  workRequested?: string;
  isRecommended?: boolean;
  // Optional quote file (base64, sans data: prefix) — see fileToBase64.
  fileData?: string;
  fileName?: string;
  fileType?: string;
}

export type ThreadType = "internal" | "vendor" | "requester" | "store";

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

// One entry in the comms notification bell — a work order with unread
// messages for the caller, carrying a preview of the newest unread.
export interface WoNotification {
  ticket_id: string;
  wo_number: string | null;
  store_number: string | null;
  store_name: string | null;
  unread_count: number;
  thread_type: ThreadType;
  from_name: string;
  is_reply: boolean;
  preview: string;
  at: string;
}

export interface NotificationsResponse {
  ok: true;
  notifications: WoNotification[];
  total: number;
}

export interface SendMessageBody {
  ticketId: string;
  message: string;
  threadType?: ThreadType;
  /** On the "store" thread: also CC the store's DO on the outbound email. */
  ccDo?: boolean;
  /** On the "store" thread: also CC the store's SDO on the outbound email. */
  ccSdo?: boolean;
  /** On store/requester threads: CC the sender's own inbox a copy. */
  copyMe?: boolean;
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
  // True if this "vendor" is actually an in-house tech / internal
  // facilities resource. Renders with an "Internal" chip badge in
  // pickers and the vendor list so users can tell at a glance.
  is_internal?: boolean;
  avgRating: number | null;
  totalRatings: number;
  // Scope rows returned by getVendors when the join is included.
  // Empty array == legacy "visible everywhere" fallback. Render
  // these as chips on the vendor row so users can see at a glance
  // which markets a vendor covers.
  vendor_scopes?: Array<{
    id?: string;
    scope_type: "national" | "region" | "area" | "district" | "store";
    scope_id: string | null;
  }>;
  // Default warranty offered by this vendor. Days under the hood;
  // UI converts to a "≈ X months" hint alongside the raw number.
  // parts_warranty_source distinguishes vendor-backed coverage
  // from manufacturer pass-through (which may already be expired
  // by the time something breaks).
  labor_warranty_days?: number | null;
  parts_warranty_days?: number | null;
  parts_warranty_source?: "vendor" | "manufacturer" | "none" | null;
  warranty_notes?: string | null;
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
  is_internal?: boolean;
  labor_warranty_days?: number | null;
  parts_warranty_days?: number | null;
  parts_warranty_source?: "vendor" | "manufacturer" | "none" | null;
  warranty_notes?: string | null;
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
