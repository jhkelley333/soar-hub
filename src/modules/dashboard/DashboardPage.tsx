import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";
import { listWorkOrders, type WorkOrder } from "@/modules/work-orders/api";

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

export function DashboardPage() {
  const { profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const greeting = `${timeOfDayGreeting()}, ${firstName}`;

  const woQuery = useQuery({
    queryKey: ["work-orders", "index"],
    queryFn: listWorkOrders,
    staleTime: 30_000,
  });

  const openCount = useMemo(() => {
    return (woQuery.data?.workOrders ?? []).filter(isOpen).length;
  }, [woQuery.data]);

  const storesInScope = woQuery.data?.user.canSeeAllStores
    ? "All"
    : String(woQuery.data?.user.storeNumbers.length ?? 0);

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
        <Stat label="Pending PAFs" value="—" tone="info" />
        <Stat label="Stores in Scope" value={woQuery.isLoading ? "…" : storesInScope} tone="neutral" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Action Queue" description="Items waiting on you." />
          <CardBody>
            <div className="text-sm text-zinc-500">
              Once modules are wired up, this is where pending approvals, overdue work
              orders, and PAF reviews will surface.
            </div>
          </CardBody>
        </Card>

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
      </div>
    </>
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
  tone: "neutral" | "warning" | "info";
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
