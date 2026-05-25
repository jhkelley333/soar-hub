// Chat — Group Info (/chat/:threadId/info). Group identity, mute, members
// with role badges, and a per-member action sheet (message, promote/demote,
// remove). Managed ("team") groups show their auto-sync note and hide
// member removal / leave, since the roster is rule-driven.

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Bell,
  BellOff,
  RefreshCw,
  MessageSquare,
  Shield,
  ShieldOff,
  UserMinus,
  LogOut,
} from "lucide-react";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchGroupInfo,
  setThreadMute,
  leaveThread,
  setMemberRole,
  removeMember,
  createThread,
  type GroupMember,
} from "./api";

const ORG_ROLE_LABEL: Record<string, string> = {
  shift_manager: "Shift Mgr",
  gm: "GM",
  do: "DO",
  sdo: "SDO",
  rvp: "RVP",
  vp: "VP",
  coo: "COO",
  admin: "Admin",
  payroll: "Payroll",
};

export function GroupInfoPage() {
  const { threadId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const meId = profile?.id ?? "";

  const [sheetFor, setSheetFor] = useState<GroupMember | null>(null);

  const q = useQuery({
    queryKey: ["chat", "group-info", threadId],
    queryFn: () => fetchGroupInfo(threadId),
    enabled: !!threadId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["chat", "group-info", threadId] });
    qc.invalidateQueries({ queryKey: ["chat", "thread", threadId] });
    qc.invalidateQueries({ queryKey: ["chat", "inbox"] });
  };

  const muteMut = useMutation({
    mutationFn: (muted: boolean) => setThreadMute(threadId, muted),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't update mute.", "error"),
  });

  const leaveMut = useMutation({
    mutationFn: () => leaveThread(threadId),
    onSuccess: () => {
      invalidate();
      toast.push("You left the group.", "info");
      navigate("/chat");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't leave.", "error"),
  });

  const roleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
      setMemberRole(threadId, userId, role),
    onSuccess: () => {
      invalidate();
      setSheetFor(null);
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't update role.", "error"),
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeMember(threadId, userId),
    onSuccess: () => {
      invalidate();
      setSheetFor(null);
      toast.push("Removed from group.", "info");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't remove member.", "error"),
  });

  const dmMut = useMutation({
    mutationFn: (userId: string) => createThread({ kind: "direct", participantUserIds: [userId] }),
    onSuccess: ({ threadId: tid }) => {
      setSheetFor(null);
      navigate(`/chat/${tid}`);
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't open chat.", "error"),
  });

  if (q.isLoading) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-muted text-sm text-midnight-500">
        Loading…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <EmptyState
          title="Couldn't open group info"
          description={(q.error as Error)?.message ?? "You may not have access."}
          action={
            <button
              type="button"
              onClick={() => navigate(`/chat/${threadId}`)}
              className="rounded-lg bg-midnight-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Back
            </button>
          }
        />
      </div>
    );
  }

  const { thread, members, adminsCount } = q.data;
  const canManage = thread.myRole === "owner" || thread.myRole === "admin";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-muted">
      <div aria-hidden className="shrink-0 bg-midnight" style={{ height: "env(safe-area-inset-top, 0px)" }} />

      <header className="flex shrink-0 items-center gap-1 border-b border-midnight-100 bg-surface px-2 py-2">
        <button
          type="button"
          onClick={() => navigate(`/chat/${threadId}`)}
          className="rounded-full p-1.5 text-midnight-600 hover:bg-surface-muted"
          aria-label="Back to thread"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <p className="flex-1 text-center text-[15px] font-semibold text-midnight-900">Group info</p>
        <span className="w-8" />
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <div className="bg-surface px-5 py-6 text-center">
          <h1 className="text-[19px] font-semibold text-midnight-900">{thread.title}</h1>
          {thread.createdByName && (
            <p className="mt-1 text-[12.5px] text-midnight-500">Created by {thread.createdByName}</p>
          )}
          {thread.description && (
            <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-midnight-700">
              {thread.description}
            </p>
          )}
          {thread.managed && (
            <div className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-frost-100 px-3 py-1 text-[12px] font-medium text-midnight-700">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              Auto-managed team — membership stays in sync
            </div>
          )}
        </div>

        {/* Mute */}
        <div className="mt-3 bg-surface">
          <button
            type="button"
            onClick={() => muteMut.mutate(!thread.muted)}
            disabled={muteMut.isPending}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left disabled:opacity-50"
          >
            {thread.muted ? (
              <BellOff className="h-5 w-5 text-midnight-500" strokeWidth={2} />
            ) : (
              <Bell className="h-5 w-5 text-midnight-500" strokeWidth={2} />
            )}
            <span className="flex-1 text-[14.5px] text-midnight-900">Mute notifications</span>
            <span className={cn("text-[13px] font-medium", thread.muted ? "text-accent" : "text-midnight-400")}>
              {thread.muted ? "On" : "Off"}
            </span>
          </button>
        </div>

        {/* Members */}
        <div className="mt-3">
          <div className="flex items-center justify-between px-5 pb-1 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
              Members · {members.length}
            </p>
            {adminsCount > 0 && (
              <p className="text-[11px] text-midnight-400">{adminsCount} admins</p>
            )}
          </div>
          <ul className="bg-surface">
            {members.map((m) => {
              const isMe = m.userId === meId;
              const sub = [ORG_ROLE_LABEL[m.orgRole] || m.orgRole, m.storeNumber]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={m.userId} className="border-b border-midnight-50 last:border-0">
                  <button
                    type="button"
                    onClick={() => setSheetFor(m)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-muted"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-frost-100 text-[13px] font-semibold text-midnight-700">
                      {m.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-medium text-midnight-900">
                          {m.name}{isMe && " · You"}
                        </span>
                        {m.threadRole !== "member" && (
                          <span className="rounded bg-midnight-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                            {m.threadRole}
                          </span>
                        )}
                      </span>
                      {sub && <span className="block truncate text-[12px] text-midnight-500">{sub}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Leave — non-managed only */}
        {!thread.managed && (
          <div className="mt-3 bg-surface">
            <button
              type="button"
              onClick={() => leaveMut.mutate()}
              disabled={leaveMut.isPending}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left text-red-600 disabled:opacity-50"
            >
              <LogOut className="h-5 w-5" strokeWidth={2} />
              <span className="text-[14.5px] font-medium">Leave group</span>
            </button>
          </div>
        )}

        <div className="h-10" />
      </div>

      {sheetFor && (
        <MemberSheet
          member={sheetFor}
          canManage={canManage}
          managed={thread.managed}
          isMe={sheetFor.userId === meId}
          onClose={() => setSheetFor(null)}
          onMessage={() => dmMut.mutate(sheetFor.userId)}
          onToggleAdmin={() =>
            roleMut.mutate({
              userId: sheetFor.userId,
              role: sheetFor.threadRole === "admin" ? "member" : "admin",
            })
          }
          onRemove={() => removeMut.mutate(sheetFor.userId)}
          busy={dmMut.isPending || roleMut.isPending || removeMut.isPending}
        />
      )}
    </div>
  );
}

function MemberSheet({
  member,
  canManage,
  managed,
  isMe,
  onClose,
  onMessage,
  onToggleAdmin,
  onRemove,
  busy,
}: {
  member: GroupMember;
  canManage: boolean;
  managed: boolean;
  isMe: boolean;
  onClose: () => void;
  onMessage: () => void;
  onToggleAdmin: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const isOwner = member.threadRole === "owner";
  const showAdminControls = canManage && !isOwner && !isMe;
  const sub = [ORG_ROLE_LABEL[member.orgRole] || member.orgRole, member.storeNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-midnight-900/40" onClick={onClose} aria-hidden />
      <div
        className="relative rounded-t-2xl bg-surface pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2"
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-midnight-200" />

        <div className="flex items-center gap-3 px-5 py-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-frost-100 text-[15px] font-semibold text-midnight-700">
            {member.initials}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[16px] font-semibold text-midnight-900">{member.name}</p>
              {member.threadRole !== "member" && (
                <span className="rounded bg-midnight-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                  {member.threadRole}
                </span>
              )}
            </div>
            {sub && <p className="text-[12.5px] text-midnight-500">{sub}</p>}
          </div>
        </div>

        <div className="border-t border-midnight-100">
          {!isMe && (
            <SheetRow Icon={MessageSquare} label="Message directly" sub="Opens 1:1 thread" onClick={onMessage} disabled={busy} />
          )}
          {showAdminControls && (
            <SheetRow
              Icon={member.threadRole === "admin" ? ShieldOff : Shield}
              label={member.threadRole === "admin" ? "Remove as admin" : "Make admin"}
              sub={member.threadRole === "admin" ? "Becomes a regular member" : "Can manage members"}
              onClick={onToggleAdmin}
              disabled={busy}
            />
          )}
          {showAdminControls && !managed && (
            <SheetRow
              Icon={UserMinus}
              label="Remove from group"
              sub="They lose access to history"
              danger
              onClick={onRemove}
              disabled={busy}
            />
          )}
        </div>

        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-full rounded-xl bg-surface-sunk text-[15px] font-semibold text-midnight-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SheetRow({
  Icon,
  label,
  sub,
  onClick,
  danger,
  disabled,
}: {
  Icon: typeof MessageSquare;
  label: string;
  sub?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-muted disabled:opacity-50"
    >
      <Icon className={cn("h-5 w-5", danger ? "text-red-600" : "text-midnight-500")} strokeWidth={2} />
      <span className="min-w-0">
        <span className={cn("block text-[14.5px] font-medium", danger ? "text-red-600" : "text-midnight-900")}>
          {label}
        </span>
        {sub && <span className="block text-[12px] text-midnight-500">{sub}</span>}
      </span>
    </button>
  );
}
