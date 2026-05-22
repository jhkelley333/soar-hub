// /workspaces — tabbed landing page. Four tabs:
//   • Workspaces        — list of workspaces the caller can see
//   • My Assignments    — cross-workspace personal assignment queue
//   • Sign-off Queue    — submissions waiting on the caller to approve
//   • My CAPs           — corrective action plans the caller owns/verifies
//
// Workspaces is the only sidebar entry; the other three views are
// reachable via the tabs here (or their standalone routes
// /assignments, /signoffs, /caps if linked-to directly).

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Archive, Globe, Lock, MapPin,
  ClipboardList, Inbox, CheckSquare, AlertOctagon,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { listWorkspaces } from "./api";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { AssignmentsPage } from "./AssignmentsPage";
import { SignoffQueuePage } from "./SignoffQueuePage";
import { MyCapsPage } from "./MyCapsPage";
import type { Workspace } from "./types";

// Capability mirror: only DO+ can create workspaces (matches the
// GLOBAL_CAPS map in _lib/workspace_permissions.js).
const CAN_CREATE_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

type TabKey = "workspaces" | "assignments" | "signoffs" | "caps";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Inbox }> = [
  { key: "workspaces",  label: "Workspaces",      icon: ClipboardList },
  { key: "assignments", label: "My Assignments",  icon: Inbox },
  { key: "signoffs",    label: "Sign-off Queue",  icon: CheckSquare },
  { key: "caps",        label: "My CAPs",         icon: AlertOctagon },
];

function visibilityIcon(v: Workspace["visibility"]) {
  if (v === "organization") return <Globe className="h-3.5 w-3.5" />;
  if (v === "private")      return <Lock   className="h-3.5 w-3.5" />;
  return <MapPin className="h-3.5 w-3.5" />;
}

function visibilityLabel(v: Workspace["visibility"]) {
  if (v === "organization") return "Organization";
  if (v === "private")      return "Private";
  return "Scoped";
}

export function WorkspacesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam)
    ? (tabParam as TabKey)
    : "workspaces";

  function setTab(next: TabKey) {
    if (next === "workspaces") {
      // Default tab — keep the URL clean.
      setSearchParams({});
    } else {
      setSearchParams({ tab: next });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspaces"
        description="Forms, audits, compliance workflows, and the queues that drive them."
      />

      {/* Tab bar */}
      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition whitespace-nowrap " +
                (isActive
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900")
              }
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "workspaces"  && <WorkspacesList />}
      {tab === "assignments" && <AssignmentsPage embedded />}
      {tab === "signoffs"    && <SignoffQueuePage embedded />}
      {tab === "caps"        && <MyCapsPage embedded />}
    </div>
  );
}

// The original /workspaces list — broken out so the tabbed wrapper
// above can swap it in alongside the other three queue views.
function WorkspacesList() {
  const { profile } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = useQuery({
    queryKey: ["workspaces-list", includeArchived],
    queryFn: () => listWorkspaces(includeArchived),
  });

  const canCreate = CAN_CREATE_ROLES.includes(profile?.role ?? "");
  const workspaces = query.data?.workspaces ?? [];
  const active = workspaces.filter((w) => !w.is_archived);
  const archived = workspaces.filter((w) => w.is_archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded"
          />
          Include archived
        </label>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New workspace
          </Button>
        )}
      </div>

      {query.isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      )}

      {query.isError && (
        <Card className="p-6 text-red-600">
          Failed to load workspaces: {(query.error as Error)?.message ?? "Unknown error"}
        </Card>
      )}

      {query.isSuccess && !workspaces.length && (
        <EmptyState
          title="No workspaces yet"
          description={
            canCreate
              ? "Create your first workspace to start building forms and audits."
              : "Ask an admin or DO to add you to a workspace."
          }
        />
      )}

      {active.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {active.map((w) => <WorkspaceCard key={w.id} ws={w} />)}
        </div>
      )}

      {includeArchived && archived.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-4 text-sm font-medium text-gray-500">
            <Archive className="h-4 w-4" />
            Archived ({archived.length})
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 opacity-70">
            {archived.map((w) => <WorkspaceCard key={w.id} ws={w} />)}
          </div>
        </>
      )}

      <CreateWorkspaceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          query.refetch();
        }}
      />
    </div>
  );
}

function WorkspaceCard({ ws }: { ws: Workspace }) {
  return (
    <Link to={`/workspaces/${ws.id}`} className="block group">
      <Card className="p-5 hover:shadow-md transition-shadow h-full">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600">
            {ws.name}
          </h3>
          <Badge tone="neutral" className="shrink-0">
            <span className="flex items-center gap-1">
              {visibilityIcon(ws.visibility)}
              {visibilityLabel(ws.visibility)}
            </span>
          </Badge>
        </div>
        {ws.description && (
          <p className="text-sm text-gray-600 line-clamp-2">
            {ws.description}
          </p>
        )}
        <div className="mt-3 text-xs text-gray-500">
          Created {new Date(ws.created_at).toLocaleDateString()}
        </div>
      </Card>
    </Link>
  );
}
