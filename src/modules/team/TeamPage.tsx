import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/cn";
import { listTeam, type ManagedUser } from "./api";

type RoleFilter = "all" | UserRole;

export function TeamPage() {
  const query = useQuery({
    queryKey: ["my-team"],
    queryFn: listTeam,
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [includeInactive, setIncludeInactive] = useState(false);

  const allMembers = query.data?.members ?? [];

  const filtered = useMemo(() => {
    let list = allMembers;
    if (!includeInactive) list = list.filter((m) => m.is_active);
    if (roleFilter !== "all") list = list.filter((m) => m.role === roleFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        [m.full_name, m.email, m.phone, ...m.scopes.map((s) => s.label)]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [allMembers, search, roleFilter, includeInactive]);

  // Roles present in the result set, for the filter dropdown.
  const rolesPresent = useMemo(() => {
    const set = new Set<UserRole>();
    for (const m of allMembers) set.add(m.role);
    return Array.from(set).sort((a, b) =>
      (ROLE_LABELS[a] ?? a).localeCompare(ROLE_LABELS[b] ?? b)
    );
  }, [allMembers]);

  if (query.isLoading) {
    return (
      <>
        <PageHeader
          title="My Team"
          description="People you manage and how to reach them."
        />
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeader title="My Team" />
        <EmptyState
          title="Couldn't load your team"
          description={
            (query.error as Error)?.message ?? "Try again in a moment."
          }
        />
      </>
    );
  }

  const data = query.data!;
  const role = data.user.role;
  const isHourly = role === "shift_manager";
  const isPayroll = role === "payroll";

  // Hourly Manager / Payroll have no manageable users — show a graceful
  // explanation instead of an empty list with confusing filters.
  if (isHourly || isPayroll) {
    return (
      <>
        <PageHeader
          title="My Team"
          description="People you manage and how to reach them."
        />
        <EmptyState
          title="My Team is for managers"
          description={
            isHourly
              ? "Shift Managers don't manage other users in this app. Contact your GM to make changes."
              : "Payroll roles don't manage team membership."
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My Team"
        description={`${data.members.filter((m) => m.is_active).length} active ${data.members.filter((m) => m.is_active).length === 1 ? "person" : "people"} in your scope.`}
        actions={
          <Button variant="primary" disabled title="Coming next commit">
            + Add user
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-3">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="all">All roles</option>
          {rolesPresent.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>

        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            strokeWidth={1.75}
          />
          <input
            type="search"
            placeholder="Search name, email, phone, store…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border-0 bg-white pl-9 pr-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            allMembers.length === 0 ? "No team members yet" : "No matches"
          }
          description={
            allMembers.length === 0
              ? "Once people are added to your scope they'll appear here."
              : "Adjust the filters or clear the search to see everyone."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MemberCard key={m.id} member={m} />
          ))}
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Member card
// ----------------------------------------------------------------------------

function MemberCard({ member }: { member: ManagedUser }) {
  return (
    <Card
      className={cn(
        "px-4 py-3 sm:px-5 sm:py-4",
        !member.is_active && "opacity-60"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-midnight sm:text-base">
              {member.full_name?.trim() || member.email}
            </span>
            <Badge tone={roleTone(member.role)}>
              {ROLE_LABELS[member.role] ?? member.role}
            </Badge>
            {!member.is_active && <Badge tone="neutral">Inactive</Badge>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            {member.email && (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span className="truncate">{member.email}</span>
              </a>
            )}
            {member.phone && (
              <a
                href={`tel:${member.phone}`}
                className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
              >
                <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{formatPhoneForDisplay(member.phone)}</span>
              </a>
            )}
          </div>

          {member.scopes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {member.scopes.map((s, i) => (
                <span
                  key={`${s.scope_type}-${s.scope_id ?? i}`}
                  className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                >
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" disabled title="Coming next commit">
            Manage
          </Button>
        </div>
      </div>
    </Card>
  );
}

function roleTone(
  role: UserRole
): "neutral" | "info" | "warning" | "success" | "danger" {
  switch (role) {
    case "admin":
      return "danger";
    case "coo":
    case "vp":
      return "warning";
    case "rvp":
    case "sdo":
    case "do":
      return "info";
    case "gm":
      return "success";
    case "shift_manager":
    case "payroll":
    default:
      return "neutral";
  }
}
