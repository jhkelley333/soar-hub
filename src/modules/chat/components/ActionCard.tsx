// Chat — "Needs you" compact action card. The card body opens the
// thread; inline action buttons stopPropagation. The WO "Reply" expands
// an inline composer (quick reply without leaving the inbox); the
// submission card keeps decision actions (Request revision / Approve).

import { useState } from "react";
import {
  ClipboardList,
  CircleCheck,
  Paperclip,
  Camera,
  Send,
} from "lucide-react";
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
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !replying && onOpen()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !replying) onOpen();
      }}
      className={cn(
        "rounded-2xl bg-surface p-3.5 shadow-card ring-1 transition",
        replying
          ? "ring-accent"
          : "cursor-pointer ring-midnight-100 hover:ring-midnight-200",
      )}
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

      {replying ? (
        <div className="mt-3" onClick={stop}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Write a quick reply…"
            className="w-full resize-none rounded-xl border border-midnight-200 px-3 py-2 text-[14px] text-midnight-900 placeholder:text-midnight-400 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="text-midnight-400 hover:text-midnight-700" aria-label="Attach file">
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button type="button" className="text-midnight-400 hover:text-midnight-700" aria-label="Add photo">
              <Camera className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => {
                setReplying(false);
                setDraft("");
              }}
              className="ml-auto h-9 rounded-lg px-3 text-[13px] font-medium text-midnight-600 hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                onAction("reply-sent");
                setReplying(false);
                setDraft("");
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-midnight-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" strokeWidth={2} />
              Send
            </button>
          </div>
          <button
            type="button"
            onClick={() => onAction("open-wo")}
            className="mt-2 block w-full text-center text-[12px] font-medium text-accent hover:underline"
          >
            Or open full WO →
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {isWO ? (
            <>
              <Btn label="Open WO" variant="outline" onClick={() => onAction("open-wo")} />
              <Btn
                label="Reply"
                variant="primary"
                onClick={() => setReplying(true)}
              />
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
      )}
    </div>
  );
}
