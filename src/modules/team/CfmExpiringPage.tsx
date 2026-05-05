import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Mail, Phone } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { ROLE_LABELS } from "@/types/database";
import { downloadCSV, toCSV } from "@/lib/csv";
import { formatPhoneForDisplay } from "@/lib/phone";
import {
  fetchCfmExpiring,
  type CfmTeamMember,
} from "@/modules/team/api";

export function CfmExpiringPage() {
  const query = useQuery({
    queryKey: ["cfm-expiring", 60],
    queryFn: () => fetchCfmExpiring(60),
  });

  const data = query.data;

  function exportCsv(list: CfmTeamMember[]) {
    const headers = [
      "email",
      "full_name",
      "role",
      "cfm_cert_number",
      "cfm_issued_at",
      "cfm_expires_at",
      "days_left",
      "status",
    ];
    const rows = list.map((m) => ({
      email: m.email,
      full_name: m.full_name ?? "",
      role: ROLE_LABELS[m.role] ?? m.role,
      cfm_cert_number: m.cfm_cert_number ?? "",
      cfm_issued_at: m.cfm_issued_at ?? "",
      cfm_expires_at: m.cfm_expires_at,
      days_left: m.days_left,
      status: m.status,
    }));
    const csv = toCSV(headers, rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(`cfm-expiring-${date}.csv`, csv);
  }

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="CFM expirations" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }

  if (query.isError || !data) {
    return (
      <>
        <PageHeader title="CFM expirations" />
        <EmptyState
          title="Couldn't load CFM data"
          description={(query.error as Error)?.message ?? "Try again in a moment."}
        />
      </>
    );
  }

  const list = data.team.list;

  return (
    <>
      <PageHeader
        title="CFM expirations"
        description={`Certified Food Manager certs expiring within ${data.window_days} days, plus anything already expired.`}
        actions={
          <div className="flex gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Back
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCsv(list)}
              disabled={list.length === 0}
            >
              Download CSV
            </Button>
          </div>
        }
      />

      <SelfCard self={data.self} />

      <Card className="mt-6">
        <CardHeader
          title="Your team"
          description={`${data.team.count_expired} expired · ${data.team.count_expiring} within ${data.window_days} days`}
        />
        <CardBody className="p-0">
          {list.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No team members with CFM certs expiring or expired in this window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 text-left text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Cert #</th>
                    <th className="px-3 py-2 font-medium">Issued</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {list.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2">
                        {m.status === "expired" ? (
                          <Badge tone="danger">
                            Expired {Math.abs(m.days_left)}d ago
                          </Badge>
                        ) : (
                          <Badge tone="warning">
                            {m.days_left}d left
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-midnight">
                        {m.full_name?.trim() || m.email}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-600">
                        {m.cfm_cert_number ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {m.cfm_issued_at ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {m.cfm_expires_at}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-600">
                          {m.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" strokeWidth={1.75} />
                              {m.email}
                            </span>
                          )}
                          {m.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" strokeWidth={1.75} />
                              {formatPhoneForDisplay(m.phone)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function SelfCard({
  self,
}: {
  self: import("@/modules/team/api").CfmSelfStatus;
}) {
  const tone = useMemo(() => {
    if (self.status === "expired") return "danger" as const;
    if (self.status === "expiring") return "warning" as const;
    if (self.status === "valid") return "success" as const;
    return "neutral" as const;
  }, [self.status]);

  if (!self.has_cert) {
    return (
      <Card>
        <CardHeader title="Your CFM" />
        <CardBody className="text-sm text-zinc-600">
          You don't have a Certified Food Manager certificate on file.{" "}
          <Link to="/account" className="font-medium text-accent hover:underline">
            Add it on My Account.
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Your CFM" />
      <CardBody>
        <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-700">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Cert number
            </div>
            <div className="font-mono">{self.cert_number ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Expires
            </div>
            <div>{self.expires_at ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              Status
            </div>
            <Badge tone={tone}>
              {self.status === "expired" && self.days_left !== null
                ? `Expired ${Math.abs(self.days_left)}d ago`
                : self.status === "expiring" && self.days_left !== null
                  ? `${self.days_left}d left`
                  : self.status === "valid" && self.days_left !== null
                    ? `Valid (${self.days_left}d)`
                    : "—"}
            </Badge>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
