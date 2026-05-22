// /reno-scoping — list view. Shows all scopes visible to the caller
// (RLS-filtered), with status filter chips and a search box. "New Scope"
// jumps to /reno-scoping/new.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { cn } from "@/lib/cn";
import { fetchScopes } from "./api";
import {
  BUILDING_TYPE_LABELS,
  COHORT_LABELS,
  STATUS_LABELS,
  type ScopeStatus,
  type RenoScopeRow,
} from "./types";

const STATUS_FILTERS: { key: ScopeStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "needs_revision", label: "Needs Revision" },
  { key: "reviewed", label: "Reviewed" },
  { key: "approved", label: "Approved" },
];

const STATUS_BADGE: Record<ScopeStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  submitted: "info",
  needs_revision: "warning",
  reviewed: "info",
  approved: "success",
};

export function RenoScopingPage() {
  const [statusFilter, setStatusFilter] = useState<ScopeStatus | "all">("all");
  const [search, setSearch] = useState("");

  const scopesQuery = useQuery({
    queryKey: ["reno-scopes"],
    queryFn: fetchScopes,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = scopesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (q) {
        const hay = [row.store?.number, row.store?.name, row.scoper?.full_name, row.scoper?.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopesQuery.data, statusFilter, search]);

  return (
    <>
      <PageHeader
        title="Reno Scoping"
        description="Pre-reskin scopes for the 2026 Full-to-Bright program."
        actions={
          <Link to="/reno-scoping/new">
            <Button size="sm">
              <Plus className="h-4 w-4" strokeWidth={2} />
              New Scope
            </Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              strokeWidth={1.75}
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by store, name, or email"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  statusFilter === f.key
                    ? "bg-midnight text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {scopesQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : scopesQuery.isError ? (
        <EmptyState
          title="Couldn't load scopes"
          description={(scopesQuery.error as Error)?.message ?? "Try again."}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || statusFilter !== "all" ? "No scopes match" : "No scopes yet"}
          description={
            search || statusFilter !== "all"
              ? "Try clearing filters."
              : "Start one from the New Scope button above."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <ScopeRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function ScopeRow({ row }: { row: RenoScopeRow }) {
  return (
    <Link
      to={`/reno-scoping/${row.id}`}
      className="block rounded-lg ring-1 ring-zinc-200 bg-white px-4 py-3 transition hover:ring-zinc-300 hover:bg-zinc-50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-midnight">
              {row.store?.number ?? "—"}
            </span>
            <span className="text-sm text-zinc-700">{row.store?.name}</span>
            {row.store?.state && (
              <span className="text-xs text-zinc-400">· {row.store.state}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>{BUILDING_TYPE_LABELS[row.building_type]}</span>
            {row.cohort && <span>· {COHORT_LABELS[row.cohort]}</span>}
            <span>· {row.scope_date}</span>
            {row.scoper?.full_name && <span>· by {row.scoper.full_name}</span>}
          </div>
        </div>
        <Badge tone={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
      </div>
    </Link>
  );
}
