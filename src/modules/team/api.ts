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
}

export interface ManagedUser {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
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
