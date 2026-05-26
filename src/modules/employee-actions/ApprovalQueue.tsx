// Approver queue for Employee Actions. Lists everything awaiting the signed-in
// user's action — approvals plus the post-approval confirmations (entered /
// closed out / PAF submitted) — and opens a detail drawer to act.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { listApprovalQueue } from "./api";
import { RequestDetailDrawer } from "./RequestDetailDrawer";
import type { PtoRow, TrainingCreditRow } from "./types";

function fmtMoney(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Short hint of what the caller needs to do, from the stamped action_needed.
function actionHint(action: string | null | undefined): string {
  switch (action) {
    case "decide":
      return "Approve / send back";
    case "entered":
      return "Weekly sheet";
    case "closed-out":
      return "Complete";
    case "tracked":
      return "Tracking sheet";
    case "paf-submitted":
      return "Confirm PAF";
    default:
      return "Review";
  }
}

type Selection =
  | { kind: "training"; row: TrainingCreditRow }
  | { kind: "pto"; row: PtoRow }
  | null;

export function ApprovalQueue() {
  const [selected, setSelected] = useState<Selection>(null);
  const query = useQuery({ queryKey: ["ea-queue"], queryFn: listApprovalQueue });

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load the approval queue"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </Card>
    );
  }

  const { trainingCredits, ptoRequests } = query.data;
  const total = trainingCredits.length + ptoRequests.length;

  if (!total) {
    return (
      <Card>
        <EmptyState
          title="Nothing awaiting your action"
          description="Approvals and confirmations that need you will show up here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {trainingCredits.length > 0 && (
        <Section title="Training Credit" count={trainingCredits.length}>
          {trainingCredits.map((r) => (
            <QueueRow
              key={r.id}
              title={r.employee_name}
              hint={actionHint(r.action_needed)}
              meta={[
                `Store #${r.store_number}${r.store_name ? ` — ${r.store_name}` : ""}`,
                r.training_type,
                fmtMoney(r.requested_amount),
              ]}
              onOpen={() => setSelected({ kind: "training", row: r })}
            />
          ))}
        </Section>
      )}
      {ptoRequests.length > 0 && (
        <Section title="PTO" count={ptoRequests.length}>
          {ptoRequests.map((r) => {
            const isHourly = r.position === "Associate Manager" || r.position === "First Assistant";
            return (
              <QueueRow
                key={r.id}
                title={`${r.employee_name}`}
                subtitle={r.position}
                hint={actionHint(r.action_needed)}
                meta={[
                  `Store #${r.store_number}${r.store_name ? ` — ${r.store_name}` : ""}`,
                  `${r.pto_start_date} → ${r.pto_end_date}`,
                  isHourly
                    ? `${r.vacation_hours ?? 0} hrs${r.amount != null ? ` · ${fmtMoney(r.amount)}` : ""}`
                    : `${r.days_used ?? 0} day(s)`,
                ]}
                onOpen={() => setSelected({ kind: "pto", row: r })}
              />
            );
          })}
        </Section>
      )}

      <RequestDetailDrawer
        kind={selected?.kind ?? "training"}
        row={selected?.row ?? null}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold tracking-tight text-midnight">
        {title} <span className="text-zinc-400">({count})</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function QueueRow({
  title,
  subtitle,
  hint,
  meta,
  onOpen,
}: {
  title: string;
  subtitle?: string;
  hint: string;
  meta: string[];
  onOpen: () => void;
}) {
  return (
    <Card
      className="cursor-pointer transition hover:ring-2 hover:ring-accent/30"
      onClick={onOpen}
    >
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{title}</span>
            {subtitle && <span className="text-xs text-zinc-400">{subtitle}</span>}
            <Badge tone="info">{hint}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            {meta.filter(Boolean).map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>
        <span className="text-xs font-medium text-accent">Open →</span>
      </CardBody>
    </Card>
  );
}
