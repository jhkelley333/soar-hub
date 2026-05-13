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
  SaveEmailTemplateBody,
  SaveIssueItemBody,
  SaveVendorBody,
  SendMessageBody,
  StatsResponse,
  SubmitApprovalBody,
  ThreadType,
  TicketsResponse,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
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

export function fetchVendors(): Promise<VendorsResponse> {
  return request<VendorsResponse>(`${FN}?action=getVendors`);
}

export function searchVendors(
  q: string,
  assetType?: string,
): Promise<{ ok: true; vendors: Vendor[] }> {
  const params = new URLSearchParams({ action: "searchVendors", q });
  if (assetType) params.set("assetType", assetType);
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
