import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import type { ReactNode } from "react";
import type { UserRole } from "@/types/database";
import { moduleKeyForPath } from "@/app/nav";
import { useOverrides } from "@/lib/roleAccess";
import { useRegionAccess, regionVisible } from "@/lib/regionAccess";

interface Props {
  children: ReactNode;
  requireRoles?: UserRole[];
}

export function ProtectedRoute({ children, requireRoles }: Props) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  // Role Access overrides can grant/revoke a role's access to a module.
  // Fail-open to the static requireRoles until the config has loaded.
  const { overrides, isLoaded } = useOverrides();
  // Region Access can additionally hide a module from a region's users.
  const { overrides: regionOverrides, myRegionIds } = useRegionAccess();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // AuthProvider intentionally keeps the session intact when a
  // post-auth-change loadProfile fails (network blip, RLS hiccup),
  // setting profile to null and surfacing a console warning. Without
  // a guard here, every role-gated child would render with no role
  // info — components that read profile.role would crash or render
  // empty data. Show a recoverable error and let the user retry.
  if (requireRoles && !profile) {
    return <ProfileLoadFailed />;
  }

  if (profile) {
    const role = profile.role;
    // Static decision from the route's requireRoles.
    const staticOk = !requireRoles || requireRoles.includes(role);
    // An explicit override for this module + role wins (grant or revoke).
    const moduleKey = moduleKeyForPath(location.pathname);
    const ov = isLoaded && moduleKey ? overrides[moduleKey]?.[role] : undefined;
    // Effective = role allows AND region allows. Region gate is skipped for
    // admins and for paths not under a managed module.
    const regionOk = role === "admin" || !moduleKey || regionVisible(moduleKey, myRegionIds, regionOverrides);
    const allowed = role === "admin" || ((ov !== undefined ? ov : staticOk) && regionOk);
    if (!allowed) {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
}

function ProfileLoadFailed() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="text-base font-semibold tracking-tight text-midnight">
        Couldn't load your profile
      </div>
      <p className="max-w-md text-sm text-zinc-600">
        Your sign-in succeeded, but we hit a snag fetching your account
        details. Try reloading; if it keeps failing contact your
        administrator.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-1 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-midnight"
      >
        Reload
      </button>
    </div>
  );
}
