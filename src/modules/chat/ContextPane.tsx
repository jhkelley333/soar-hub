// Chat — desktop right-hand context pane (v1: About / People / Files).
// Reuses the groupInfo + attachments endpoints. The richer WO/PAF context
// (work-order card, activity timeline, inline approve actions) is a
// follow-up layer.

import { useQuery } from "@tanstack/react-query";
import { fetchGroupInfo, fetchAttachments } from "./api";
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

export function ContextPane({ threadId }: { threadId: string }) {
  const infoQ = useQuery({
    queryKey: ["chat", "group-info", threadId],
    queryFn: () => fetchGroupInfo(threadId),
    enabled: !!threadId,
  });
  const filesQ = useQuery({
    queryKey: ["chat", "attachments", threadId],
    queryFn: () => fetchAttachments(threadId),
    enabled: !!threadId,
  });

  const thread = infoQ.data?.thread;
  const members = infoQ.data?.members ?? [];
  const files = filesQ.data?.attachments ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface px-5 py-5">
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-midnight-400">About</p>
        <p className="mt-1 text-[15px] font-semibold text-midnight-900">{thread?.title || "Conversation"}</p>
        {thread?.createdByName ? (
          <p className="text-[12.5px] text-midnight-500">Created by {thread.createdByName}</p>
        ) : null}
        {thread?.description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-midnight-700">{thread.description}</p>
        ) : null}
      </section>

      <section className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
          People{members.length ? ` · ${members.length}` : ""}
        </p>
        <ul className="mt-2 space-y-2.5">
          {members.map((m) => {
            const sub = [ORG_ROLE_LABEL[m.orgRole] || m.orgRole, m.storeNumber]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={m.userId} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-frost-100 text-[11px] font-semibold text-midnight-700">
                  {m.initials}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-midnight-900">{m.name}</span>
                    {m.threadRole !== "member" && (
                      <span className="rounded bg-midnight-900 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">
                        {m.threadRole}
                      </span>
                    )}
                  </span>
                  {sub && <span className="block truncate text-[11.5px] text-midnight-500">{sub}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-midnight-400">
          Files{files.length ? ` · ${files.length}` : ""}
        </p>
        {files.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-midnight-400">No files shared yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {files.map((f) => (
              <AttachmentView
                key={f.id}
                att={{ id: f.id, path: f.path, name: f.name, mime: f.mime, size: f.size }}
                sent={false}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
