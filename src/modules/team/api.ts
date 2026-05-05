// src/modules/team/api.ts
//
// Typed wrappers around netlify/functions/team-mgmt. Mirrors the auth pattern
// used by the work-orders module (see src/modules/work-orders/api.ts).

import { supabase } from "@/lib/supabase";
import type { UserRole, ScopeType } from "@/types/database";

const FN = "/.netlify/functions/team-mgmt";

export interface SessionManager {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

export interface ScopeBadge {
  scope_type: ScopeType;
  scope_id: string | null;
  label: string;
  // Stable code that round-trips through CSV import/export. Empty for
  // global scope. Older list responses didn't include this; treat as
  // optional.
  code?: string;
}

export interface ManagedUser {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  // ISO timestamp from auth.users.email_confirmed_at — null means the
  // user hasn't accepted the invite / set a password yet.
  email_confirmed_at: string | null;
  scopes: ScopeBadge[];
}

export interface TeamListResponse {
  user: SessionManager;
  members: ManagedUser[];
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

export function listTeam(): Promise<TeamListResponse> {
  return request<TeamListResponse>(`${FN}?action=list`);
}

// ----------------------------------------------------------------------------
// Add user
// ----------------------------------------------------------------------------

export interface ScopeStore {
  id: string;
  number: string;
  name: string;
  district_id: string;
  is_active: boolean;
}
export interface ScopeDistrict {
  id: string;
  name: string;
  code: string;
  area_id: string;
}
export interface ScopeArea {
  id: string;
  name: string;
  code: string;
  region_id: string;
}
export interface ScopeRegion {
  id: string;
  name: string;
  code: string;
}

export interface ScopeOptionsResponse {
  stores: ScopeStore[];
  districts: ScopeDistrict[];
  areas: ScopeArea[];
  regions: ScopeRegion[];
  canSetGlobal: boolean;
}

export function fetchScopeOptions(): Promise<ScopeOptionsResponse> {
  return request<ScopeOptionsResponse>(`${FN}?action=scope-options`);
}

export function fetchManageableRoles(): Promise<{ roles: UserRole[] }> {
  return request<{ roles: UserRole[] }>(`${FN}?action=manageable-roles`);
}

export interface AddUserInput {
  full_name?: string;
  email: string;
  phone?: string;
  role: UserRole;
  scope_type: "store" | "district" | "area" | "region" | "global";
  scope_id: string | null; // null for global
}

export function addUser(input: AddUserInput): Promise<{ ok: true; user_id: string; email: string }> {
  return request<{ ok: true; user_id: string; email: string }>(
    `${FN}?action=add-user`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

// ----------------------------------------------------------------------------
// Update user — partial. Fields not present are left alone.
// ----------------------------------------------------------------------------

export interface UpdateUserInput {
  user_id: string;
  full_name?: string | null;
  phone?: string | null;
  role?: UserRole;
  scope_type?: "store" | "district" | "area" | "region" | "global";
  scope_id?: string | null;
  is_active?: boolean;
}

export function updateUser(input: UpdateUserInput): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=update-user`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ----------------------------------------------------------------------------
// History (audit log)
// ----------------------------------------------------------------------------

export type AuditAction = "create" | "update" | "deactivate" | "reactivate";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  created_at: string;
  actor: {
    id: string;
    full_name: string | null;
    email: string | null;
  };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface HistoryResponse {
  entries: AuditEntry[];
}

export function fetchHistory(userId: string, limit = 20): Promise<HistoryResponse> {
  const params = new URLSearchParams({ user_id: userId, limit: String(limit) });
  return request<HistoryResponse>(`${FN}?action=history&${params.toString()}`);
}

// ----------------------------------------------------------------------------
// Send password reset (manager-initiated)
// ----------------------------------------------------------------------------

export function sendPasswordReset(userId: string): Promise<{ ok: true; sent_to: string }> {
  return request<{ ok: true; sent_to: string }>(`${FN}?action=send-reset`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

// ----------------------------------------------------------------------------
// Bulk import (admin only)
// ----------------------------------------------------------------------------

export interface BulkRowInput {
  email: string;
  full_name?: string;
  phone?: string;
  role: string;
  scope_type: string;
  scope_id_or_code?: string;
}

export interface BulkRowAnnotated {
  row: number;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  scope_type: string;
  scope_id: string | null;
  scope_code: string;
  errors: string[];
  warnings: string[];
  already_exists: boolean;
}

export interface BulkPreviewResponse {
  rows: BulkRowAnnotated[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    skipped: number;
  };
}

export interface BulkImportResult extends BulkRowAnnotated {
  status: "invited" | "skipped" | "error";
  message?: string;
  user_id?: string;
}

export interface BulkImportResponse {
  results: BulkImportResult[];
  summary: {
    total: number;
    invited: number;
    skipped: number;
    errors: number;
  };
}

export function bulkPreview(rows: BulkRowInput[]): Promise<BulkPreviewResponse> {
  return request<BulkPreviewResponse>(`${FN}?action=bulk-preview`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export function bulkImport(rows: BulkRowInput[]): Promise<BulkImportResponse> {
  return request<BulkImportResponse>(`${FN}?action=bulk-import`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
