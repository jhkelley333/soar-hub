import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { useAuth } from "@/auth/AuthProvider";
import { useFlag } from "@/lib/flags";
import { LaunchSplash } from "@/auth/LaunchSplash";
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
import { EmployeeActionsPage } from "@/modules/employee-actions/EmployeeActionsPage";
import { SchedulePage } from "@/modules/schedule/SchedulePage";
import { OpsToolsPage } from "@/modules/ops-tools/OpsToolsPage";
import { QrCodesPage } from "@/modules/qr-codes/QrCodesPage";
import { SiteAuditPage } from "@/modules/site-audit/SiteAuditPage";
import { BusinessDisruptionsPage } from "@/modules/business-disruptions/BusinessDisruptionsPage";
import { LaborPage } from "@/modules/labor/LaborPage";
import { LaborSyncPage } from "@/modules/labor/LaborSyncPage";
import { ResourcesPage } from "@/modules/resources/ResourcesPage";
import { ContactsPage } from "@/modules/contacts/ContactsPage";
import { TeamPage } from "@/modules/team/TeamPage";
import { CfmExpiringPage } from "@/modules/team/CfmExpiringPage";
import { OrgPage } from "@/modules/admin/OrgPage";
import { BulkImportPage } from "@/modules/admin/BulkImportPage";
import { BulkOrgImportPage } from "@/modules/admin/BulkOrgImportPage";
import { BulkAttributesPage } from "@/modules/admin/BulkAttributesPage";
import { FeatureFlagsPage } from "@/modules/admin/FeatureFlagsPage";
import { RoleAccessPage } from "@/modules/admin/RoleAccessPage";
import { RegionAccessPage } from "@/modules/admin/RegionAccessPage";
import { KpiDashboardPage } from "@/modules/kpi/KpiDashboardPage";
import { LaborV2Page } from "@/modules/labor-v2/LaborV2Page";
import { RankingAdminPage } from "@/modules/ranking/RankingAdminPage";
import { PullLogPage } from "@/modules/labor-v2/PullLogPage";
import { LaborV2Entry } from "@/modules/labor-v2/LaborV2Entry";
import { QsrHomePage } from "@/modules/qsr/QsrHomePage";
import { TrainingHubPage } from "@/modules/qsr/TrainingHubPage";
import { LessonPlayer } from "@/modules/qsr/player/LessonPlayer";
import { BuilderCoursesPage } from "@/modules/qsr/builder/BuilderCoursesPage";
import { CourseEditorPage } from "@/modules/qsr/builder/CourseEditorPage";
import { ManagerDashboardPage } from "@/modules/qsr/manage/ManagerDashboardPage";
import { PafConfigPage } from "@/modules/admin/pafConfig/PafConfigPage";
import { TemplatesListPage } from "@/modules/walkthrough/builder/TemplatesListPage";
import { WalkthroughBuilderPage } from "@/modules/walkthrough/builder/WalkthroughBuilderPage";
import { moduleKeyForPath } from "@/app/nav";
import { useOverrides } from "@/lib/roleAccess";
import { RankerPage } from "@/modules/ranker/RankerPage";
import { TerritoryMapPage } from "@/modules/territory-map/TerritoryMapPage";
import { SharedTerritoryMapPage } from "@/modules/territory-map/SharedTerritoryMapPage";
import { PlPage } from "@/modules/pl/PlPage";
import { CountPage } from "@/modules/count/CountPage";
import { MyStoresPage } from "@/modules/my-stores/MyStoresPage";
import { AccountPage } from "@/modules/account/AccountPage";
import { WorkOrdersV2Route } from "@/modules/work-orders-v2/WorkOrdersV2Route";
import { CashManagementRoute } from "@/modules/cash-management/CashManagementRoute";
import { VendorPortalPage } from "@/modules/vendor-portal/VendorPortalPage";
import { PublicSubmitPage } from "@/modules/public-submit/PublicSubmitPage";
import { PublicLearnPage } from "@/modules/qsr/public/PublicLearnPage";
import { StorePortalPage } from "@/modules/store-portal/StorePortalPage";
import { StorePortalAdminPage } from "@/modules/store-portal/StorePortalAdminPage";
import { StorePortalLivePage } from "@/modules/store-portal/StorePortalLivePage";
import { PhoneUploadPage } from "@/modules/store-portal/PhoneUploadPage";
import { SharePage } from "@/modules/qsr/share/SharePage";
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
import { WalkthroughPage } from "@/modules/walkthrough/WalkthroughPage";
import { WalkthroughRunner } from "@/modules/walkthrough/WalkthroughRunner";
import { MyWalksPage } from "@/modules/walkthrough/MyWalksPage";
import { StoreGeofencesPage } from "@/modules/walkthrough/storegeo/StoreGeofencesPage";
import { WalkthroughHubPage } from "@/modules/walkthrough/WalkthroughHubPage";
import { ReviewDashboardPage } from "@/modules/walkthrough/review/ReviewDashboardPage";
import { SubmissionDetailPage } from "@/modules/walkthrough/review/SubmissionDetailPage";
import { AssignmentsPage as WalkthroughAssignmentsPage } from "@/modules/walkthrough/assign/AssignmentsPage";
import { DirectoryPage } from "@/modules/directory/DirectoryPage";
import { ChatLayout } from "@/modules/chat/ChatLayout";
import { GroupInfoPage } from "@/modules/chat/GroupInfoPage";
import { CoachingToolkitPage } from "@/modules/coaching/CoachingToolkitPage";
import { ToolDetailPage } from "@/modules/coaching/ToolDetailPage";
import { TeamPipelinePage } from "@/modules/team-pipeline/TeamPipelinePage";
import { NlaTakePage } from "@/modules/nla/NlaTakePage";
import { NlaComparePage } from "@/modules/nla/NlaComparePage";
import { NlaAdminPage } from "@/modules/nla/NlaAdminPage";
import { ManualSearchPage } from "@/modules/manuals/ManualSearchPage";
import { ManualAdminPage } from "@/modules/manuals/ManualAdminPage";
import { WeatherPage } from "@/modules/weather/WeatherPage";
import { WeatherSyncPage } from "@/modules/weather/WeatherSyncPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/accept-invite", element: <AcceptInvitePage /> },
  { path: "/paf/accept", element: <PafAcceptPage /> },
  // Public anonymous vendor portal — opens directly from QR sticker.
  // Token in the URL is the only credential; no login required.
  { path: "/v/:token", element: <VendorPortalPage /> },
  // Public shared Territory Map — token in the URL is the credential;
  // scope resolves live to whatever the link's creator can see.
  { path: "/map/:token", element: <SharedTerritoryMapPage /> },
  // Public ticket-submission page — anyone with the URL can search
  // for a store and file a work order. Lives outside the auth tree.
  { path: "/submit", element: <PublicSubmitPage /> },
  // Public no-login QSR player — crew scan their store's QR, pick their
  // name, and take courses. Token in the URL is the only credential.
  { path: "/learn/:token", element: <PublicLearnPage /> },
  // Store Command Center — the per-store desktop bookmark. Token in the URL,
  // bound to the first device that opens it (store-portal.js enforces).
  { path: "/s/:token", element: <StorePortalPage /> },
  // Phone side of the Command Center photo handoff — signed short-lived
  // token from the QR the store screen displays.
  { path: "/p/:token", element: <PhoneUploadPage /> },
  {
    path: "/",
    element: <RootRoute />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "work-orders", element: <WorkOrdersPage /> },
      {
        path: "paf",
        element: (
          <FlagOrRoleRoute roles={["do", "payroll", "admin"]} flagKey="paf_pilot">
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
      {
        path: "employee-actions",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <EmployeeActionsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "schedule",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <SchedulePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "operations",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]}>
            <OpsToolsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "site-audits",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]}>
            <SiteAuditPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "business-disruptions",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <BusinessDisruptionsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "labor",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <LaborPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/labor-sync",
        element: (
          <ProtectedRoute requireRoles={["vp", "coo", "admin"]}>
            <LaborSyncPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/weather-sync",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <WeatherSyncPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/kpi",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <KpiDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/ranking",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <RankingAdminPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/labor-v2",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <LaborV2Page />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/labor-v2/log",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <PullLogPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "labor-v2",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <LaborV2Entry />
          </ProtectedRoute>
        ),
      },
      { path: "contacts", element: <ContactsPage /> },
      { path: "manuals", element: <ManualSearchPage /> },
      {
        path: "weather",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WeatherPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/manuals",
        element: (
          <ProtectedRoute requireRoles={["rvp", "vp", "coo", "admin"]}>
            <ManualAdminPage />
          </ProtectedRoute>
        ),
      },
      { path: "chat", element: <ChatLayout /> },
      { path: "chat/:threadId", element: <ChatLayout /> },
      { path: "chat/:threadId/info", element: <GroupInfoPage /> },
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
        // Walkthrough (mobile-first preview). Hardcoded sample data —
        // a "Weekly Walkthrough" template with 7 sections, currently
        // on the Drive-thru section. Pass/Watch/Fail toggles + save-
        // status pill all interact locally. Real form fills still live
        // in /assignments/:id/fill (SubmissionFormPage). Preview-only
        // route, no sidebar entry.
        path: "walkthrough",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughPage />
          </ProtectedRoute>
        ),
      },
      {
        // Walkthrough runner (mobile-first preview). The real GM in-field
        // flow: GPS check-in gate → sectioned checklist → review. Offline-
        // first (Dexie) — rate items, add photos, switch sections, refresh
        // mid-walk with nothing lost. Mounts the SAMPLE_* fixture; the
        // submit transaction + backend table are the next ticket, so Review
        // renders Publish disabled. Open via /walkthrough/run.
        path: "walkthrough/run",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughRunner />
          </ProtectedRoute>
        ),
      },
      {
        // GM "my walks" landing — assigned walks to start/continue + recent
        // submissions. Mobile-first; same assignee roles as the runner.
        path: "my-walks",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <MyWalksPage />
          </ProtectedRoute>
        ),
      },
      {
        // Live runner for a real assignment (drafts + photos sync; Publish
        // calls the submit transaction). Get an id from the dev-seed action
        // until the assignment UI lands.
        path: "walkthrough/run/:assignmentId",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughRunner />
          </ProtectedRoute>
        ),
      },
      {
        // Walkthroughs hub (DO+) — Review / Assignments / Templates as tabs,
        // plus an admin-only Geofences tab. The standalone routes below still
        // work for deep links (submission detail, builder edit, etc.).
        path: "walkthroughs",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughHubPage />
          </ProtectedRoute>
        ),
      },
      {
        // DO walkthrough review + corrective-action tracker. RLS scopes to
        // the caller's stores. DO and up.
        path: "walkthrough-review",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <ReviewDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "walkthrough-review/s/:id",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <SubmissionDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        // DO assigns walkthroughs to GMs (template + store + assignee + due).
        // RLS scopes inserts/reads to the caller's stores. DO and up.
        path: "walkthrough-assignments",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughAssignmentsPage />
          </ProtectedRoute>
        ),
      },
      {
        // Store geofence backfill — admin-only resource (also a tab in the
        // Walkthroughs hub for admins).
        path: "admin/store-geofences",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <StoreGeofencesPage />
          </ProtectedRoute>
        ),
      },
      {
        // Directory (mobile-first preview). Real org data via
        // fetchMyTree() — RLS-scoped to the caller. Pinned section
        // adapts to the caller's role; segmented control switches
        // between District / Region / Above-store. Lives at /directory
        // so it doesn't collide with the existing /contacts page
        // (which is the admin-curated vendor + regional directory).
        // Preview-only route, no sidebar entry.
        path: "directory",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <DirectoryPage />
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
        // Coaching for Performance Tool Kit — a reference card chooser for
        // hourly managers and above. Home chooser + per-tool detail routes.
        path: "coaching",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <CoachingToolkitPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "coaching/:toolId",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <ToolDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        // Team Pipeline (Talent Planning) — gated behind the team_pipeline
        // feature flag. roles:[] means access comes only from the flag
        // (global enable or per-user/store allowlist) — admin always in.
        path: "team-pipeline",
        element: (
          <FlagOrRoleRoute roles={[]} flagKey="team_pipeline">
            <TeamPipelinePage />
          </FlagOrRoleRoute>
        ),
      },
      // Next Level Assessment. The list now lives in the Training hub's
      // Assessments tab; detail routes stay standalone. The nla function
      // enforces per-assessment access.
      { path: "nla", element: <Navigate to="/training?tab=assessments" replace /> },
      {
        path: "admin/store-portal",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <StorePortalAdminPage />
          </ProtectedRoute>
        ),
      },
      {
        // Live admin view of one store's Command Center screen.
        path: "admin/store-portal/:storeId",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <StorePortalLivePage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/nla-templates",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <NlaAdminPage />
          </ProtectedRoute>
        ),
      },
      { path: "nla/:id", element: <NlaTakePage /> },
      { path: "nla/:id/compare", element: <NlaComparePage /> },
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
        path: "admin/role-access",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <RoleAccessPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/region-access",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <RegionAccessPage />
          </ProtectedRoute>
        ),
      },
      {
        // SOAR QSR Learning Platform — admin-only during the build.
        path: "qsr",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <QsrHomePage />
          </ProtectedRoute>
        ),
      },
      {
        // Training hub — the single home for training: My Training, Team
        // Training, and Assessments as tabs, plus the QR-codes launcher.
        // Open to every signed-in user; tabs gate themselves by role/flag.
        path: "training",
        element: <TrainingHubPage />,
      },
      // Old entry points redirect into the hub (deep links + the login
      // required-training prompt keep working).
      { path: "my-training", element: <Navigate to="/training" replace /> },
      {
        // The course player is open to any signed-in user (it's training
        // content; the server only serves published courses and tracks
        // per-user progress). Home / Builder / Manager stay admin-only.
        path: "qsr/course/:courseId",
        element: <LessonPlayer />,
      },
      {
        path: "qsr/builder",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <BuilderCoursesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "qsr/builder/:courseId",
        element: (
          <ProtectedRoute requireRoles={["admin"]}>
            <CourseEditorPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "qsr/manage",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]}>
            <ManagerDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "qsr/share",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <SharePage />
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
        // Walkthrough template builder — DO+ author the checklists GMs run.
        // Direct-to-Supabase writes (walkthrough_templates RLS allows DO+).
        path: "admin/walkthrough-templates",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <TemplatesListPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/walkthrough-templates/new",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughBuilderPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/walkthrough-templates/:id",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WalkthroughBuilderPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "admin/work-orders-v2",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <WorkOrdersV2Route />
          </ProtectedRoute>
        ),
      },
      {
        // Cash Management — night-close → next-day deposit cycle. Store
        // leaders run closeouts/deposits; DO+ act on alerts (enforced in
        // cash-management.js). Rolled out by role now (pilot flag retired).
        path: "admin/cash-management",
        element: (
          <ProtectedRoute requireRoles={["gm", "shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "do", "sdo", "rvp", "vp", "coo", "admin", "accounting"]}>
            <CashManagementRoute />
          </ProtectedRoute>
        ),
      },
      {
        path: "ranker",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]}>
            <RankerPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "territory-map",
        element: (
          <ProtectedRoute requireRoles={["do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]}>
            <TerritoryMapPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "pl",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc", "accounting"]}>
            <PlPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "count",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc", "accounting"]}>
            <CountPage />
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
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <AssignmentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "assignments/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <AssignmentDetailPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "assignments/:id/fill",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <SubmissionFormPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "submissions/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
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
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
            <MyCapsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "caps/:id",
        element: (
          <ProtectedRoute requireRoles={["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "crew_member", "carhop", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll"]}>
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
      {
        // QR Codes — dynamic QR generator, reached from the Operations Tools
        // hub. GM and above; the backend re-checks role on every write.
        path: "qr-codes",
        element: (
          <ProtectedRoute requireRoles={["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]}>
            <QrCodesPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

// RootRoute decides what fills the "/" slot:
//   • loading auth         → LaunchSplash (boot)
//   • no session + path /  → LaunchSplash landing variant (Sign in CTA
//                             + descriptor; firewall-friendly)
//   • no session + sub-path → bounce to /login like ProtectedRoute did
//   • session              → AppShell, which renders the child Outlet
function RootRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LaunchSplash subline="Starting up…" />;
  }

  if (!session) {
    if (location.pathname === "/") return <LaunchSplash showSignIn />;
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
  const { overrides, isLoaded } = useOverrides();
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
  const role = profile.role;
  const staticOk = roles.includes(role) || flagOn;
  const moduleKey = moduleKeyForPath(location.pathname);
  const ov = isLoaded && moduleKey ? overrides[moduleKey]?.[role] : undefined;
  const allowed = role === "admin" || (ov !== undefined ? ov : staticOk);
  if (allowed) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
