import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MapPin, Phone } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS, type UserRole, type Store } from "@/types/database";
import { listWorkOrders, type WorkOrder } from "@/modules/work-orders/api";
import { fetchCfmExpiring } from "@/modules/team/api";
import { listSdoQueue } from "@/modules/paf/api";
import { PafTable } from "@/modules/paf/PafTable";
import { BirthdayWidget } from "@/modules/my-stores/BirthdayWidget";
import { BirthdayCelebration } from "@/modules/my-stores/BirthdayCelebration";
import { supabase } from "@/lib/supabase";
import { formatPhoneForDisplay } from "@/lib/phone";

const SDO_REVIEW_ROLES = new Set(["sdo", "rvp", "vp", "coo", "admin"]);

// Anything in this set counts as "closed/done" for dashboard purposes.
// Pulled from the canonical list in netlify/functions/work-orders.js.
const TERMINAL_STATUSES = new Set(["Closed", "Completed", "Cancelled"]);

function timeOfDayGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function isOpen(wo: WorkOrder): boolean {
  const status = String((wo as Record<string, unknown>)["Status"] ?? "").trim();
  return status !== "" && !TERMINAL_STATUSES.has(status);
}

// Per-role copy for the Action Queue card. Shift managers don't see PAFs
// (gated in router/nav), so we don't mention them here either.
function actionQueueCopy(role: UserRole | undefined): string {
  switch (role) {
    case "shift_manager":
      return "Once modules are wired up, this is where work orders awaiting your sign-off and shift-related alerts will surface.";
    case "gm":
      return "Pending work orders, vendor follow-ups, and overdue inventory items for your store will appear here.";
    case "do":
    case "sdo":
      return "Work orders awaiting district approval, store-level escalations, and PAF reviews for your district will surface here.";
    case "rvp":
      return "Regional approvals, escalated work orders, and PAFs awaiting your decision will live here.";
    case "vp":
    case "coo":
      return "Org-wide approvals and escalations awaiting your sign-off will live here.";
    case "payroll":
      return "PAFs awaiting payroll review and recently submitted change requests will appear here.";
    case "admin":
      return "Org-wide queue: approvals, escalations, PAFs, and admin tasks across every region.";
    default:
      return "Once modules are wired up, items needing your attention will appear here.";
  }
}

export function DashboardPage() {
  const { profile } = useAuth();

  // Payroll's workday is the PAF queue; the dashboard isn't surfaced in
  // their sidebar at all. If they land here via a stale link or the
  // root URL, send them straight to the queue.
  if (profile?.role === "payroll") {
    return <Navigate to="/paf/queue" replace />;
  }

  const greetingName =
    profile?.preferred_name?.trim() ||
    profile?.full_name?.split(" ")[0] ||
    "there";
  const greeting = `${timeOfDayGreeting()}, ${greetingName}`;

  const woQuery = useQuery({
    queryKey: ["work-orders", "index"],
    queryFn: listWorkOrders,
    staleTime: 30_000,
  });

  const cfmQuery = useQuery({
    queryKey: ["cfm-expiring", 60],
    queryFn: () => fetchCfmExpiring(60),
    staleTime: 60_000,
  });

  const openCount = useMemo(() => {
    return (woQuery.data?.workOrders ?? []).filter(isOpen).length;
  }, [woQuery.data]);

  const storesInScope = woQuery.data?.user.canSeeAllStores
    ? "All"
    : String(woQuery.data?.user.storeNumbers.length ?? 0);

  const cfmTotal =
    (cfmQuery.data?.team.count_expired ?? 0) +
    (cfmQuery.data?.team.count_expiring ?? 0);
  const cfmTone: "warning" | "danger" | "neutral" =
    (cfmQuery.data?.team.count_expired ?? 0) > 0
      ? "danger"
      : cfmTotal > 0
        ? "warning"
        : "neutral";

  return (
    <>
      <PageHeader
        title={greeting}
        description="What needs your attention today."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Open Work Orders"
          value={
            woQuery.isLoading
              ? "…"
              : woQuery.isError
                ? "—"
                : String(openCount)
          }
          tone="warning"
          to="/work-orders"
        />
        <Stat
          label="CFMs Expiring (60d)"
          value={cfmQuery.isLoading ? "…" : cfmQuery.isError ? "—" : String(cfmTotal)}
          tone={cfmTone === "neutral" ? "info" : cfmTone}
          to="/cfm-expiring"
        />
        <Stat label="Stores in Scope" value={woQuery.isLoading ? "…" : storesInScope} tone="neutral" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Action Queue" description="Items waiting on you." />
          <CardBody>
            <div className="text-sm text-zinc-500">
              {actionQueueCopy(profile?.role)}
            </div>
          </CardBody>
        </Card>

        <PrimaryStoreCard />
      </div>

      <div className="mt-6">
        <BirthdayWidget />
      </div>

      {profile && SDO_REVIEW_ROLES.has(profile.role) && <SdoQueueWidget />}

      <BirthdayCelebration />
    </>
  );
}

