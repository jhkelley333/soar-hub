// Per-role module-visibility overrides (Role Access admin page).
//
// Overrides are deviations from the code defaults in nav.ts. The resolver
// below decides whether a role can see a module: an override wins; else
// the code default applies; admin always sees everything.
//
// This governs UI/nav/route visibility only — the backend + RLS remain
// the real data boundary.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/role-access";

export interface RoleAccessOverride {
  module_key: string;
  role: UserRole;
  visible: boolean;
}

// Nested lookup: overrides[moduleKey][role] = visible.
export type OverrideMap = Record<string, Partial<Record<UserRole, boolean>>>;

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function fetchOverrides(): Promise<OverrideMap> {
  const res = await fetch(`${FN}?action=list`, { headers: await authHeaders() });
  if (!res.ok) return {};
  const body = (await res.json()) as { ok?: boolean; overrides?: RoleAccessOverride[] };
  const map: OverrideMap = {};
  for (const o of body.overrides ?? []) {
    (map[o.module_key] ||= {})[o.role] = o.visible;
  }
  return map;
}

// Shared cache key so the nav + every route guard read one response.
export function useOverrides(): { overrides: OverrideMap; isLoaded: boolean } {
  const { data, isSuccess } = useQuery({
    queryKey: ["role-access"],
    queryFn: fetchOverrides,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return { overrides: data ?? {}, isLoaded: isSuccess };
}

// Core resolver. `defaultRoles === null` means "everyone" in nav.ts.
export function moduleVisible(
  role: UserRole | undefined,
  moduleKey: string,
  defaultRoles: UserRole[] | null,
  overrides: OverrideMap,
): boolean {
  if (!role) return false;
  if (role === "admin") return true; // admin always retains full access
  const o = overrides[moduleKey]?.[role];
  if (o !== undefined) return o;
  return defaultRoles === null ? true : defaultRoles.includes(role);
}

// Admin writes.
export async function setModuleAccess(module_key: string, role: UserRole, visible: boolean): Promise<void> {
  const res = await fetch(`${FN}?action=set`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ module_key, role, visible }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || "Couldn't save.");
  }
}

export async function clearModuleAccess(module_key: string, role: UserRole): Promise<void> {
  const res = await fetch(`${FN}?action=clear`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ module_key, role }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.message || "Couldn't reset.");
  }
}
