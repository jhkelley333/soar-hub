import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { LoginPage } from "@/auth/LoginPage";
import { ResetPasswordPage } from "@/auth/ResetPasswordPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { WorkOrdersPage } from "@/modules/work-orders/WorkOrdersPage";
import { PafPage } from "@/modules/paf/PafPage";
import { ResourcesPage } from "@/modules/resources/ResourcesPage";
import { TeamPage } from "@/modules/team/TeamPage";
import { OrgPage } from "@/modules/admin/OrgPage";
import { RankerPage } from "@/modules/ranker/RankerPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
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
      { path: "paf", element: <PafPage /> },
      { path: "resources", element: <ResourcesPage /> },
      {
        path: "team",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <TeamPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/org",
        element: (
          <ProtectedRoute requireRoles={["vp", "coo", "admin"]}>
            <OrgPage />
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
