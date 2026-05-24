// Opens (or creates) the chat thread tied to a work order / PAF and
// navigates into it. Drop this into any WO or PAF detail view.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { openScopedThread, type ScopeKind } from "./api";

export function DiscussButton({
  scopeKind,
  scopeRef,
  label = "Discuss in Chat",
  className,
}: {
  scopeKind: ScopeKind;
  scopeRef: string;
  label?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { threadId } = await openScopedThread(scopeKind, scopeRef);
      navigate(`/chat/${threadId}`);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't open chat.", "error");
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-midnight-200 px-3 py-1.5 text-[13px] font-semibold text-midnight-700 hover:bg-surface-muted disabled:opacity-50"
      }
    >
      <MessageSquare className="h-4 w-4" strokeWidth={2} />
      {busy ? "Opening…" : label}
    </button>
  );
}
