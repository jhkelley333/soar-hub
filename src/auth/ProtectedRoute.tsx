import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import type { ReactNode } from "react";
import type { UserRole } from "@/types/database";

interface Props {
  children: ReactNode;
  requireRoles?: UserRole[];
}

export function ProtectedRoute({ children, requireRoles }: Props) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

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

  if (requireRoles && profile && !requireRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
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
