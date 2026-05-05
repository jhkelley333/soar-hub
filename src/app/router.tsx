import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { LoginPage } from "@/auth/LoginPage";
import { ResetPasswordPage } from "@/auth/ResetPasswordPage";
import { AcceptInvitePage } from "@/auth/AcceptInvitePage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { WorkOrdersPage } from "@/modules/work-orders/WorkOrdersPage";
import { PafPage } from "@/modules/paf/PafPage";
import { ResourcesPage } from "@/modules/resources/ResourcesPage";
import { TeamPage } from "@/modules/team/TeamPage";
import { CfmExpiringPage } from "@/modules/team/CfmExpiringPage";
import { OrgPage } from "@/modules/admin/OrgPage";
import { BulkImportPage } from "@/modules/admin/BulkImportPage";
import { BulkOrgImportPage } from "@/modules/admin/BulkOrgImportPage";
import { RankerPage } from "@/modules/ranker/RankerPage";
import { AccountPage } from "@/modules/account/AccountPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "work-orders", element: <WorkOrdersPage /> },
      {
        path: "paf",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <PafPage />
          </ProtectedRoute>
        ),
      },
      { path: "resources", element: <ResourcesPage /> },
      { path: "account", element: <AccountPage /> },
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
        path: "ranker",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <RankerPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
