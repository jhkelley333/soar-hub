// Renders a single chat attachment — image inline, anything else as a
// downloadable file chip. Signs a short-lived URL on demand; if signing
// fails (e.g. storage RLS), shows a tappable fallback instead of a blank
// box so it's never a silent dead end.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { signChatAttachment, isImageMime } from "../../api";
import type { ChatAttachment } from "../../types";

function prettySize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentView({ att, sent }: { att: ChatAttachment; sent: boolean }) {
  const isImage = isImageMime(att.mime);
  const [imgBroke, setImgBroke] = useState(false);
  const urlQ = useQuery({
    queryKey: ["chat", "att-url", att.id],
    queryFn: () => signChatAttachment(att.path),
    staleTime: 50 * 60_000, // refresh comfortably under the 60-min signed-URL TTL
    retry: 1,
  });
  const url = urlQ.data;

  // Couldn't sign (storage permission / missing object) — or the image
  // itself failed to load. Fall back to a tappable chip.
  if (urlQ.isError || (isImage && imgBroke)) {
    return (
      <button
        type="button"
        onClick={() => urlQ.refetch()}
        className={cn(
          "flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-[13px]",
          sent ? "bg-midnight-800 text-white" : "bg-surface-sunk text-midnight-800",
        )}
      >
        <AlertCircle className="h-5 w-5 shrink-0 opacity-80" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{att.name || "Attachment"}</span>
          <span className={cn("block text-[11px]", sent ? "text-white/60" : "text-midnight-400")}>
            Couldn't load — tap to retry
          </span>
        </span>
      </button>
    );
  }

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        {url ? (
          <img
            src={url}
            alt={att.name}
            loading="lazy"
            onError={() => setImgBroke(true)}
            className="max-h-80 w-auto max-w-full rounded-2xl object-contain ring-1 ring-midnight-100"
          />
        ) : (
          <div className="h-44 w-44 animate-pulse rounded-2xl bg-midnight-100" />
        )}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-[13px]",
        sent ? "bg-midnight-800 text-white" : "bg-surface-sunk text-midnight-800",
      )}
    >
      <FileText className="h-6 w-6 shrink-0 opacity-80" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{att.name}</span>
        {att.size > 0 && (
          <span className={cn("block text-[11px]", sent ? "text-white/60" : "text-midnight-400")}>
            {prettySize(att.size)}
          </span>
        )}
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
    </a>
  );
}
