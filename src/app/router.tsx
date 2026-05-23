import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { useAuth } from "@/auth/AuthProvider";
import { useFlag } from "@/lib/flags";
import { LandingPage } from "@/auth/LandingPage";
import type { ReactNode } from "react";
import type { UserRole } from "@/types/database";
import { LoginPage } from "@/auth/LoginPage";
import { ResetPasswordPage } from "@/auth/ResetPasswordPage";
import { AcceptInvitePage } from "@/auth/AcceptInvitePage";
import { PafAcceptPage } from "@/auth/PafAcceptPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { WorkOrdersPage } from "@/modules/work-orders/WorkOrdersPage";
import { PafPage } from "@/modules/paf/PafPage";
import { PafQueuePage } from "@/modules/paf/PafQueuePage";
import { ResourcesPage } from "@/modules/resources/ResourcesPage";
import { ContactsPage } from "@/modules/contacts/ContactsPage";
import { TeamPage } from "@/modules/team/TeamPage";
import { CfmExpiringPage } from "@/modules/team/CfmExpiringPage";
import { OrgPage } from "@/modules/admin/OrgPage";
import { BulkImportPage } from "@/modules/admin/BulkImportPage";
import { BulkOrgImportPage } from "@/modules/admin/BulkOrgImportPage";
import { BulkAttributesPage } from "@/modules/admin/BulkAttributesPage";
import { FeatureFlagsPage } from "@/modules/admin/FeatureFlagsPage";
import { PafConfigPage } from "@/modules/admin/pafConfig/PafConfigPage";
import { RankerPage } from "@/modules/ranker/RankerPage";
import { MyStoresPage } from "@/modules/my-stores/MyStoresPage";
import { AccountPage } from "@/modules/account/AccountPage";
import { WorkOrdersV2Page } from "@/modules/work-orders-v2/WorkOrdersV2Page";
import { VendorPortalPage } from "@/modules/vendor-portal/VendorPortalPage";
import { PublicSubmitPage } from "@/modules/public-submit/PublicSubmitPage";
import { WorkspacesPage } from "@/modules/workspaces/WorkspacesPage";
import { WorkspaceDetail } from "@/modules/workspaces/WorkspaceDetail";
import { TemplateDetailPage } from "@/modules/workspaces/TemplateDetailPage";
import { AssignmentsPage } from "@/modules/workspaces/AssignmentsPage";
import { AssignmentDetailPage } from "@/modules/workspaces/AssignmentDetailPage";
import { SubmissionFormPage } from "@/modules/workspaces/SubmissionFormPage";
import { SubmissionViewerPage } from "@/modules/workspaces/SubmissionViewerPage";
import { SignoffQueuePage } from "@/modules/workspaces/SignoffQueuePage";
import { MyCapsPage } from "@/modules/workspaces/MyCapsPage";
import { CapDetailPage } from "@/modules/workspaces/CapDetailPage";
import { RenoScopingPage } from "@/modules/reno-scoping/RenoScopingPage";
import { NewScopePage } from "@/modules/reno-scoping/NewScopePage";
import { ScopeDetailPage } from "@/modules/reno-scoping/ScopeDetailPage";
import { RegionPage } from "@/modules/region/RegionPage";
import { ApprovalsPage } from "@/modules/approvals/ApprovalsPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
  { path: "/paf/accept", element: <PafAcceptPage /> },
  // Public anonymous vendor portal — opens directly from QR sticker.
  // Token in the URL is the only credential; no login required.
  { path: "/v/:token", element: <VendorPortalPage /> },
  // Public ticket-submission page — anyone with the URL can search
  // for a store and file a work order. Lives outside the auth tree.
  { path: "/submit", element: <PublicSubmitPage /> },
  {
    path: "/",
    element: <RootRoute />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "work-orders", element: <WorkOrdersPage /> },
      {
        path: "paf",
        element: (
          <FlagOrRoleRoute roles={["payroll", "admin"]} flagKey="paf_pilot">
            <PafPage />
          </FlagOrRoleRoute>
        ),
      },
      {
        path: "paf/queue",
        element: (
          <ProtectedRoute requireRoles={["payroll", "admin"]}>
            <PafQueuePage />
          </ProtectedRoute>
        ),
      },
      { path: "contacts", element: <ContactsPage /> },
      {
        path: "resources",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <ResourcesPage />
          </ProtectedRoute>
        ),
      },
      { path: "account", element: <AccountPage /> },
      { path: "my-stores", element: <MyStoresPage /> },
      {
        // Region rollup (mobile-first preview). Visible to DO+ — GMs
        // only see one store and don't need a rollup. Placeholder
        // scores; see src/modules/region/scoring.ts.
        path: "region",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <RegionPage />
          </ProtectedRoute>
        ),
      },
      {
        // Approvals queue (mobile-first preview). Pulls real pending
        // workspace sign-offs scoped to the caller via the existing
        // listMySignoffs() function. Tier + score come from the real
        // audit_outcome / audit_score_percent — no placeholders here.
        // Not in the sidebar (preview convention); open via /approvals.
        path: "approvals",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <ApprovalsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "team",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <TeamPage />
          </ProtectedRoute>
        ),
      },
      { path: "cfm-expiring", element: <CfmExpiringPage /> },
      {
        path: "admin/org",
        element: (
          <ProtectedRoute requireRoles={["vp", "coo", "admin"]}>
            <OrgPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/bulk-import",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <BulkImportPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/bulk-org-import",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <BulkOrgImportPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/bulk-attributes",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <BulkAttributesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/feature-flags",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <FeatureFlagsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/paf-config",
        element: (
          <ProtectedRoute requireRoles={["payroll", "admin"]}>
            <PafConfigPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/work-orders-v2",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WorkOrdersV2Page />
          </ProtectedRoute>
        ),
      },
      {
        path: "ranker",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <RankerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "workspaces",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <WorkspacesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "workspaces/:id",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <WorkspaceDetail />
          </ProtectedRoute>
        ),
      },
      {
        path: "workspaces/:wsId/templates/:tplId",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <TemplateDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "assignments",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <AssignmentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "assignments/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <AssignmentDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "assignments/:id/fill",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <SubmissionFormPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "submissions/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <SubmissionViewerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "signoffs",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <SignoffQueuePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "caps",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <MyCapsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "caps/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <CapDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "reno-scoping",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <RenoScopingPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "reno-scoping/new",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <NewScopePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "reno-scoping/:id",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <ScopeDetailPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

// RootRoute decides what fills the "/" slot:
//   • loading auth         → spinner
//   • no session + path /  → public LandingPage (firewall-friendly,
//                             see comment block in LandingPage.tsx)
//   • no session + sub-path → bounce to /login like ProtectedRoute did
//   • session              → AppShell, which renders the child Outlet
function RootRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading...
      </div>
    );
  }

  if (!session) {
    if (location.pathname === "/") return <LandingPage />;
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <AppShell />;
}

// FlagOrRoleRoute — pilot-friendly route guard. Lets a user in if their
// role matches OR if the named feature flag resolves to ON for them.
// Used to widen access to specific testers (per-user allowlist on the
// flag) without changing the role rule. Profile-load failure is handled
// the same way as ProtectedRoute(requireRoles).
function FlagOrRoleRoute({
  roles,
  flagKey,
  children,
}: {
  roles: UserRole[];
  flagKey: string;
  children: ReactNode;
}) {
  const { session, profile, loading } = useAuth();
  const flagOn = useFlag(flagKey);
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
  if (!profile) {
    return <Navigate to="/" replace />;
  }
  if (roles.includes(profile.role) || flagOn) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
