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

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: await authHeaders() });
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
