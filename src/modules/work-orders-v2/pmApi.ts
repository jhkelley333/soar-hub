// Client wrappers for /.netlify/functions/pm. Mirrors the auth +
// refresh pattern from api.ts so a stale background-tab token can
// auto-recover on 401.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/pm";

export interface PmTemplate {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  instructions: string | null;
  performer_type: "vendor" | "internal";
  default_vendor_id: string | null;
  cadence_type: "rolling" | "fixed";
  cadence_days: number | null;
  fixed_months: number[] | null;
  fixed_day_of_month: number | null;
  lead_days: number;
  est_cost: number | string | null;
  checklist_url: string | null;
  priority: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  vendors?: { id: string; name: string } | null;
}

export interface PmSchedule {
  id: string;
  template_id: string;
  store_id: string;
  override_vendor_id: string | null;
  next_due_at: string;
  last_completed_at: string | null;
  last_ticket_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  pm_templates?: PmTemplate | null;
  stores?: { id: string; number: string; name: string | null } | null;
  vendors_override?: { id: string; name: string } | null;
}

export interface UpsertTemplateBody {
  id?: string;
  name: string;
  category?: string | null;
  description?: string | null;
  instructions?: string | null;
  performer_type: "vendor" | "internal";
  default_vendor_id?: string | null;
  cadence_type: "rolling" | "fixed";
  cadence_days?: number | null;
  fixed_months?: number[] | null;
  fixed_day_of_month?: number | null;
  lead_days?: number;
  est_cost?: number | string | null;
  checklist_url?: string | null;
  priority?: string | null;
  is_active?: boolean;
}

export interface UpsertScheduleBody {
  template_id: string;
  store_ids: string[];
  override_vendor_id?: string | null;
  next_due_at?: string | null;
  is_active?: boolean;
}

export interface SpawnSummary {
  ok: true;
  spawned: Array<{
    schedule_id: string;
    store_number: string;
    store_name: string | null;
    template_name: string;
    performer_type: "vendor" | "internal";
    vendor_name: string | null;
    ticket_id?: string;
    wo_number?: string;
    would_create?: boolean;
    next_due_at?: string;
  }>;
  skipped: Array<{
    schedule_id: string;
    reason: string;
    ticket_id?: string;
  }>;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function refreshSessionAndGetToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  let res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    const fresh = await refreshSessionAndGetToken();
    if (fresh) {
      res = await fetch(path, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${fresh}` },
      });
    }
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(
      (body as { message?: string }).message || `pm ${res.status}`,
    );
  }
  return body as T;
}

export function listPmTemplates(): Promise<{ ok: true; templates: PmTemplate[] }> {
  return request(`${FN}?action=listTemplates`);
}

export function listPmSchedules(opts?: {
  template_id?: string;
  store_id?: string;
}): Promise<{ ok: true; schedules: PmSchedule[] }> {
  const qs = new URLSearchParams({ action: "listSchedules" });
  if (opts?.template_id) qs.set("template_id", opts.template_id);
  if (opts?.store_id) qs.set("store_id", opts.store_id);
  return request(`${FN}?${qs.toString()}`);
}

export function upsertPmTemplate(
  payload: UpsertTemplateBody,
): Promise<{ ok: true; template: PmTemplate }> {
  return request(`${FN}?action=upsertTemplate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deletePmTemplate(id: string): Promise<{ ok: true }> {
  return request(`${FN}?action=deleteTemplate`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function upsertPmSchedule(
  payload: UpsertScheduleBody,
): Promise<{ ok: true; schedules: PmSchedule[] }> {
  return request(`${FN}?action=upsertSchedule`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deletePmSchedule(id: string): Promise<{ ok: true }> {
  return request(`${FN}?action=deleteSchedule`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function spawnDuePmsNow(dryRun = false): Promise<SpawnSummary> {
  return request(`${FN}?action=spawnDueNow`, {
    method: "POST",
    body: JSON.stringify({ dryRun }),
  });
}
