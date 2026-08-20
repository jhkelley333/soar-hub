// Admin Reports API — thin client over netlify/functions/reports.js.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/reports";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type RecipientMode = "role" | "static";
export interface Recipient { mode: RecipientMode; value: string }

export interface ReportRun {
  id: string;
  report_key: string;
  status: "success" | "failed" | "skipped";
  started_at: string;
  completed_at: string | null;
  recipient_count: number | null;
  row_count: number | null;
  error: string | null;
  payload_summary?: Record<string, unknown> | null;
  window_start?: string | null;
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string | null;
  trigger_type: "schedule" | "event";
  cron: string | null;
  timezone: string;
  enabled: boolean;
  recipients: Recipient[];
  send_when_empty: boolean;
  last_run_at: string | null;
  last_status: string | null;
  latest_run: ReportRun | null;
}

export function fetchReports(): Promise<{ ok: true; definitions: ReportDefinition[] }> {
  return req(`${FN}?action=list`);
}
export function fetchReportRuns(key: string): Promise<{ ok: true; runs: ReportRun[] }> {
  return req(`${FN}?action=runs&key=${encodeURIComponent(key)}`);
}
export function updateReport(key: string, patch: Partial<Pick<ReportDefinition, "name" | "description" | "enabled" | "cron" | "timezone" | "recipients" | "send_when_empty">>): Promise<{ ok: true; definition: ReportDefinition }> {
  return req(`${FN}?action=update`, { method: "POST", body: JSON.stringify({ key, ...patch }) });
}
export function sendReportTest(key: string): Promise<{ ok: true; run: ReportRun; sent_to: string }> {
  return req(`${FN}?action=send-test`, { method: "POST", body: JSON.stringify({ key }) });
}
export function runReportNow(key: string): Promise<{ ok: true; run: ReportRun }> {
  return req(`${FN}?action=run-now`, { method: "POST", body: JSON.stringify({ key }) });
}
