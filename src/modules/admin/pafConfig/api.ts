// Typed wrappers around netlify/functions/paf-config. Mirrors auth pattern
// used elsewhere in the hub.

import { supabase } from "@/lib/supabase";
import type {
  FormConfigHistoryEntry,
  FormConfigRow,
  PafFormConfig,
} from "./types";

const FN = "/.netlify/functions/paf-config";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchPafConfig(): Promise<FormConfigRow> {
  return request<FormConfigRow>(`${FN}?action=get&config_key=paf_form`);
}

export interface SaveResult {
  ok: true;
  id: string;
  config_version: number;
  updated_at: string;
}

export function savePafConfig(
  config: PafFormConfig,
  changeSummary: string
): Promise<SaveResult> {
  return request<SaveResult>(`${FN}?action=save`, {
    method: "POST",
    body: JSON.stringify({
      config_key: "paf_form",
      config_json: config,
      change_summary: changeSummary,
    }),
  });
}

export function fetchPafConfigHistory(
  limit = 10
): Promise<{ entries: FormConfigHistoryEntry[] }> {
  return request<{ entries: FormConfigHistoryEntry[] }>(
    `${FN}?action=history&config_key=paf_form&limit=${limit}`
  );
}

export function restorePafConfig(
  restoreVersion: number
): Promise<SaveResult> {
  return request<SaveResult>(`${FN}?action=restore`, {
    method: "POST",
    body: JSON.stringify({
      config_key: "paf_form",
      restore_version: restoreVersion,
    }),
  });
}

export interface SendTestResult {
  ok: true;
  sent_to: string;
  rendered: { subject: string; body: string };
  note?: string;
}

export function sendTestEmail(
  templateKey: string,
  template: { subject: string; body: string }
): Promise<SendTestResult> {
  return request<SendTestResult>(`${FN}?action=send-test-email`, {
    method: "POST",
    body: JSON.stringify({ template_key: templateKey, template }),
  });
}
