// /workspaces/:id — workspace detail. Tabs: Overview, Templates,
// Assignments, Members, Activity. Future slices add: Submissions,
// CAPs, Automations. Each tab is a separate file rendered here.

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Archive, ArchiveRestore, Trash2, Globe, Lock, MapPin, Settings, Users, Activity, AlertTriangle, FileText, ClipboardList,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Badge } from "@/shared/ui/Badge";
import {
  getWorkspace,
  archiveWorkspace,
  unarchiveWorkspace,
  deleteWorkspace,
} from "./api";
import { MembersTab } from "./MembersTab";
import { TemplatesTab } from "./TemplatesTab";
import { AssignmentsTab } from "./AssignmentsTab";
import { ActivityTab } from "./ActivityTab";
import type { Workspace } from "./types";

type TabKey = "overview" | "templates" | "assignments" | "members" | "activity";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Users }> = [
  { key: "overview",    label: "Overview",    icon: Settings },
  { key: "templates",   label: "Templates",   icon: FileText },
  { key: "assignments", label: "Assignments", icon: ClipboardList },
  { key: "members",     label: "Members",     icon: Users },
  { key: "activity",    label: "Activity",    icon: Activity },
];

function visibilityIcon(v: Workspace["visibility"]) {
  if (v === "organization") return <Globe className="h-3.5 w-3.5" />;
  if (v === "private")      return <Lock className="h-3.5 w-3.5" />;
  return <MapPin className="h-3.5 w-3.5" />;
}

export function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("overview");

  const query = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => getWorkspace(id!),
    enabled: !!id,
  });

  const archiveMut = useMutation({
    mutationFn: (action: "archive" | "unarchive") =>
      action === "archive" ? archiveWorkspace(id!) : unarchiveWorkspace(id!),
    onSuccess: () => query.refetch(),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteWorkspace(id!),
    onSuccess: () => navigate("/workspaces"),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-6">
        <p className="text-red-600 mb-3">
          Failed to load workspace: {(query.error as Error)?.message ?? "Unknown"}
        </p>
        <Link to="/workspaces">
          <Button variant="secondary">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
      </Card>
    );
  }

  const { workspace, members, my_workspace_role, my_is_admin } = query.data;
  const canEditSettings = my_is_admin || my_workspace_role === "owner";
  const canDelete = my_is_admin && workspace.is_archived;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/workspaces"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> All workspaces
        </Link>
        <PageHeader
          title={workspace.name}
          description={workspace.description ?? undefined}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">
                <span className="flex items-center gap-1">
                  {visibilityIcon(workspace.visibility)}
                  {workspace.visibility[0].toUpperCase() + workspace.visibility.slice(1)}
                </span>
              </Badge>
              {workspace.is_archived && <Badge tone="warning">Archived</Badge>}
            </div>
          }
        />
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 flex gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition " +
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

      {/* Tab body */}
      {tab === "overview" && (
        <OverviewTab
          workspace={workspace}
          memberCount={members.length}
          myRole={my_workspace_role}
          canEditSettings={canEditSettings}
          canDelete={canDelete}
          onArchive={() => archiveMut.mutate(workspace.is_archived ? "unarchive" : "archive")}
          onDelete={() => {
            if (confirm("Delete this workspace? This is permanent and cannot be undone.")) {
              deleteMut.mutate();
            }
          }}
        />
      )}
      {tab === "templates" && (
        <TemplatesTab
          workspaceId={workspace.id}
          canEdit={canEditSettings || my_workspace_role === "editor"}
        />
      )}
      {tab === "assignments" && (
        <AssignmentsTab
          workspaceId={workspace.id}
          members={members}
          canCreate={canEditSettings || my_workspace_role === "editor"}
        />
      )}
      {tab === "members" && (
        <MembersTab
          workspaceId={workspace.id}
          members={members}
          canManage={canEditSettings}
          onChange={() => query.refetch()}
        />
      )}
      {tab === "activity" && (
        <ActivityTab workspaceId={workspace.id} />
      )}
    </div>
  );
}

function OverviewTab({
  workspace, memberCount, myRole, canEditSettings, canDelete, onArchive, onDelete,
}: {
  workspace: Workspace;
  memberCount: number;
  myRole: string | null;
  canEditSettings: boolean;
  canDelete: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Details</h3>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between">
            <dt className="text-gray-500">Visibility</dt>
            <dd className="font-medium">
              {workspace.visibility[0].toUpperCase() + workspace.visibility.slice(1)}
            </dd>
          </div>
          {workspace.scope_anchor_kind && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Anchored at</dt>
              <dd className="font-medium font-mono text-xs">
                {workspace.scope_anchor_kind} : {workspace.scope_anchor_id?.slice(0, 8)}…
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-gray-500">Members</dt>
            <dd className="font-medium">{memberCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Created</dt>
            <dd className="font-medium">{new Date(workspace.created_at).toLocaleDateString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Your role</dt>
            <dd className="font-medium">{myRole ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold">Future tabs</h3>
        <ul className="text-sm space-y-1 text-gray-500">
          <li>Templates (form + audit builder)</li>
          <li>Schedules (recurring assignments)</li>
          <li>Submissions (filled-out forms)</li>
          <li>CAPs (corrective action plans)</li>
          <li>Automations (trigger → action rules)</li>
        </ul>
        <p className="text-xs text-gray-500">
          Backend is ready for all of the above; the UI builds out in subsequent slices.
        </p>
      </Card>

      {canEditSettings && (
        <Card className="p-5 space-y-3 md:col-span-2">
          <h3 className="font-semibold flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            Danger zone
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onArchive}>
              {workspace.is_archived ? (
                <><ArchiveRestore className="h-4 w-4 mr-1" /> Unarchive</>
              ) : (
                <><Archive className="h-4 w-4 mr-1" /> Archive</>
              )}
            </Button>
            {canDelete && (
              <Button variant="danger" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete permanently
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {workspace.is_archived
              ? "Archived workspaces are hidden from the default list. Delete is admin-only and irreversible."
              : "Archive to hide from the default list. To delete a workspace, archive it first."}
          </p>
        </Card>
      )}
    </div>
  );
}
