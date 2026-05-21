// /workspaces — list of workspaces the caller can see. Owner / editor
// / submitter / viewer all land here. Admin sees all workspaces.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Archive, Globe, Lock, MapPin } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { listWorkspaces } from "./api";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import type { Workspace } from "./types";

// Capability mirror: only DO+ can create workspaces (matches the
// GLOBAL_CAPS map in _lib/workspace_permissions.js).
const CAN_CREATE_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

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
    <div className="space-y-6">
      <PageHeader
        title="Workspaces"
        description="Forms, audits, and compliance workflows."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
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
        }
      />

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
          icon={<Plus className="h-8 w-8" />}
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
          <div className="flex items-center gap-2 pt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
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
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {ws.name}
          </h3>
          <Badge variant={ws.is_archived ? "muted" : "neutral"} className="shrink-0">
            <span className="flex items-center gap-1">
              {visibilityIcon(ws.visibility)}
              {visibilityLabel(ws.visibility)}
            </span>
          </Badge>
        </div>
        {ws.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
            {ws.description}
          </p>
        )}
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          Created {new Date(ws.created_at).toLocaleDateString()}
        </div>
      </Card>
    </Link>
  );
}
