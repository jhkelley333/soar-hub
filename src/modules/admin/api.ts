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

export type DriveThruType = "single_pole_two_menus" | "split_housing";

export interface OrgStore {
  id: string;
  number: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_active: boolean;
  // Operations / vendor
  plate_iq_email: string | null;
  soar_company_name: string | null;
  pay_cycle: string | null;
  acquisition_date: string | null;
  pos_provider: string | null;
  security_vendor: string | null;
  security_vendor_phone: string | null;
  food_vendor_name: string | null;
  // Active programs
  has_apple_pay: boolean;
  has_order_ahead: boolean;
  has_outdoor_seating: boolean;
  has_drive_thru: boolean;
  has_clearance_bar: boolean;
  drive_thru_lanes: number | null;
  drive_thru_type: DriveThruType | null;
  public_restroom_count: number;
  // Stall data
  patio_pop_menu_count: number;
  patio_pop_stall_numbers: string | null;
  order_ahead_stall_count: number;
  order_ahead_stall_numbers: string | null;
  stall_pop_menu_count: number;
  has_trailer_stall: boolean;
  trailer_stall_number: string | null;
  // Third-party delivery (jsonb array of provider keys)
  third_party_delivery: string[];
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
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  plate_iq_email?: string | null;
  soar_company_name?: string | null;
  pay_cycle?: string | null;
  acquisition_date?: string | null;
  pos_provider?: string | null;
  security_vendor?: string | null;
  security_vendor_phone?: string | null;
  food_vendor_name?: string | null;
  has_apple_pay?: boolean;
  has_order_ahead?: boolean;
  has_outdoor_seating?: boolean;
  has_drive_thru?: boolean;
  has_clearance_bar?: boolean;
  drive_thru_lanes?: number | null;
  drive_thru_type?: DriveThruType | null;
  public_restroom_count?: number;
  patio_pop_menu_count?: number;
  patio_pop_stall_numbers?: string | null;
  order_ahead_stall_count?: number;
  order_ahead_stall_numbers?: string | null;
  stall_pop_menu_count?: number;
  has_trailer_stall?: boolean;
  trailer_stall_number?: string | null;
  third_party_delivery?: string[];
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
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  is_active?: boolean;
  plate_iq_email?: string | null;
  soar_company_name?: string | null;
  pay_cycle?: string | null;
  acquisition_date?: string | null;
  pos_provider?: string | null;
  security_vendor?: string | null;
  security_vendor_phone?: string | null;
  food_vendor_name?: string | null;
  has_apple_pay?: boolean;
  has_order_ahead?: boolean;
  has_outdoor_seating?: boolean;
  has_drive_thru?: boolean;
  has_clearance_bar?: boolean;
  drive_thru_lanes?: number | null;
  drive_thru_type?: DriveThruType | null;
  public_restroom_count?: number;
  patio_pop_menu_count?: number;
  patio_pop_stall_numbers?: string | null;
  order_ahead_stall_count?: number;
  order_ahead_stall_numbers?: string | null;
  stall_pop_menu_count?: number;
  has_trailer_stall?: boolean;
  trailer_stall_number?: string | null;
  third_party_delivery?: string[];
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

// ----------------------------------------------------------------------------
// Bulk org import (admin only)
// ----------------------------------------------------------------------------

export type OrgKind = "region" | "area" | "district" | "store";

// Bulk-import semantics: every cell value is a string from the CSV.
// Empty / missing column means "don't update". Literal "NULL"
// (case-insensitive) means "explicit clear". The backend's bulkCell()
// helper enforces this — strings flow through verbatim here.
export interface OrgBulkRowInput {
  kind: string;
  code?: string;
  name?: string;
  number?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  plate_iq_email?: string;
  soar_company_name?: string;
  acquisition_date?: string;
  pos_provider?: string;
  security_vendor?: string;
  security_vendor_phone?: string;
  food_vendor_name?: string;
  has_apple_pay?: string;
  has_order_ahead?: string;
  has_outdoor_seating?: string;
  has_drive_thru?: string;
  has_clearance_bar?: string;
  drive_thru_lanes?: string;
  drive_thru_type?: string;
  public_restroom_count?: string;
  patio_pop_menu_count?: string;
  patio_pop_stall_numbers?: string;
  order_ahead_stall_count?: string;
  order_ahead_stall_numbers?: string;
  stall_pop_menu_count?: string;
  has_trailer_stall?: string;
  trailer_stall_number?: string;
  // Comma-separated provider keys (e.g. "doordash,ubereats")
  third_party_delivery?: string;
  parent_code?: string;
  is_active?: string;
}

export interface OrgBulkRowAnnotated {
  row: number;
  kind: string;
  code: string | null;
  name: string | null;
  number: string | null;
  parent_code: string | null;
  // Editable cells — undefined = skip on update, null = explicit clear,
  // value = set. The shape depends on the column's parser.
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  plate_iq_email?: string | null;
  soar_company_name?: string | null;
  pay_cycle?: string | null;
  acquisition_date?: string | null;
  pos_provider?: string | null;
  security_vendor?: string | null;
  security_vendor_phone?: string | null;
  food_vendor_name?: string | null;
  has_apple_pay?: boolean | null;
  has_order_ahead?: boolean | null;
  has_outdoor_seating?: boolean | null;
  has_drive_thru?: boolean | null;
  has_clearance_bar?: boolean | null;
  drive_thru_lanes?: number | null;
  drive_thru_type?: string | null;
  public_restroom_count?: number | null;
  patio_pop_menu_count?: number | null;
  patio_pop_stall_numbers?: string | null;
  order_ahead_stall_count?: number | null;
  order_ahead_stall_numbers?: string | null;
  stall_pop_menu_count?: number | null;
  has_trailer_stall?: boolean | null;
  trailer_stall_number?: string | null;
  third_party_delivery?: string[] | null;
  is_active?: boolean | null;
  action: "create" | "update";
  existing_id: string | null;
  parent_id: string | null;
  errors: string[];
  warnings: string[];
}

export interface OrgBulkPreviewResponse {
  rows: OrgBulkRowAnnotated[];
  summary: {
    total: number;
    create: number;
    update: number;
    invalid: number;
  };
}

export interface OrgBulkImportResult extends OrgBulkRowAnnotated {
  status: "created" | "updated" | "error";
  message?: string;
  node_id?: string;
}

export interface OrgBulkImportResponse {
  results: OrgBulkImportResult[];
  summary: {
    total: number;
    created: number;
    updated: number;
    errors: number;
  };
}

export function orgBulkPreview(rows: OrgBulkRowInput[]): Promise<OrgBulkPreviewResponse> {
  return request<OrgBulkPreviewResponse>(`${FN}?action=bulk-preview`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export function orgBulkImport(rows: OrgBulkRowInput[]): Promise<OrgBulkImportResponse> {
  return request<OrgBulkImportResponse>(`${FN}?action=bulk-import`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
