// Members tab on /workspaces/:id. Shows roster, lets owners +
// admins promote/demote/remove and add new members by user-id.
// (A proper user picker by name/email is a follow-up — for now we
// paste a UUID, same as the WO2 vendor admin flow.)

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UserPlus, X, ShieldCheck } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { addMember, updateMember, removeMember } from "./api";
import type { WorkspaceMember, WorkspaceRole } from "./types";

const ROLES: Array<{ value: WorkspaceRole; label: string; hint: string }> = [
  { value: "owner",     label: "Owner",     hint: "Full control: settings, members, templates, automations." },
  { value: "editor",    label: "Editor",    hint: "Create/edit templates + schedules. No member management." },
  { value: "submitter", label: "Submitter", hint: "Fill out assignments only." },
  { value: "viewer",    label: "Viewer",    hint: "Read-only access to the workspace." },
];

function roleBadgeTone(role: string): "neutral" | "info" {
  if (role === "owner") return "info";
  return "neutral";
}

export function MembersTab({
  workspaceId, members, canManage, onChange,
}: {
  workspaceId: string;
  members: WorkspaceMember[];
  canManage: boolean;
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Members ({members.length})</h3>
        {canManage && (
          <Button onClick={() => setShowAdd((v) => !v)} variant={showAdd ? "secondary" : "primary"}>
            {showAdd ? "Cancel" : (<><UserPlus className="h-4 w-4 mr-1" /> Add member</>)}
          </Button>
        )}
      </div>

      {showAdd && canManage && (
        <AddMemberForm
          workspaceId={workspaceId}
          onAdded={() => { setShowAdd(false); onChange(); }}
        />
      )}

      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {members.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No members yet.
            </div>
          )}
          {members.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              canManage={canManage}
              onChange={onChange}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function MemberRow({
  member, canManage, onChange,
}: {
  member: WorkspaceMember;
  canManage: boolean;
  onChange: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateMut = useMutation({
    mutationFn: (newRole: WorkspaceRole) =>
      updateMember({
        workspace_id: member.workspace_id,
        user_id: member.user_id,
        workspace_role: newRole,
      }),
    onSuccess: () => { setError(null); setUpdating(false); onChange(); },
    onError: (e) => { setError((e as Error)?.message ?? "Failed."); setUpdating(false); },
  });

  const removeMut = useMutation({
    mutationFn: () =>
      removeMember({ workspace_id: member.workspace_id, user_id: member.user_id }),
    onSuccess: () => { setError(null); onChange(); },
    onError: (e) => setError((e as Error)?.message ?? "Failed."),
  });

  const displayName = member.profiles?.full_name || member.profiles?.email || member.user_id;

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{displayName}</span>
          {member.workspace_role === "owner" && (
            <ShieldCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {member.profiles?.email} • org role: {member.profiles?.role ?? "—"}
        </div>
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canManage ? (
          <>
            <select
              value={member.workspace_role}
              disabled={updating}
              onChange={(e) => {
                setUpdating(true);
                updateMut.mutate(e.target.value as WorkspaceRole);
              }}
              className="text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (confirm(`Remove ${displayName} from this workspace?`)) {
                  removeMut.mutate();
                }
              }}
              disabled={removeMut.isPending}
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 disabled:opacity-50"
              title="Remove from workspace"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <Badge tone={roleBadgeTone(member.workspace_role)}>
            {member.workspace_role}
          </Badge>
        )}
      </div>
    </div>
  );
}

function AddMemberForm({
  workspaceId, onAdded,
}: {
  workspaceId: string;
  onAdded: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("submitter");
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      addMember({ workspace_id: workspaceId, user_id: userId.trim(), workspace_role: role }),
    onSuccess: () => { setUserId(""); setError(null); onAdded(); },
    onError: (e) => setError((e as Error)?.message ?? "Failed."),
  });

  return (
    <Card className="p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (userId.trim()) mut.mutate();
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 md:grid-cols-[1fr,180px,auto]">
          <div>
            <Label htmlFor="member-uid">User ID (uuid)</Label>
            <Input
              id="member-uid"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              required
            />
          </div>
          <div>
            <Label htmlFor="member-role">Role</Label>
            <select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              className="w-full text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={mut.isPending || !userId.trim()}>
              {mut.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {ROLES.find((r) => r.value === role)?.hint}
        </p>
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
            {error}
          </div>
        )}
      </form>
    </Card>
  );
}
