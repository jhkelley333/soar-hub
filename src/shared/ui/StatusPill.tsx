// Small inline pill that surfaces lifecycle state next to a header, a row,
// or any other anchor. Each `kind` chooses a (bg, text, dot) palette;
// `saving` adds an animate-pulse on the dot. Translated 1:1 from the
// Claude Design import — the kinds map to the SOAR object-state vocab
// (draft → submitted → reviewed → approved + a small error / pending lane).

import { cn } from "@/lib/cn";

export type StatusPillKind =
  | "saving"
  | "saved"
  | "synced"
  | "error"
  | "submitted"
  | "approved"
  | "pending"
  | "stage"
  | "revision";

interface PaletteEntry {
  bg: string;
  text: string;
  dot: string;
}

const PALETTES: Record<StatusPillKind, PaletteEntry> = {
  saving:    { bg: "bg-frost-100",   text: "text-midnight-600", dot: "bg-accent-500 animate-pulse" },
  saved:     { bg: "bg-frost-100",   text: "text-midnight-700", dot: "bg-ok" },
  synced:    { bg: "bg-frost-100",   text: "text-midnight-700", dot: "bg-ok" },
  error:     { bg: "bg-sonic-50",    text: "text-sonic-700",    dot: "bg-sonic" },
  submitted: { bg: "bg-accent-100",  text: "text-accent-700",   dot: "bg-accent-600" },
  approved:  { bg: "bg-frost-100",   text: "text-midnight-700", dot: "bg-ok" },
  pending:   { bg: "bg-midnight-50", text: "text-midnight-600", dot: "bg-midnight-300" },
  stage:     { bg: "bg-accent-100",  text: "text-accent-700",   dot: "bg-ok" },
  revision:  { bg: "bg-zinc-100",    text: "text-zinc-700",     dot: "bg-warn" },
};

export function StatusPill({
  kind = "saved",
  children,
  className,
}: {
  kind?: StatusPillKind;
  children: React.ReactNode;
  className?: string;
}) {
  const p = PALETTES[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        p.bg,
        p.text,
        className,
      )}
    >
      <span className={cn("dot", p.dot)} />
      {children}
    </span>
  );
}
