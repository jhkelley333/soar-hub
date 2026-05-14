// Read-only timeline of activity entries for one ticket. Pulls from
// the new `ticket_activities` table via getTicketActivities. Backend
// already filters by visibility for the caller's tier — admin sees
// everything, store/DO see only 'store' and 'all' rows.
//
// Renders each entry with an icon keyed to event_type, a short
// human description, an actor label, and a relative timestamp.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Edit3,
  MessageSquare,
  Pause,
  RotateCcw,
  Truck,
  XCircle,
} from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { fetchTicketActivities } from "./api";
import type { TicketActivity, TicketStatus } from "./types";
import { statusLabel } from "./types";

interface Props {
  ticketId: string;
}

export function TicketActivityFeed({ ticketId }: Props) {
  const q = useQuery({
    queryKey: ["wo2", "ticket-activities", ticketId],
    queryFn: () => fetchTicketActivities(ticketId),
    staleTime: 15_000,
  });

  const activities = useMemo(() => q.data?.activities ?? [], [q.data]);

  if (q.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
        {(q.error as Error)?.message ?? "Couldn't load activity."}
      </div>
    );
  }
  if (activities.length === 0) {
    return (
      <div className="text-xs text-zinc-500">No activity yet.</div>
    );
  }

  return (
    <ol className="space-y-2">
      {activities.map((a) => (
        <ActivityRow key={a.id} activity={a} />
      ))}
    </ol>
  );
}

function ActivityRow({ activity }: { activity: TicketActivity }) {
  const Icon = iconFor(activity.event_type);
  const tone = toneFor(activity.event_type);
  return (
    <li className="flex items-start gap-2 rounded-md border border-zinc-100 px-2.5 py-2">
      <div className={`mt-0.5 rounded-full p-1 ${tone.bg}`}>
        <Icon className={`h-3 w-3 ${tone.fg}`} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-1.5 text-[11px] text-zinc-500">
          <span className="font-semibold text-midnight">
            {describe(activity)}
          </span>
          <span className="text-zinc-400">·</span>
          <span>{activity.user_name || "system"}</span>
          {activity.user_role && (
            <span className="text-zinc-400">({activity.user_role})</span>
          )}
          <span className="ml-auto text-zinc-400">{relTime(activity.created_at)}</span>
        </div>
        {detailLine(activity) && (
          <div className="mt-0.5 text-xs text-zinc-700">{detailLine(activity)}</div>
        )}
      </div>
    </li>
  );
}

function iconFor(eventType: string) {
  switch (eventType) {
    case "ticket_created":     return Edit3;
    case "status_changed":     return RotateCcw;
    case "pause_state_changed":return Pause;
    case "assigned":           return Truck;
    case "eta_set":
    case "eta_changed":        return Truck;
    case "comment_added":      return MessageSquare;
    case "photo_added":
    case "photo_tagged":       return Camera;
    case "vendor_dispatched":  return Truck;
    case "completed":          return CheckCircle2;
    case "confirmed_by_store": return CheckCircle2;
    case "reopened":           return RotateCcw;
    case "closed":             return CheckCircle2;
    case "cancelled":          return XCircle;
    case "approval_requested":
    case "approval_decided":   return AlertCircle;
    case "migrated":           return Edit3;
    default:                   return Edit3;
  }
}

function toneFor(eventType: string): { bg: string; fg: string } {
  switch (eventType) {
    case "ticket_created":     return { bg: "bg-blue-100",  fg: "text-blue-700" };
    case "status_changed":     return { bg: "bg-amber-100", fg: "text-amber-700" };
    case "pause_state_changed":return { bg: "bg-zinc-200",  fg: "text-zinc-700" };
    case "assigned":
    case "eta_set":
    case "eta_changed":
    case "vendor_dispatched":  return { bg: "bg-indigo-100",fg: "text-indigo-700" };
    case "comment_added":      return { bg: "bg-zinc-100",  fg: "text-zinc-600" };
    case "photo_added":
    case "photo_tagged":       return { bg: "bg-violet-100",fg: "text-violet-700" };
    case "completed":
    case "confirmed_by_store":
    case "closed":             return { bg: "bg-emerald-100",fg: "text-emerald-700" };
    case "reopened":           return { bg: "bg-red-100",   fg: "text-red-700" };
    case "cancelled":          return { bg: "bg-red-100",   fg: "text-red-700" };
    case "approval_requested":
    case "approval_decided":   return { bg: "bg-amber-100", fg: "text-amber-700" };
    case "migrated":           return { bg: "bg-zinc-100",  fg: "text-zinc-500" };
    default:                   return { bg: "bg-zinc-100",  fg: "text-zinc-600" };
  }
}

function describe(a: TicketActivity): string {
  const d = a.event_data as Record<string, unknown>;
  switch (a.event_type) {
    case "ticket_created":
      return "Ticket created";
    case "status_changed":
      return `Status: ${statusLabel(String(d?.from ?? "") as TicketStatus)} → ${statusLabel(String(d?.to ?? "") as TicketStatus)}`;
    case "pause_state_changed":
      return d?.auto_reset
        ? "Pause cleared (auto)"
        : `Pause: ${d?.from || "none"} → ${d?.to || "none"}`;
    case "assigned":
      return d?.vendor_name ? `Vendor assigned: ${d.vendor_name}` : "Vendor assigned";
    case "eta_set":
    case "eta_changed":
      return d?.eta ? `ETA set: ${d.eta}` : "ETA updated";
    case "comment_added":
      return "Comment added";
    case "photo_added":
      return d?.file_name ? `Photo: ${d.file_name}` : "Photo added";
    case "approval_requested":
      return d?.approval_tier ? `Approval requested (${d.approval_tier})` : "Approval requested";
    case "approval_decided":
      return d?.decision ? `Approval ${d.decision}` : "Approval decided";
    case "migrated":
      return d?.migrated_from
        ? `Migrated from legacy "${d.migrated_from}"`
        : "Migrated from legacy data";
    default:
      return a.event_type.replace(/_/g, " ");
  }
}

function detailLine(a: TicketActivity): string | null {
  const d = a.event_data as Record<string, unknown>;
  switch (a.event_type) {
    case "comment_added":
      return d?.text ? String(d.text) : a.notes || null;
    case "status_changed": {
      const reason = d?.reason_code as string | null;
      const text = d?.reason_text as string | null;
      const res = d?.resolution_category as string | null;
      const parts: string[] = [];
      if (reason) parts.push(`reason: ${reason}`);
      if (res) parts.push(`resolution: ${res}`);
      if (text) parts.push(`note: ${text}`);
      return parts.length ? parts.join(" · ") : null;
    }
    case "approval_requested":
      return d?.notes ? String(d.notes) : null;
    case "approval_decided":
      return d?.decision_notes ? String(d.decision_notes) : null;
    default:
      return a.notes || null;
  }
}

function relTime(iso: string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
