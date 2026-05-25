// /employee-actions — landing page for the Employee Action forms.
// Segmented tabs switch between the Training Credit form, the PTO form,
// and a read-only History list of requests in the caller's scope.
// Approvals / tracking / sign-offs are a later layer.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Segmented } from "@/shared/ui/Segmented";
import { StatusPill } from "@/shared/ui/StatusPill";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { listEmployeeActions } from "./api";
import { TrainingCreditForm } from "./TrainingCreditForm";
import { PtoRequestForm } from "./PtoRequestForm";
import type { PtoRow, TrainingCreditRow } from "./types";

type Tab = "training" | "pto" | "history";

const SUBMIT_ROLES = ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"];

function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function EmployeeActionsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("training");

  const canSubmit = SUBMIT_ROLES.includes(profile?.role ?? "");

  return (
    <>
      <PageHeader
        title="Employee Actions"
        description="Training credit and PTO requests. Submitting notifies the store's DO and RVP."
      />

      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "training", label: "Training Credit" },
            { value: "pto", label: "PTO Request" },
            { value: "history", label: "History" },
          ]}
        />
      </div>

      {tab === "training" &&
        (canSubmit ? (
          <TrainingCreditForm onSubmitted={() => setTab("history")} />
        ) : (
          <NoAccess />
        ))}

      {tab === "pto" &&
        (canSubmit ? (
          <PtoRequestForm onSubmitted={() => setTab("history")} />
        ) : (
          <NoAccess />
        ))}

      {tab === "history" && <HistoryList />}
    </>
  );
}

function NoAccess() {
  return (
    <Card>
      <EmptyState
        title="No submit access"
        description="Your role can view requests but not submit new ones."
      />
    </Card>
  );
}

function HistoryList() {
  const query = useQuery({ queryKey: ["ea-list"], queryFn: listEmployeeActions });

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load requests"
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
          title="No requests yet"
          description="Submitted training credit and PTO requests in your scope will appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Training Credit Requests" count={trainingCredits.length}>
        {trainingCredits.map((r) => (
          <TrainingRow key={r.id} row={r} />
        ))}
      </Section>
      <Section title="PTO Requests" count={ptoRequests.length}>
        {ptoRequests.map((r) => (
          <PtoRowItem key={r.id} row={r} />
        ))}
      </Section>
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
      {count === 0 ? (
        <Card>
          <CardBody className="text-sm text-zinc-500">None yet.</CardBody>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function StoreLabel({ number, name }: { number: string; name?: string | null }) {
  return (
    <span className="text-xs text-zinc-500">
      Store #{number}
      {name ? ` — ${name}` : ""}
    </span>
  );
}

function TrainingRow({ row }: { row: TrainingCreditRow }) {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            <StatusPill kind="submitted">{row.status}</StatusPill>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <StoreLabel number={row.store_number} name={row.store_name} />
            <span className="text-xs text-zinc-500">{row.training_type}</span>
            <span className="text-xs text-zinc-500">{fmtMoney(row.requested_amount)}</span>
          </div>
        </div>
        <div className="text-right text-xs text-zinc-400">
          {new Date(row.created_at).toLocaleDateString()}
        </div>
      </CardBody>
    </Card>
  );
}

function PtoRowItem({ row }: { row: PtoRow }) {
  const isHourly = row.position === "Associate Manager" || row.position === "First Assistant";
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            {row.position && (
              <span className="text-xs text-zinc-400">{row.position}</span>
            )}
            <StatusPill kind="submitted">{row.status}</StatusPill>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <StoreLabel number={row.store_number} name={row.store_name} />
            <span className="text-xs text-zinc-500">
              {row.pto_start_date} → {row.pto_end_date}
            </span>
            {isHourly ? (
              <span className="text-xs text-zinc-500">
                {row.vacation_hours ?? 0} hrs
                {row.amount != null ? ` · ${fmtMoney(row.amount)}` : ""}
              </span>
            ) : (
              <span className="text-xs text-zinc-500">{row.days_used ?? 0} day(s)</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-zinc-400">
          {new Date(row.created_at).toLocaleDateString()}
        </div>
      </CardBody>
    </Card>
  );
}
