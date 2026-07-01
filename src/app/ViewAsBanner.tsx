// Persistent banner shown app-wide while an admin's "View As" session is
// active. Always visible (not dismissible without exiting) so it's never
// ambiguous whose data is on screen. Exit clears the client-side header
// immediately and best-effort closes the audit session server-side.
import { useState } from "react";
import { Eye, X } from "lucide-react";
import { useViewAs, setViewAsState } from "@/lib/useViewAs";
import { endViewAs } from "@/lib/adminViewAsApi";
import { ROLE_LABELS, type UserRole } from "@/types/database";

export function ViewAsBanner() {
  const viewAs = useViewAs();
  const [exiting, setExiting] = useState(false);

  if (!viewAs) return null;

  async function exit() {
    setExiting(true);
    const sessionId = viewAs!.sessionId;
    setViewAsState(null); // clear immediately — don't make the admin wait on the network to stop viewing as someone
    try { await endViewAs(sessionId); } catch { /* best-effort; the session row just won't have an ended_at */ }
    setExiting(false);
  }

  const roleLabel = ROLE_LABELS[viewAs.target.role as UserRole] ?? viewAs.target.role;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span className="inline-flex items-center gap-2">
        <Eye className="h-4 w-4" strokeWidth={2} />
        Viewing as <strong>{viewAs.target.name}</strong> ({roleLabel}) — read-only
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="inline-flex items-center gap-1 rounded-md bg-amber-950/10 px-2.5 py-1 text-xs font-semibold hover:bg-amber-950/20 disabled:opacity-60"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
