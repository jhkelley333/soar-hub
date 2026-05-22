// Activity log viewer. Owner / admin only (backend enforces). Shows
// the most recent 50 events; "Load more" pages with the
// before=ISO cursor. Filter chips narrow the feed by event category,
// and target-kind rows deep-link to the relevant detail page where
// one exists.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { getActivity } from "./api";
import type { ActivityLogEntry } from "./types";

const CATEGORY: Record<string, "blue" | "green" | "amber" | "red" | "purple" | "gray"> = {
  workspace: "blue",
  member: "blue",
  template: "purple",
  template_version: "purple",
  schedule: "amber",
  assignment: "amber",
  submission: "green",
  signoff: "green",
  attachment: "gray",
  cap: "red",
  cap_proof: "red",
  repeat_finding: "red",
  automation: "purple",
};

type FilterKey = "all" | "submissions" | "caps" | "templates" | "automations" | "ops";

const FILTERS: Array<{ key: FilterKey; label: string; targets?: string[] }> = [
  { key: "all",         label: "All" },
  { key: "submissions", label: "Submissions & sign-offs", targets: ["submission", "signoff"] },
  { key: "caps",        label: "CAPs & findings",         targets: ["cap", "cap_proof", "repeat_finding"] },
  { key: "templates",   label: "Templates",                targets: ["template", "template_version"] },
  { key: "automations", label: "Automations",              targets: ["automation"] },
  { key: "ops",         label: "Members, schedules, etc.", targets: ["workspace", "member", "schedule", "assignment", "attachment"] },
];

function targetHref(workspaceId: string, kind: string | null, id: string | null): string | null {
  if (!kind || !id) return null;
  switch (kind) {
    case "submission": return `/submissions/${id}`;
    case "signoff":    return `/submissions/${id}`;
    case "cap":        return `/caps/${id}`;
    case "assignment": return `/assignments/${id}`;
    case "template":   return `/workspaces/${workspaceId}/templates/${id}`;
    default:           return null;
  }
}

function prettyAction(action: string): string {
  const last = action.split(".").pop() ?? action;
  const spaced = last.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");

  const query = useQuery({
    queryKey: ["workspace-activity", workspaceId],
    queryFn: async () => {
      const res = await getActivity({ workspace_id: workspaceId, limit: 50 });
      setEntries(res.entries);
      setHasMore(res.entries.length === 50);
      return res;
    },
    refetchOnMount: "always",
  });

  async function loadMore() {
    if (!entries.length) return;
    const before = entries[entries.length - 1].created_at;
    const res = await getActivity({ workspace_id: workspaceId, limit: 50, before });
    setEntries((prev) => [...prev, ...res.entries]);
    setHasMore(res.entries.length === 50);
  }

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    const allowed = new Set(FILTERS.find((f) => f.key === filter)?.targets ?? []);
    return entries.filter((e) => e.target_kind && allowed.has(e.target_kind));
  }, [entries, filter]);

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-6 text-red-600">
        Failed to load activity: {(query.error as Error)?.message ?? "Unknown"}
      </Card>
    );
  }

  if (!entries.length) {
    return (
      <EmptyState
        title={<><Activity className="h-6 w-6 inline mr-2" /> No activity yet</>}
        description="Events from members, templates, submissions, and more will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={
              "px-3 py-1.5 text-sm rounded-full border transition " +
              (filter === opt.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gray-500">
          No events match this filter (in the rows loaded so far).
          {hasMore && " Click 'Load older' to page further back."}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-gray-200">
            {filtered.map((e) => (
              <ActivityRow key={e.id} entry={e} workspaceId={workspaceId} />
            ))}
          </div>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore}>Load older</Button>
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  entry, workspaceId,
}: {
  entry: ActivityLogEntry;
  workspaceId: string;
}) {
  const category = entry.target_kind || "gray";
  const color = CATEGORY[category] ?? "gray";

  const colorClass =
    color === "blue"   ? "bg-blue-100   text-blue-700    " :
    color === "green"  ? "bg-green-100  text-green-700  " :
    color === "amber"  ? "bg-amber-100  text-amber-700  " :
    color === "red"    ? "bg-red-100    text-red-700      " :
    color === "purple" ? "bg-purple-100 text-purple-700" :
                         "bg-gray-100   text-gray-700      ";

  const href = targetHref(workspaceId, entry.target_kind, entry.target_id);

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className={`text-[10px] uppercase font-medium px-1.5 py-0.5 rounded ${colorClass} shrink-0`}>
        {entry.target_kind}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
          {prettyAction(entry.action)}
          {href && (
            <Link
              to={href}
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 text-xs"
              title="Open target"
            >
              <ExternalLink className="h-3 w-3" />
              <span>open</span>
            </Link>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {entry.actor_email ?? "—"} • {new Date(entry.created_at).toLocaleString()}
        </div>
        {entry.event_data && Object.keys(entry.event_data).length > 0 && (
          <details className="mt-1">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Details
            </summary>
            <pre className="mt-1 text-[11px] bg-gray-50 p-2 rounded overflow-x-auto">
              {JSON.stringify(entry.event_data, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
