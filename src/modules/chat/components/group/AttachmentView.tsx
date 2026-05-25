// Renders a single chat attachment — image inline, anything else as a
// downloadable file chip. Signs a short-lived URL on demand.

import { useQuery } from "@tanstack/react-query";
import { FileText, Download } from "lucide-react";
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
  const urlQ = useQuery({
    queryKey: ["chat", "att-url", att.id],
    queryFn: () => signChatAttachment(att.path),
    staleTime: 50 * 60_000, // refresh comfortably under the 60-min signed-URL TTL
  });
  const url = urlQ.data;

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        {url ? (
          <img
            src={url}
            alt={att.name}
            loading="lazy"
            className="max-h-64 w-auto max-w-full rounded-2xl object-cover ring-1 ring-midnight-100"
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
