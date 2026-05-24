// Chat — "Needs you" compact action card. The card body is a div that
// opens the thread on click; the inline action buttons stopPropagation
// so they run without opening the thread (no nested <button>s).

import { ClipboardList, CircleCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatThread, StatusPillKind } from "../types";

const DOT: Record<StatusPillKind, string> = {
  info: "bg-accent",
  review: "bg-accent",
  warn: "bg-warning",
  ok: "bg-ok",
  neutral: "bg-midnight-400",
};

function StatusPill({ kind, label }: { kind: StatusPillKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-midnight-50 px-2 py-0.5 text-[11px] font-medium text-midnight-600">
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[kind])} />
      {label}
    </span>
  );
}

function Btn({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "outline" | "primary";
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "h-9 flex-1 rounded-lg text-[13px] font-semibold transition",
        variant === "primary"
          ? "bg-midnight-900 text-white hover:bg-midnight-800"
          : "bg-surface text-midnight-700 ring-1 ring-midnight-200 hover:bg-surface-muted",
      )}
    >
      {label}
    </button>
  );
}

export function ActionCard({
  thread,
  onOpen,
  onAction,
}: {
  thread: ChatThread;
  onOpen: () => void;
  onAction: (action: string) => void;
}) {
  const isWO = thread.kind === "workorder";
  const Icon = isWO ? ClipboardList : CircleCheck;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="cursor-pointer rounded-2xl bg-surface p-3.5 shadow-card ring-1 ring-midnight-100 transition hover:ring-midnight-200"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            isWO ? "bg-sonic-50 text-sonic" : "bg-frost-100 text-midnight-700",
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-semibold text-midnight-900">
              {thread.title}
            </span>
            <span className="shrink-0 text-[11px] text-midnight-400">
              {thread.lastMessage.at}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-midnight-500">
            <span className="truncate">{thread.subtitle}</span>
            {thread.status && <StatusPill {...thread.status} />}
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug text-midnight-600">
        {thread.lastMessage.text}
      </p>

      <div className="mt-3 flex gap-2">
        {isWO ? (
          <>
            <Btn label="Open WO" variant="outline" onClick={() => onAction("open-wo")} />
            <Btn label="Reply" variant="primary" onClick={() => onAction("reply")} />
          </>
        ) : (
          <>
            <Btn
              label="Request revision"
              variant="outline"
              onClick={() => onAction("request-revision")}
            />
            <Btn label="Approve" variant="primary" onClick={() => onAction("approve")} />
          </>
        )}
      </div>
    </div>
  );
}
