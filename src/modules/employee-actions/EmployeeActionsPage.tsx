// /employee-actions — landing page for the Employee Action forms.
// Segmented tabs switch between the Training Credit form, the PTO form,
// and a read-only History list of requests in the caller's scope.
// Approvals / tracking / sign-offs are a later layer.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { ApprovalQueue } from "./ApprovalQueue";
import { RequestDetailDrawer } from "./RequestDetailDrawer";
import { statusKind, waitingOn } from "./statusMeta";
import type { PtoRow, TrainingCreditRow } from "./types";

type Tab = "training" | "pto" | "history" | "approvals";

const SUBMIT_ROLES = ["gm", "do", "sdo", "rvp", "vp", "coo", "admin"];
const APPROVER_ROLES = ["do", "sdo", "rvp", "admin"];

function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function EmployeeActionsPage() {
  const { profile } = useAuth();
  // Deep link: /employee-actions?tab=history&type=training|pto&id=… opens the
  // History tab and pops that request's detail drawer (e.g. from the calendar).
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("id");
  const focusKind: "training" | "pto" = searchParams.get("type") === "pto" ? "pto" : "training";
  const [tab, setTab] = useState<Tab>(focusId ? "history" : "training");
  const [editTraining, setEditTraining] = useState<TrainingCreditRow | null>(null);
  const [editPto, setEditPto] = useState<PtoRow | null>(null);

  // Consume the deep-link params once so the drawer doesn't reopen on tab
  // changes; the focus is captured below before clearing.
  const [focus, setFocus] = useState<{ kind: "training" | "pto"; id: string } | null>(
    focusId ? { kind: focusKind, id: focusId } : null,
  );
  useEffect(() => {
    if (!focusId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("id"); next.delete("type"); next.delete("tab");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = SUBMIT_ROLES.includes(profile?.role ?? "");
  const canApprove = APPROVER_ROLES.includes(profile?.role ?? "");

  const options = [
    { value: "training" as const, label: "Training Credit" },
    { value: "pto" as const, label: "PTO Request" },
    ...(canApprove ? [{ value: "approvals" as const, label: "Approvals" }] : []),
    { value: "history" as const, label: "History" },
  ];

  function editTrainingRow(row: TrainingCreditRow) {
    setEditPto(null);
    setEditTraining(row);
    setTab("training");
  }
  function editPtoRow(row: PtoRow) {
    setEditTraining(null);
    setEditPto(row);
    setTab("pto");
  }

  return (
    <>
      <PageHeader
        title="Employee Actions"
        description="Training credit and PTO requests. Submitting notifies the store's DO and RVP."
      />

      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={(t) => {
            if (t !== "training") setEditTraining(null);
            if (t !== "pto") setEditPto(null);
            setTab(t);
          }}
          options={options}
        />
      </div>

      {tab === "training" &&
        (canSubmit ? (
          <TrainingCreditForm
            key={editTraining?.id ?? "new"}
            editRow={editTraining}
            onSubmitted={() => {
              setEditTraining(null);
              setTab("history");
            }}
          />
        ) : (
          <NoAccess />
        ))}

      {tab === "pto" &&
        (canSubmit ? (
          <PtoRequestForm
            key={editPto?.id ?? "new"}
            editRow={editPto}
            onSubmitted={() => {
              setEditPto(null);
              setTab("history");
            }}
          />
        ) : (
          <NoAccess />
        ))}

      {tab === "approvals" && (canApprove ? <ApprovalQueue /> : <NoAccess />)}

      {tab === "history" && (
        <HistoryList focus={focus} onConsumeFocus={() => setFocus(null)} onEditTraining={editTrainingRow} onEditPto={editPtoRow} />
      )}
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

type Selection =
  | { kind: "training"; row: TrainingCreditRow }
  | { kind: "pto"; row: PtoRow }
  | null;

function HistoryList({
  focus,
  onConsumeFocus,
  onEditTraining,
  onEditPto,
}: {
  focus: { kind: "training" | "pto"; id: string } | null;
  onConsumeFocus: () => void;
  onEditTraining: (row: TrainingCreditRow) => void;
  onEditPto: (row: PtoRow) => void;
}) {
  const [selected, setSelected] = useState<Selection>(null);
  const query = useQuery({ queryKey: ["ea-list"], queryFn: listEmployeeActions });

  // Auto-open the deep-linked request once the list loads.
  useEffect(() => {
    if (!focus || !query.data) return;
    const row = focus.kind === "training"
      ? query.data.trainingCredits.find((r) => r.id === focus.id)
      : query.data.ptoRequests.find((r) => r.id === focus.id);
    if (row) setSelected({ kind: focus.kind, row } as Selection);
    onConsumeFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, query.data]);

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
          <TrainingRow key={r.id} row={r} onOpen={() => setSelected({ kind: "training", row: r })} />
        ))}
      </Section>
      <Section title="PTO Requests" count={ptoRequests.length}>
        {ptoRequests.map((r) => (
          <PtoRowItem key={r.id} row={r} onOpen={() => setSelected({ kind: "pto", row: r })} />
        ))}
      </Section>

      <RequestDetailDrawer
        kind={selected?.kind ?? "training"}
        row={selected?.row ?? null}
        open={!!selected}
        onClose={() => setSelected(null)}
        onEdit={
          selected
            ? () => {
                const sel = selected;
                setSelected(null);
                if (sel.kind === "training") onEditTraining(sel.row);
                else onEditPto(sel.row);
              }
            : undefined
        }
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

function TrainingRow({ row, onOpen }: { row: TrainingCreditRow; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer transition hover:ring-2 hover:ring-accent/30" onClick={onOpen}>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            <StatusPill kind={statusKind(row.status)}>{row.status}</StatusPill>
            {waitingOn("training", row.status) && (
              <span className="text-xs font-medium text-sonic-700">→ Waiting on {waitingOn("training", row.status)}</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <StoreLabel number={row.store_number} name={row.store_name} />
            <span className="text-xs text-zinc-500">{row.training_type}</span>
            <span className="text-xs text-zinc-500">{fmtMoney(row.requested_amount)}</span>
          </div>
          {row.status === "Changes Requested" && row.rejection_reason && (
            <p className="mt-1 text-xs text-amber-700">Changes requested: {row.rejection_reason}</p>
          )}
        </div>
        <div className="text-right text-xs text-zinc-400">
          {new Date(row.created_at).toLocaleDateString()}
        </div>
      </CardBody>
    </Card>
  );
}

function PtoRowItem({ row, onOpen }: { row: PtoRow; onOpen: () => void }) {
  const isHourly = row.position === "Associate Manager" || row.position === "First Assistant";
  return (
    <Card className="cursor-pointer transition hover:ring-2 hover:ring-accent/30" onClick={onOpen}>
      <CardBody className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900">{row.employee_name}</span>
            {row.position && <span className="text-xs text-zinc-400">{row.position}</span>}
            <StatusPill kind={statusKind(row.status)}>{row.status}</StatusPill>
            {waitingOn("pto", row.status) && (
              <span className="text-xs font-medium text-sonic-700">→ Waiting on {waitingOn("pto", row.status)}</span>
            )}
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
          {row.status === "Changes Requested" && row.rejection_reason && (
            <p className="mt-1 text-xs text-amber-700">Changes requested: {row.rejection_reason}</p>
          )}
        </div>
        <div className="text-right text-xs text-zinc-400">
          {new Date(row.created_at).toLocaleDateString()}
        </div>
      </CardBody>
    </Card>
  );
}
