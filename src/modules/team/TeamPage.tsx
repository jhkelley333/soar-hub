import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Mail, Phone, Search, Copy, GraduationCap, Eye } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS, isHourlyStoreRole, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import { cn } from "@/lib/cn";
import { downloadCSV, toCSV } from "@/lib/csv";
import { startViewAs } from "@/lib/adminViewAsApi";
import { setViewAsState } from "@/lib/useViewAs";
import { defaultLandingPath } from "@/app/nav";
import { listTeam, type ManagedUser, type TrainingSummary } from "./api";
import { AddUserModal } from "./AddUserModal";
import { EditMemberModal } from "./EditMemberModal";

type RoleFilter = "all" | UserRole;

export function TeamPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["my-team"],
    queryFn: listTeam,
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [startingViewAs, setStartingViewAs] = useState<string | null>(null);

  const allMembers = query.data?.members ?? [];

  // Admin-only, read-only "View As" — see src/lib/viewAs.ts. Lands on the
  // target's own default page (same rule useEffectiveRole/nav.ts use for
  // the rest of the shell), not a fixed page — a payroll target lands on
  // their PAF queue, everyone else on the dashboard.
  async function viewAs(member: ManagedUser) {
    setStartingViewAs(member.id);
    try {
      const res = await startViewAs(member.id);
      setViewAsState({ sessionId: res.session_id, target: res.target });
      navigate(defaultLandingPath(res.target.role as UserRole));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't start View As.", "error");
    } finally {
      setStartingViewAs(null);
    }
  }

  function exportCsv(members: ManagedUser[]) {
    const headers = ["email", "full_name", "phone", "role", "scope_type", "scope_id_or_code"];
    const rows = members.map((m) => {
      const primaryScope = m.scopes[0];
      return {
        email: m.email,
        full_name: m.full_name ?? "",
        phone: m.phone ?? "",
        role: m.role,
        scope_type: primaryScope?.scope_type ?? "",
        scope_id_or_code: primaryScope?.code ?? "",
      };
    });
    const csv = toCSV(headers, rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(`my-team-${date}.csv`, csv);
  }

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

  // Every role, not just ones currently present in the result set — a role
  // with zero visible members right now (a brand-new hire's role, or a
  // backend visibility gap like the one manageable_users() once had for
  // fbc/back-office roles) should still be selectable, both so the filter
  // doesn't silently drop options and so "0 results" is a debuggable signal
  // instead of the option just not existing.
  const rolesPresent = useMemo(
    () =>
      (Object.keys(ROLE_LABELS) as UserRole[]).sort((a, b) =>
        ROLE_LABELS[a].localeCompare(ROLE_LABELS[b])
      ),
    []
  );

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
  const isHourly = isHourlyStoreRole(role);
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCsv(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Download CSV
            </Button>
            {profile?.role === "admin" && (
              <Link to="/admin/bulk-import">
                <Button variant="ghost" size="sm">
                  Bulk import…
                </Button>
              </Link>
            )}
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              + Add user
            </Button>
          </div>
        }
      />
      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EditMemberModal
        open={!!editing}
        // Read the live row from the query so in-modal edits (e.g. adding
        // coverage) reflect immediately after a refetch, not a stale snapshot.
        member={editing ? (data.members.find((m) => m.id === editing.id) ?? editing) : null}
        managerRole={data.user.role}
        onClose={() => setEditing(null)}
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
            <MemberCard
              key={m.id}
              member={m}
              onEdit={() => setEditing(m)}
              // Temporarily disabled — pinned for now, not removed. Restore
              // by putting back `profile?.role === "admin" && m.id !== profile.id`.
              canViewAs={false}
              viewingAs={startingViewAs === m.id}
              onViewAs={() => viewAs(m)}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Member card
// ----------------------------------------------------------------------------

function MemberCard({
  member,
  onEdit,
  canViewAs,
  viewingAs,
  onViewAs,
}: {
  member: ManagedUser;
  onEdit: () => void;
  canViewAs: boolean;
  viewingAs: boolean;
  onViewAs: () => void;
}) {
  const toast = useToast();

  function copy(value: string, label: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(
        () => toast.push(`${label} copied`, "success"),
        () => toast.push(`Couldn't copy ${label.toLowerCase()}`, "error")
      );
    } else {
      toast.push(`Couldn't copy ${label.toLowerCase()}`, "error");
    }
  }

  const cfmExpiry = member.cfm_expires_at ? new Date(member.cfm_expires_at) : null;
  const cfmDaysToExpiry = cfmExpiry
    ? Math.floor((cfmExpiry.getTime() - Date.now()) / 86_400_000)
    : null;
  const cfmTone: "neutral" | "warning" | "danger" =
    cfmDaysToExpiry == null
      ? "neutral"
      : cfmDaysToExpiry < 0
        ? "danger"
        : cfmDaysToExpiry < 60
          ? "warning"
          : "neutral";

  // International travel norms typically require 6 months of validity
  // beyond the trip date, so passport uses a wider "expiring soon" window
  // than the CFM cert's 60 days.
  const passportExpiry = member.passport_expires_at ? new Date(member.passport_expires_at) : null;
  const passportDaysToExpiry = passportExpiry
    ? Math.floor((passportExpiry.getTime() - Date.now()) / 86_400_000)
    : null;
  const passportTone: "neutral" | "warning" | "danger" =
    passportDaysToExpiry == null
      ? "neutral"
      : passportDaysToExpiry < 0
        ? "danger"
        : passportDaysToExpiry < 182
          ? "warning"
          : "neutral";

  return (
    <Card
      className={cn(
        "px-4 py-3 sm:px-5 sm:py-4",
        !member.is_active && "opacity-60"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          {member.profile_photo_url ? (
            <img
              src={member.profile_photo_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-zinc-200"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold uppercase text-zinc-500">
              {(member.preferred_name || member.full_name || member.email)
                .trim()
                .slice(0, 2)}
            </div>
          )}
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-midnight sm:text-base">
              {member.full_name?.trim() || member.email}
            </span>
            {member.preferred_name && member.preferred_name !== member.full_name && (
              <span className="text-xs italic text-zinc-500">
                "{member.preferred_name}"
              </span>
            )}
            <Badge tone={roleTone(member.role)}>
              {ROLE_LABELS[member.role] ?? member.role}
            </Badge>
            {!member.is_active && <Badge tone="neutral">Inactive</Badge>}
            {member.is_active && !member.email_confirmed_at && (
              <Badge tone="warning">Pending</Badge>
            )}
            {member.is_active &&
              member.scopes.length === 0 &&
              !["vp", "coo", "admin", "payroll"].includes(member.role) && (
                <Badge tone="warning">Unassigned</Badge>
              )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            {member.email && (
              <button
                type="button"
                onClick={() => copy(member.email, "Email")}
                title="Copy email"
                className="group inline-flex items-center gap-1.5 hover:text-accent"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span className="truncate">{member.email}</span>
                <Copy
                  className="h-3 w-3 opacity-0 transition group-hover:opacity-60"
                  strokeWidth={1.75}
                />
              </button>
            )}
            {member.phone && (
              <button
                type="button"
                onClick={() =>
                  copy(formatPhoneForDisplay(member.phone), "Phone number")
                }
                title="Copy phone"
                className="group inline-flex items-center gap-1.5 hover:text-accent"
              >
                <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>{formatPhoneForDisplay(member.phone)}</span>
                <Copy
                  className="h-3 w-3 opacity-0 transition group-hover:opacity-60"
                  strokeWidth={1.75}
                />
              </button>
            )}
          </div>

          {/* HR + personal details */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {member.start_date && (
              <span>
                <span className="text-zinc-400">Started:</span>{" "}
                <span className="text-zinc-700">{formatDateShort(member.start_date)}</span>
              </span>
            )}
            {member.role === "gm" && member.gm_assigned_date && (
              <span>
                <span className="text-zinc-400">GM since:</span>{" "}
                <span className="text-zinc-700">{formatDateShort(member.gm_assigned_date)}</span>
                {member.primary_store_number && (
                  <span className="text-zinc-400">
                    {" "}@ #{member.primary_store_number}
                  </span>
                )}
              </span>
            )}
            {member.show_birthday !== false && member.birthday && (
              <span>
                <span className="text-zinc-400">🎂</span>{" "}
                <span className="text-zinc-700">{formatBirthdayShort(member.birthday)}</span>
              </span>
            )}
            {member.shirt_size && (
              <span>
                <span className="text-zinc-400">Shirt:</span>{" "}
                <span className="text-zinc-700">
                  {member.shirt_size}
                  {member.shirt_cut && ` (${shirtCutLabel(member.shirt_cut)})`}
                </span>
              </span>
            )}
            {member.cfm_cert_number && (
              <span className="inline-flex items-center gap-1">
                <span className="text-zinc-400">CFM:</span>
                <span className="text-zinc-700">{member.cfm_cert_number}</span>
                {cfmExpiry && (
                  <Badge tone={cfmTone}>
                    {cfmDaysToExpiry! < 0
                      ? "Expired"
                      : `Expires ${formatDateShort(member.cfm_expires_at!)}`}
                  </Badge>
                )}
              </span>
            )}
            {/* Passport on file — for international trip eligibility (e.g.
                the annual Cancun trip). Number is never shown, only status. */}
            {passportExpiry && (
              <span className="inline-flex items-center gap-1">
                <span className="text-zinc-400">Passport:</span>
                <Badge tone={passportTone}>
                  {passportDaysToExpiry! < 0
                    ? "Expired"
                    : `Expires ${formatDateShort(member.passport_expires_at!)}`}
                </Badge>
              </span>
            )}
          </div>

          {member.favorite_quote && (
            <div className="mt-1 truncate text-xs italic text-zinc-500">
              "{member.favorite_quote}"
            </div>
          )}

          <TrainingChip summary={member.training_summary} />

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
        </div>

        <div className="flex shrink-0 gap-2">
          {canViewAs && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewAs}
              disabled={viewingAs}
              title="See My CAPs / My Assignments / Sign-off Queue exactly as this person would — read-only."
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
              {viewingAs ? "Starting…" : "View as"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Manage
          </Button>
        </div>
      </div>
    </Card>
  );
}

function formatDateShort(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const [y, m, d] = iso.slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

// One-glance training engagement chip: outstanding count (role-required +
// assignment-driven) and last-30-day popup activity. Tone follows the worst
// signal — outstanding-with-dismissals is red, outstanding alone is amber,
// engaged-but-on-track is green, nothing to say renders nothing.
function TrainingChip({ summary }: { summary?: TrainingSummary }) {
  if (!summary) return null;
  const { outstanding_count, shown_30d, started_30d, dismissed_30d } = summary;
  const total30 = shown_30d + started_30d + dismissed_30d;
  if (outstanding_count === 0 && total30 === 0) return null;

  let tone: "warning" | "danger" | "ok" | "neutral" = "neutral";
  let label = "";
  if (outstanding_count > 0 && dismissed_30d > 0) {
    tone = "danger";
    label = `${outstanding_count} outstanding · dismissed ${dismissed_30d}×`;
  } else if (outstanding_count > 0) {
    tone = "warning";
    label = `${outstanding_count} outstanding training`;
  } else {
    tone = "ok";
    label = "Training up to date";
  }
  const title = `Last 30 days: ${shown_30d} shown · ${started_30d} started · ${dismissed_30d} dismissed`;
  const cls = {
    warning: "bg-amber-50 text-amber-800 ring-amber-200",
    danger: "bg-red-50 text-red-800 ring-red-200",
    ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  }[tone];

  return (
    <div className="mt-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
          cls,
        )}
        title={title}
      >
        <GraduationCap className="h-3 w-3" strokeWidth={2} />
        {label}
      </span>
    </div>
  );
}

function shirtCutLabel(cut: string): string {
  return cut === "womens" ? "Women's" : cut === "mens" ? "Men's" : cut;
}

function formatBirthdayShort(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const [, m, d] = iso.slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
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
