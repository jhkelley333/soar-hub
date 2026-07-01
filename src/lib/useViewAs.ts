import { useEffect, useState } from "react";
import { getViewAsState, setViewAsState, subscribeViewAs, type ViewAsState } from "./viewAs";
import type { UserRole } from "@/types/database";

export function useViewAs(): ViewAsState | null {
  const [state, setState] = useState<ViewAsState | null>(getViewAsState());
  useEffect(() => subscribeViewAs(setState), []);
  return state;
}

// The role to render the app shell as: the target's role while a View As
// session is active, otherwise the real signed-in profile's role. Nav
// visibility, route guards, and dashboard card gating all read this
// instead of `profile.role` directly so the admin sees the same shell the
// target would — this never changes what the real caller is ALLOWED to do
// (every write stays blocked server-side by X-View-As-User-Id), only what
// the UI shows them.
export function useEffectiveRole(profile: { role: UserRole } | null | undefined): UserRole | undefined {
  const viewAs = useViewAs();
  if (viewAs) return viewAs.target.role as UserRole;
  return profile?.role;
}

// Re-exported so components don't need to reach into ./viewAs directly —
// mutating state through here keeps the sessionStorage mirror + listeners
// in sync in one place.
export { setViewAsState };
