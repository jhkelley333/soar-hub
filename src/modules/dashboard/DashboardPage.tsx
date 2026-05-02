import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";

export function DashboardPage() {
  const { profile } = useAuth();
  const greeting = profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <>
      <PageHeader
        title={`Good morning, ${greeting}`}
        description="What needs your attention today."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Stat label="Open Work Orders"   value="—" tone="warning" />
        <Stat label="Pending PAFs"       value="—" tone="info"    />
        <Stat label="Stores in Scope"    value="—" tone="neutral" />
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
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "info";
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {label}
          </div>
          <Badge tone={tone}>Live</Badge>
        </div>
        <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
          {value}
        </div>
      </CardBody>
    </Card>
  );
}
