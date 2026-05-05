// src/modules/admin/api.ts
//
// Typed wrappers + types for the Org Admin tree (Phase 2c V1).
// Mirrors the auth pattern used by team/api.ts.

import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/org-mgmt";

export interface OrgManager {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
}

export interface OrgStore {
  id: string;
  number: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_active: boolean;
  managers: OrgManager[];
}

export interface OrgDistrict {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  managers: OrgManager[];
  stores: OrgStore[];
}

export interface OrgArea {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  managers: OrgManager[];
  districts: OrgDistrict[];
}

export interface OrgRegion {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  managers: OrgManager[];
  areas: OrgArea[];
}

export interface OrgTreeStats {
  total_regions: number;
  total_areas: number;
  total_districts: number;
  total_stores: number;
  active_stores: number;
  vacant_scopes: number;
}

export interface OrgTreeResponse {
  regions: OrgRegion[];
  stats: OrgTreeStats;
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

export function fetchOrgTree(): Promise<OrgTreeResponse> {
  return request<OrgTreeResponse>(`${FN}?action=tree`);
}

// ----------------------------------------------------------------------------
// Write actions (admin only on the server)
// ----------------------------------------------------------------------------

export type OrgTargetKind = "region" | "area" | "district" | "store";
export type OrgChangeAction =
  | "create"
  | "update"
  | "move"
  | "deactivate"
  | "reactivate";

interface BaseFields {
  is_active?: boolean;
}

interface CreateRegionInput extends BaseFields {
  kind: "region";
  code: string;
  name: string;
}
interface CreateAreaInput extends BaseFields {
  kind: "area";
  code: string;
  name: string;
  region_id: string;
}
interface CreateDistrictInput extends BaseFields {
  kind: "district";
  code: string;
  name: string;
  area_id: string;
}
interface CreateStoreInput extends BaseFields {
  kind: "store";
  number: string;
  name: string;
  district_id: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type CreateOrgNodeInput =
  | CreateRegionInput
  | CreateAreaInput
  | CreateDistrictInput
  | CreateStoreInput;

export interface UpdateOrgNodeInput {
  kind: OrgTargetKind;
  id: string;
  // Any subset of editable fields. The backend filters keys it doesn't
  // know about, so unknowns are silently dropped.
  code?: string;
  name?: string;
  number?: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  is_active?: boolean;
}

export interface MoveOrgNodeInput {
  kind: "store" | "district" | "area";
  id: string;
  district_id?: string; // for stores
  area_id?: string; // for districts
  region_id?: string; // for areas
}

export function createOrgNode(input: CreateOrgNodeInput): Promise<{ ok: true; node: { id: string } }> {
  return request<{ ok: true; node: { id: string } }>(
    `${FN}?action=create`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function updateOrgNode(input: UpdateOrgNodeInput): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=update`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function moveOrgNode(input: MoveOrgNodeInput): Promise<{ ok: true }> {
  return request<{ ok: true }>(`${FN}?action=move`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface OrgHistoryEntry {
  id: string;
  target_kind: OrgTargetKind;
  target_id: string;
  action: OrgChangeAction;
  created_at: string;
  actor: {
    id: string;
    full_name: string | null;
    email: string | null;
  };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface OrgHistoryResponse {
  entries: OrgHistoryEntry[];
}

export function fetchOrgHistory(opts: {
  target_kind?: OrgTargetKind;
  target_id?: string;
  limit?: number;
} = {}): Promise<OrgHistoryResponse> {
  const params = new URLSearchParams({ action: "history" });
  if (opts.target_kind) params.set("target_kind", opts.target_kind);
  if (opts.target_id) params.set("target_id", opts.target_id);
  if (opts.limit) params.set("limit", String(opts.limit));
  return request<OrgHistoryResponse>(`${FN}?${params.toString()}`);
}
