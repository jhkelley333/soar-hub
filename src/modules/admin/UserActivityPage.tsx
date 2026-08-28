// /admin/user-activity — who's been active, for admin / coo / vp.
// Two views: a per-user presence table (last seen from the heartbeat + last
// login from Supabase auth) and a unified recent-activity feed pulled from the
// existing per-feature audit logs. Read-only; auto-refreshes.

import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchUserActivity, fetchActivityFeed, type UserActivityRow, type ActivityFeedRow } from "./userActivityApi";

const ONLINE_MS = 5 * 60 * 1000;
const AWAY_MS = 30 * 60 * 1000;

function presence(lastSeen: string | null): { label: string; tone: string; dot: string } {
  if (!lastSeen) return { label: "Offline", tone: "text-zinc-400", dot: "bg-zinc-300" };
  const age = Date.now() - new Date(lastSeen).getTime();
  if (age <= ONLINE_MS) return { label: "Online", tone: "text-emerald-700", dot: "bg-emerald-500" };
  if (age <= AWAY_MS) return { label: "Away", tone: "text-amber-700", dot: "bg-amber-400" };
  return { label: "Offline", tone: "text-zinc-400", dot: "bg-zinc-300" };
}

function relTime(s: string | null): string {
  if (!s) return "Never";
  const diff = Date.now() - new Date(s).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const roleLabel = (r: string | null) => (r ? r.replace(/_/g, " ").toUpperCase() : "—");

export function UserActivityPage() {
  const [q, setQ] = useState("");

  const usersQ = useQuery({
    queryKey: ["user-activity-list"],
    queryFn: fetchUserActivity,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const feedQ = useQuery({
    queryKey: ["user-activity-feed"],
    queryFn: () => fetchActivityFeed(60),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const feed = feedQ.data?.feed ?? [];

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return users;
    return users.filter((u) =>
      u.name.toLowerCase().includes(t) ||
      (u.email || "").toLowerCase().includes(t) ||
      (u.role || "").toLowerCase().includes(t));
  }, [users, q]);

  const onlineCount = users.filter((u) => presence(u.last_seen_at).label === "Online").length;
  const refreshing = usersQ.isFetching || feedQ.isFetching;

  return (
    <>
      <PageHeader
        title="User activity"
        description="Who's been active recently — live presence, last login, and a feed of recent actions across the app."
        actions={
          <button onClick={() => { usersQ.refetch(); feedQ.refetch(); }} disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
          </button>
        }
      />

      {/* People + presence */}
      {usersQ.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : usersQ.isError ? (
        <EmptyState title="Couldn't load user activity" description={(usersQ.error as Error)?.message ?? "Try again."} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
              <div className="text-[11px] text-zinc-400">
                {users.length} active users · <span className="text-emerald-600">{onlineCount} online now</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role"
                  className="w-56 rounded-md bg-zinc-50 py-1.5 pl-7 pr-2 text-xs text-zinc-700 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-accent-400" />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">No users match “{q}”.</div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {filtered.map((u) => <UserRow key={u.id} u={u} />)}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Recent activity feed */}
      <div className="mt-8">
        <div className="mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-midnight dark:text-night-ink">Recent activity</h2>
          <span className="text-[11px] text-zinc-400">actions across PAF, Cash, Workspaces, Employee Actions, and admin View-As</span>
        </div>
        {feedQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : feedQ.isError ? (
          <EmptyState title="Couldn't load the activity feed" description={(feedQ.error as Error)?.message ?? "Try again."} />
        ) : feed.length === 0 ? (
          <EmptyState title="No recent activity" description="Actions logged across the app will appear here." />
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="divide-y divide-zinc-100">
                {feed.map((f, i) => <FeedRow key={i} f={f} />)}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}

function UserRow({ u }: { u: UserActivityRow }) {
  const p = presence(u.last_seen_at);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", p.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-midnight dark:text-night-ink">{u.name}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-500">{roleLabel(u.role)}</span>
        </div>
        {u.email && <div className="truncate text-[11px] text-zinc-400">{u.email}</div>}
      </div>
      <div className="w-24 shrink-0 text-right">
        <div className={cn("text-xs font-medium", p.tone)}>{p.label}</div>
        <div className="text-[10px] text-zinc-400">seen {relTime(u.last_seen_at)}</div>
      </div>
      <div className="w-28 shrink-0 text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-300">Last login</div>
        <div className="text-xs text-zinc-500">{relTime(u.last_sign_in_at)}</div>
      </div>
    </div>
  );
}

const SOURCE_TONE: Record<string, string> = {
  PAF: "bg-accent-100 text-accent-700",
  Cash: "bg-emerald-50 text-emerald-700",
  Workspaces: "bg-sky-50 text-sky-700",
  "Employee Actions": "bg-violet-50 text-violet-700",
  "View As": "bg-amber-50 text-amber-700",
};

function FeedRow({ f }: { f: ActivityFeedRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
      <span className="w-24 shrink-0 text-zinc-400">{relTime(f.at)}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SOURCE_TONE[f.source] ?? "bg-zinc-100 text-zinc-600")}>{f.source}</span>
      <span className="font-medium text-midnight dark:text-night-ink">{f.actor}</span>
      <span className="text-zinc-500">{f.action}</span>
    </div>
  );
}
