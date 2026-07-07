// Typed wrappers around netlify/functions/nla.
import { supabase } from "@/lib/supabase";
import type { NlaAcks, NlaComparison, NlaGetResponse, NlaListRow, NlaPlan, NlaTemplate, NlaTemplateItem, Rating } from "./types";

const FN = "/.netlify/functions/nla";

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

export function fetchNlaList(): Promise<{ assessments: NlaListRow[] }> {
  return request(`${FN}?action=list`);
}
export function fetchNlaTemplates(): Promise<{ templates: NlaTemplate[] }> {
  return request(`${FN}?action=templates`);
}
export function fetchNlaTemplate(targetRole: string): Promise<{ template: NlaTemplate; items: NlaTemplateItem[] }> {
  return request(`${FN}?action=template&target_role=${encodeURIComponent(targetRole)}`);
}
export function fetchNlaAssessment(id: string): Promise<NlaGetResponse> {
  return request(`${FN}?action=get&assessment_id=${encodeURIComponent(id)}`);
}
export interface OpenNlaInput {
  subject_profile_id: string;
  subject_member_id?: string | null;
  target_role: string;
  store_id?: string | null;
}
export function openNla(input: OpenNlaInput): Promise<{ ok: true; assessment_id: string; existed: boolean }> {
  return request(`${FN}?action=open`, { method: "POST", body: JSON.stringify(input) });
}
export function saveNlaRating(input: { assessment_id: string; competency_key: string; rating: Rating; note?: string | null }): Promise<{ ok: true }> {
  return request(`${FN}?action=save-rating`, { method: "POST", body: JSON.stringify(input) });
}
export function submitNla(assessmentId: string): Promise<{ ok: true; both_submitted: boolean }> {
  return request(`${FN}?action=submit`, { method: "POST", body: JSON.stringify({ assessment_id: assessmentId }) });
}

// ── Compare + align ──────────────────────────────────────────────────────────
export function fetchNlaComparison(id: string): Promise<NlaComparison> {
  return request(`${FN}?action=comparison&assessment_id=${encodeURIComponent(id)}`);
}
export function setNlaFocus(input: { assessment_id: string; competency_key: string; note?: string | null; suggested_resource?: string | null }): Promise<{ ok: true }> {
  return request(`${FN}?action=set-focus`, { method: "POST", body: JSON.stringify(input) });
}
export function removeNlaFocus(input: { assessment_id: string; competency_key: string }): Promise<{ ok: true }> {
  return request(`${FN}?action=remove-focus`, { method: "POST", body: JSON.stringify(input) });
}

// ── Acknowledge + plan ───────────────────────────────────────────────────────
export function fetchNlaAcks(id: string): Promise<NlaAcks> {
  return request(`${FN}?action=acks&assessment_id=${encodeURIComponent(id)}`);
}
export function acknowledgeNla(id: string): Promise<{ ok: true; both_acked: boolean; plan?: { goals: number; milestones: number; band: string } | null }> {
  return request(`${FN}?action=acknowledge`, { method: "POST", body: JSON.stringify({ assessment_id: id }) });
}
export function fetchNlaPlan(id: string): Promise<NlaPlan> {
  return request(`${FN}?action=plan&assessment_id=${encodeURIComponent(id)}`);
}
