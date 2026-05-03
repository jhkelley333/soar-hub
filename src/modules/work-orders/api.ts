// src/modules/work-orders/api.ts
//
// Typed wrappers around netlify/functions/work-orders. Every call grabs the
// current Supabase access token and forwards it as a Bearer header. The
// function on the other end validates that JWT, looks up role + scopes, and
// returns scoped data.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/work-orders";

export type Role =
  | "shift_manager"
  | "gm"
  | "do"
  | "sdo"
  | "rvp"
  | "admin"
  | "payroll";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  storeNumbers: string[];
  canSeeAllStores: boolean;
}

// Smartsheet rows are flattened to { columnTitle: value } shape on the server.
// Underscore-prefixed fields are normalized aliases that survive column-name
// drift (Approval / Approval Level / etc.).
export interface WorkOrder {
  id: number;
  createdAt?: string;
  modifiedAt?: string;
  _submittedDate?: string;
  _submittedBy?: string;
  _approvalLevel?: string;
  _approvalNotes?: string;
  _issueDescription?: string;
  [columnTitle: string]: unknown;
}

export interface WorkOrderMeta {
  statusOrder: string[];
  allowedStatusChanges: string[];
  isApprover: boolean;
}

export interface WorkOrdersIndex {
  user: SessionUser;
  workOrders: WorkOrder[];
  meta: WorkOrderMeta;
}

export interface Vendor {
  [columnTitle: string]: string;
}

export interface VideoFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  createdTime?: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function listWorkOrders() {
  return request<WorkOrdersIndex>(FN);
}

export function getWorkOrder(id: number | string) {
  return request<WorkOrder>(`${FN}?id=${encodeURIComponent(String(id))}`);
}

export function createWorkOrder(input: Record<string, unknown>) {
  return request<WorkOrder>(FN, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorkOrder(
  id: number | string,
  input: Record<string, unknown>
) {
  return request<WorkOrder>(`${FN}?id=${encodeURIComponent(String(id))}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listVendors() {
  return request<Vendor[]>(`${FN}?action=vendors`);
}

export function listVideos() {
  return request<VideoFile[]>(`${FN}?action=videos`);
}

export interface UploadResult {
  url: string;
  path: string;
}

export async function uploadAttachment(
  rowId: number | string,
  file: File
): Promise<UploadResult> {
  const dataBase64 = await fileToBase64(file);
  return request<UploadResult>(`${FN}?action=upload`, {
    method: "POST",
    body: JSON.stringify({
      rowId,
      fileName: file.name,
      contentType: file.type,
      dataBase64,
    }),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}
