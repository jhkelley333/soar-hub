// Client-side API wrappers for the facilities-v2 netlify function.
// Same Bearer-JWT pattern used by the rest of the app: pull the
// Supabase access token, inject it on every fetch.

import { supabase } from "@/lib/supabase";
import type {
  CallerStoresResponse,
  CreateTicketBody,
  CreateTicketResponse,
  DecideApprovalBody,
  EmailTemplatesResponse,
  EmailTemplate,
  IssueLibraryResponse,
  MessagesResponse,
  PreviewEmailTemplateBody,
  PreviewEmailTemplateResponse,
  RateVendorBody,
  RecentMessagesResponse,
  SaveEmailTemplateBody,
  SaveIssueItemBody,
  SaveVendorBody,
  SendMessageBody,
  SetPauseStateBody,
  StatsResponse,
  SubmitApprovalBody,
  ThreadType,
  Ticket,
  TicketActivitiesResponse,
  TicketsResponse,
  TransitionTicketBody,
  UpdateTicketBody,
  UploadPhotoBody,
  UploadPhotoResponse,
  Vendor,
  VendorsResponse,
} from "./types";

const FN = "/.netlify/functions/facilities-v2";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

// supabase-js usually auto-refreshes the access token ~60s before
// expiry, but a backgrounded tab or a sleeping device can miss the
// refresh window — getSession() then returns a stale token and
// every facilities-v2 call comes back as "Not authenticated."
// We bounce off a single 401 by forcing a refresh and retrying.
async function refreshSessionAndGetToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    console.warn("[wo2/api] refreshSession failed", error);
    return null;
  }
  return data.session?.access_token ?? null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  let res = await fetch(path, { ...init, headers });
  // Retry once after a forced session refresh — handles the
  // background-tab stale-token case described above.
  if (res.status === 401) {
    const fresh = await refreshSessionAndGetToken();
    if (fresh) {
      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${fresh}`,
      };
      res = await fetch(path, { ...init, headers: retryHeaders });
    }
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(
      (body as { message?: string }).message ||
        `facilities-v2 ${res.status}`,
    );
  }
  return body as T;
}

export function fetchTickets(): Promise<TicketsResponse> {
  return request<TicketsResponse>(`${FN}?action=getTickets`);
}

export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>(`${FN}?action=getStats`);
}

export interface OpenAlertItem {
  id: string;
  wo_number: string | null;
  store_number: string | null;
  summary: string;
  priority: string | null;
  status: string;
  timestamp: string;
  cost_estimate?: number | null;
  approval_tier?: string | null;
  is_business_critical?: boolean | null;
}

export interface OpenAlertGroup {
  key: "new24h" | "awaitingApproval" | "emergencies" | "stuck";
  label: string;
  tone: "info" | "warning" | "danger" | "neutral";
  count: number;
  items: OpenAlertItem[];
}

export interface OpenAlertsResponse {
  ok: true;
  groups: OpenAlertGroup[];
  total_unique_tickets: number;
}

export function fetchOpenWorkOrderAlerts(): Promise<OpenAlertsResponse> {
  return request<OpenAlertsResponse>(`${FN}?action=getOpenWorkOrderAlerts`);
}

export function updateTicket(payload: UpdateTicketBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=updateTicket`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchIssueLibrary(): Promise<IssueLibraryResponse> {
  return request<IssueLibraryResponse>(`${FN}?action=getIssueLibrary`);
}

export function fetchCallerStores(): Promise<CallerStoresResponse> {
  return request<CallerStoresResponse>(`${FN}?action=getCallerStores`);
}

export function createTicket(payload: CreateTicketBody): Promise<CreateTicketResponse> {
  return request<CreateTicketResponse>(`${FN}?action=createTicket`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadPhoto(payload: UploadPhotoBody): Promise<UploadPhotoResponse> {
  return request<UploadPhotoResponse>(`${FN}?action=uploadPhoto`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitApproval(payload: SubmitApprovalBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=submitApproval`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function decideApproval(payload: DecideApprovalBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=decideApproval`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMessages(ticketId: string, threadType: ThreadType): Promise<MessagesResponse> {
  return request<MessagesResponse>(
    `${FN}?action=getMessages&ticketId=${encodeURIComponent(ticketId)}&threadType=${threadType}`,
  );
}

export function sendMessage(payload: SendMessageBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=sendMessage`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchRecentMessages(
  hours = 48,
): Promise<RecentMessagesResponse> {
  return request<RecentMessagesResponse>(
    `${FN}?action=getRecentMessages&hours=${hours}`,
  );
}

export function fetchVendors(opts?: { storeNumber?: string }): Promise<VendorsResponse> {
  const qs = opts?.storeNumber
    ? `&storeNumber=${encodeURIComponent(opts.storeNumber)}`
    : "";
  return request<VendorsResponse>(`${FN}?action=getVendors${qs}`);
}

export interface VendorScopeRow {
  id: string;
  scope_type: "national" | "region" | "area" | "district" | "store";
  scope_id: string | null;
  created_at?: string;
}

export function fetchVendorScopes(vendorId: string): Promise<{ ok: true; scopes: VendorScopeRow[] }> {
  return request<{ ok: true; scopes: VendorScopeRow[] }>(
    `${FN}?action=getVendorScopes&vendorId=${encodeURIComponent(vendorId)}`,
  );
}

export function setVendorScopes(
  vendorId: string,
  scopes: Array<{ scope_type: VendorScopeRow["scope_type"]; scope_id: string | null }>,
): Promise<{ ok: true; count: number }> {
  return request<{ ok: true; count: number }>(`${FN}?action=setVendorScopes`, {
    method: "POST",
    body: JSON.stringify({ vendorId, scopes }),
  });
}

export interface BulkVendorRow {
  name: string;
  category?: string;
  services?: string;
  service_area?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  notes?: string;
  website?: string;
  is_active?: boolean;
  scope?: string;
}

export interface BulkVendorResult {
  row: number;
  name: string;
  status: "created" | "updated" | "failed";
  message?: string;
  scopes?: number;
}

export interface BulkVendorResponse {
  ok: true;
  results: BulkVendorResult[];
  summary: Partial<Record<"created" | "updated" | "failed", number>>;
}

export function bulkImportVendors(
  rows: BulkVendorRow[],
  replaceScopes = true,
): Promise<BulkVendorResponse> {
  return request<BulkVendorResponse>(`${FN}?action=bulkImportVendors`, {
    method: "POST",
    body: JSON.stringify({ rows, replace_scopes: replaceScopes }),
  });
}

export function searchVendors(
  q: string,
  assetType?: string,
  storeNumber?: string,
  category?: string,
): Promise<{ ok: true; vendors: Vendor[] }> {
  const params = new URLSearchParams({ action: "searchVendors", q });
  if (assetType) params.set("assetType", assetType);
  if (storeNumber) params.set("storeNumber", storeNumber);
  if (category) params.set("category", category);
  return request<{ ok: true; vendors: Vendor[] }>(`${FN}?${params.toString()}`);
}

export function saveVendor(payload: SaveVendorBody): Promise<{ ok: true; vendor: Vendor }> {
  return request<{ ok: true; vendor: Vendor }>(`${FN}?action=saveVendor`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rateVendor(payload: RateVendorBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=rateVendor`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveIssueItem(payload: SaveIssueItemBody): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=saveIssueItem`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteIssueItem(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=deleteIssueItem`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function fetchEmailTemplates(): Promise<EmailTemplatesResponse> {
  return request<EmailTemplatesResponse>(`${FN}?action=getEmailTemplates`);
}

export function saveEmailTemplate(payload: SaveEmailTemplateBody): Promise<{ ok: true; template: EmailTemplate }> {
  return request<{ ok: true; template: EmailTemplate }>(`${FN}?action=saveEmailTemplate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function previewEmailTemplate(payload: PreviewEmailTemplateBody): Promise<PreviewEmailTemplateResponse> {
  return request<PreviewEmailTemplateResponse>(`${FN}?action=previewEmailTemplate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Reads a File into a base64 string (no data: prefix). Used by the
// new-ticket modal + the "Add Photos" button on each ticket card.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

// ── v2 Phase-1 endpoints ─────────────────────────────────────────

export function transitionTicket(
  payload: TransitionTicketBody,
): Promise<{ ok: true; ticket: Ticket }> {
  return request<{ ok: true; ticket: Ticket }>(`${FN}?action=transitionTicket`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function setPauseState(
  payload: SetPauseStateBody,
): Promise<{ ok: true; ticket: Ticket }> {
  return request<{ ok: true; ticket: Ticket }>(`${FN}?action=setPauseState`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchTicketActivities(
  id: string,
): Promise<TicketActivitiesResponse> {
  return request<TicketActivitiesResponse>(
    `${FN}?action=getTicketActivities&id=${encodeURIComponent(id)}`,
  );
}
