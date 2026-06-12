// Typed wrappers around netlify/functions/site-audit.
import { supabase } from "@/lib/supabase";
import type { AuditsResponse, ProofKind, Severity, StorePick } from "./types";

const FN = "/.netlify/functions/site-audit";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface PhotoPayload { data: string; type: string; name: string }

// Read a File as a base64 data URL for upload through the function.
export function fileToPhoto(file: File): Promise<PhotoPayload> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ data: String(r.result), type: file.type || "image/jpeg", name: file.name });
    r.onerror = () => reject(new Error("Couldn't read the photo."));
    r.readAsDataURL(file);
  });
}

export function fetchAudits(): Promise<AuditsResponse> {
  return request<AuditsResponse>(`${FN}?action=list`);
}
export function fetchAuditStores(): Promise<{ stores: StorePick[]; can_write: boolean }> {
  return request(`${FN}?action=stores`);
}
export function createAudit(input: { store_id: string; note?: string }): Promise<{ ok: true; audit_id: string }> {
  return request(`${FN}?action=create-audit`, { method: "POST", body: JSON.stringify(input) });
}
export interface CaptureIssueInput {
  audit_id: string; title: string; area: string; severity: Severity;
  comment?: string; due?: string | null; proof_required: ProofKind[]; photo?: PhotoPayload | null;
}
export function captureIssue(input: CaptureIssueInput): Promise<{ ok: true }> {
  return request(`${FN}?action=capture-issue`, { method: "POST", body: JSON.stringify(input) });
}
export function updateIssue(input: { audit_id: string; issue_id: string; severity?: Severity; title?: string; comment?: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=update-issue`, { method: "POST", body: JSON.stringify(input) });
}
export function resolveIssue(input: { audit_id: string; issue_id: string; reopen?: boolean; completion?: { note?: string; photo?: PhotoPayload | null } }): Promise<{ ok: true }> {
  return request(`${FN}?action=resolve-issue`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteIssue(input: { audit_id: string; issue_id: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=delete-issue`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteAudit(audit_id: string): Promise<{ ok: true }> {
  return request(`${FN}?action=delete-audit`, { method: "POST", body: JSON.stringify({ audit_id }) });
}
export interface ShareReportInput {
  audit_id: string;
  signature: string; // base64 data URL of the signature canvas
  to_do: boolean;
  to_sdo: boolean;
  to_self: boolean;
  extra_emails: string[];
}
export function shareReport(input: ShareReportInput): Promise<{ ok: true; recipients: number; sent: boolean }> {
  return request(`${FN}?action=share-report`, { method: "POST", body: JSON.stringify(input) });
}
