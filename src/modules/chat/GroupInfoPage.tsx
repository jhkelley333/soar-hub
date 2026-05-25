// Chat — Group Info (/chat/:threadId/info). Group identity, mute, members
// with role badges, and a per-member action sheet (message, promote/demote,
// remove). Managed ("team") groups show their auto-sync note and hide
// member removal / leave, since the roster is rule-driven.

import { useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Bell,
  BellOff,
  RefreshCw,
  MessageSquare,
  Phone,
  UserRound,
  Users,
  Camera,
  Pencil,
  Check,
  X,
  Shield,
  ShieldOff,
  UserMinus,
  LogOut,
} from "lucide-react";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { MemberProfileDrawer } from "@/modules/my-stores/MemberProfileDrawer";
import type { MyStoreTeamMember } from "@/modules/my-stores/types";
import type { UserRole } from "@/types/database";
import {
  fetchGroupInfo,
  fetchAttachments,
  setThreadMute,
  leaveThread,
  setMemberRole,
  removeMember,
  updateGroup,
  uploadGroupAvatar,
  createThread,
  type GroupMember,
} from "./api";
import { AttachmentView } from "./components/group/AttachmentView";

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
  const [profileFor, setProfileFor] = useState<MyStoreTeamMember | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["chat", "group-info", threadId],
    queryFn: () => fetchGroupInfo(threadId),
    enabled: !!threadId,
  });

  const filesQ = useQuery({
    queryKey: ["chat", "attachments", threadId],
    queryFn: () => fetchAttachments(threadId),
    enabled: !!threadId,
  });
  const files = filesQ.data?.attachments ?? [];

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

  const saveMut = useMutation({
    mutationFn: () => updateGroup({ threadId, title: nameDraft.trim(), description: descDraft }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
      toast.push("Group info updated.", "success");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const avatarMut = useMutation({
    mutationFn: async (file: File) => {
      const url = await uploadGroupAvatar(threadId, file);
      await updateGroup({ threadId, avatarUrl: url });
    },
    onSuccess: invalidate,
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't update photo.", "error"),
  });

  const startEdit = () => {
    setNameDraft(q.data?.thread.title ?? "");
    setDescDraft(q.data?.thread.description ?? "");
    setEditing(true);
  };

  const onPickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) avatarMut.mutate(file);
  };

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
        {canManage && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-full px-2 py-1 text-[14px] font-semibold text-accent hover:bg-surface-muted"
          >
            Edit
          </button>
        ) : (
          <span className="w-10" />
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <div className="bg-surface px-5 py-6 text-center">
          {/* Photo */}
          <div className="relative mx-auto h-20 w-20">
            {thread.avatarUrl ? (
              <img
                src={thread.avatarUrl}
                alt={thread.title}
                className="h-20 w-20 rounded-2xl object-cover ring-1 ring-midnight-100"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-frost-100 text-midnight-500">
                <Users className="h-8 w-8" strokeWidth={1.75} />
              </div>
            )}
            {canManage && (
              <>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarMut.isPending}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-midnight-900 text-white ring-2 ring-surface disabled:opacity-50"
                  aria-label="Change group photo"
                >
                  <Camera className="h-4 w-4" strokeWidth={2} />
                </button>
              </>
            )}
          </div>

          {editing ? (
            <div className="mx-auto mt-4 max-w-sm space-y-2 text-left">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Group name"
                className="w-full rounded-lg border border-midnight-200 px-3 py-2 text-[15px] font-semibold text-midnight-900 focus:border-accent focus:outline-none"
              />
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={3}
                placeholder="Description (optional)"
                className="w-full resize-none rounded-lg border border-midnight-200 px-3 py-2 text-[14px] text-midnight-800 focus:border-accent focus:outline-none"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium text-midnight-600 hover:bg-surface-muted"
                >
                  <X className="h-4 w-4" strokeWidth={2} /> Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveMut.mutate()}
                  disabled={!nameDraft.trim() || saveMut.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} /> Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="mt-4 text-[19px] font-semibold text-midnight-900">{thread.title}</h1>
              {thread.createdByName && (
                <p className="mt-1 text-[12.5px] text-midnight-500">Created by {thread.createdByName}</p>
              )}
              {thread.description ? (
                <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-midnight-700">
                  {thread.description}
                </p>
              ) : (
                canManage && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="mx-auto mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Add a description
                  </button>
                )
              )}
              {thread.managed && (
                <div className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-frost-100 px-3 py-1 text-[12px] font-medium text-midnight-700">
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                  Auto-managed team — membership stays in sync
                </div>
              )}
            </>
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

        {/* Files */}
        {files.length > 0 && (
          <div className="mt-3">
            <p className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
              Files · {files.length}
            </p>
            <div className="space-y-2 bg-surface px-5 py-3">
              {files.map((f) => (
                <AttachmentView
                  key={f.id}
                  att={{ id: f.id, path: f.path, name: f.name, mime: f.mime, size: f.size }}
                  sent={false}
                />
              ))}
            </div>
          </div>
        )}

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
          onViewProfile={() => {
            if (sheetFor.profile) setProfileFor(sheetFor.profile);
            setSheetFor(null);
          }}
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

      <MemberProfileDrawer
        open={!!profileFor}
        member={profileFor}
        viewerRole={profile?.role as UserRole | undefined}
        onClose={() => setProfileFor(null)}
      />
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
  onViewProfile,
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
  onViewProfile: () => void;
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
          {!isMe && member.phone && (
            <SheetRow
              Icon={Phone}
              label="Call"
              sub={member.phone}
              onClick={() => {
                window.location.href = `tel:${member.phone}`;
              }}
            />
          )}
          <SheetRow Icon={UserRound} label="View profile" sub="Stores, history, recent submissions" onClick={onViewProfile} />
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