// ----------------------------------------------------------------------------
// SDO bonus approval widget — visible to sdo/rvp/vp/coo/admin. Only renders
// the table when there's at least one bonus awaiting the caller's action;
// otherwise shows a quiet "inbox zero" line so the dashboard doesn't grow
// indefinitely.
// ----------------------------------------------------------------------------
function SdoQueueWidget() {
  const query = useQuery({
    queryKey: ["paf-sdo-queue"],
    queryFn: listSdoQueue,
    staleTime: 30_000,
  });

  const rows = query.data?.pafs ?? [];

  return (
    <div className="mt-6">
      <Card>
        <CardHeader
          title="Take Action — Bonus PAFs"
          description="Bonuses awaiting your approval before Payroll."
        />
        <CardBody>
          {query.isLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : query.isError ? (
            <div className="text-sm text-red-700">
              {(query.error as Error)?.message ?? "Couldn't load queue."}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-zinc-500">
              No bonus PAFs awaiting your approval.
            </div>
          ) : (
            <PafTable rows={rows} actions="sdo" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Primary store card — only renders if the user has a primary_store_id.
// ----------------------------------------------------------------------------

function PrimaryStoreCard() {
  const { profile } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile?.primary_store_id) {
      setStore(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("stores")
      .select("id, number, name, district_id, phone, city, state, is_active")
      .eq("id", profile.primary_store_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStore((data as Store) ?? null);
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.primary_store_id]);

  // Fall back to the role summary card for users without a primary store
  // (DO / SDO / RVP / admin / etc.).
  if (!profile?.primary_store_id) return <YourRoleCard />;

  return (
    <Card>
      <CardHeader title="Your store" description="Primary location on file." />
      <CardBody className="text-sm text-zinc-700">
        {loading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : !store ? (
          <div className="text-sm text-zinc-500">
            Couldn't load store details.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-midnight">
                Store #{store.number}
              </span>
              <span className="text-sm text-zinc-700">{store.name}</span>
              {!store.is_active && <Badge tone="neutral">Inactive</Badge>}
            </div>
            {(store.city || store.state) && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                <MapPin className="h-3 w-3" strokeWidth={1.75} />
                {[store.city, store.state].filter(Boolean).join(", ")}
              </div>
            )}
            {store.phone && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                <Phone className="h-3 w-3" strokeWidth={1.75} />
                {formatPhoneForDisplay(store.phone)}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function YourRoleCard() {
  const { profile } = useAuth();
  return (
    <Card>
      <CardHeader title="Your Role" description="Access summary." />
      <CardBody className="text-sm text-zinc-700">
        <div className="flex items-center gap-2">
          <span className="font-medium">{profile ? ROLE_LABELS[profile.role] : "—"}</span>
          {profile?.role === "payroll" && <Badge tone="info">Cross-org</Badge>}
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          Signed in as {profile?.email}
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "info" | "danger";
  to?: string;
}) {
  const inner = (
    <CardBody>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <Badge tone={tone}>Live</Badge>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="text-3xl font-semibold tracking-tight text-midnight tabular-nums">
          {value}
        </div>
        {to && (
          <ArrowRight
            className="h-4 w-4 text-zinc-400 transition group-hover:text-accent"
            strokeWidth={2}
          />
        )}
      </div>
    </CardBody>
  );
  if (to) {
    return (
      <Link to={to} className="group block">
        <Card className="transition hover:ring-2 hover:ring-accent/40">{inner}</Card>
      </Link>
    );
  }
  return <Card>{inner}</Card>;
}
