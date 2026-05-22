// Activity log viewer. Owner / admin only (backend enforces). Shows
// the most recent 50 events; "Load more" pages with the
// before=ISO cursor.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { getActivity } from "./api";
import type { ActivityLogEntry } from "./types";

// Tiny category map for visual grouping in the UI. Doesn't need to
// stay in sync with every action — the activity log will accumulate
// new actions over time and unknown prefixes just render plain.
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

export function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);

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
      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {entries.map((e) => <ActivityRow key={e.id} entry={e} />)}
        </div>
      </Card>
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore}>Load older</Button>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const category = entry.target_kind || "gray";
  const color = CATEGORY[category] ?? "gray";

  const colorClass =
    color === "blue"   ? "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-300" :
    color === "green"  ? "bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-300" :
    color === "amber"  ? "bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-300" :
    color === "red"    ? "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-300" :
    color === "purple" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" :
                         "bg-gray-100   text-gray-700   dark:bg-gray-800     dark:text-gray-300";

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className={`text-[10px] uppercase font-medium px-1.5 py-0.5 rounded ${colorClass} shrink-0`}>
        {entry.target_kind}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {entry.action}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {entry.actor_email ?? "—"} • {new Date(entry.created_at).toLocaleString()}
        </div>
        {entry.event_data && Object.keys(entry.event_data).length > 0 && (
          <details className="mt-1">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Details
            </summary>
            <pre className="mt-1 text-[11px] bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto">
              {JSON.stringify(entry.event_data, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
