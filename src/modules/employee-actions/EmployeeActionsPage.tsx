// /employee-actions — landing page for the Employee Action forms.
// Segmented tabs switch between the Training Credit form, the PTO form,
// and a read-only History list of requests in the caller's scope.
// Approvals / tracking / sign-offs are a later layer.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Segmented } from "@/shared/ui/Segmented";
import { StatusPill } from "@/shared/ui/StatusPill";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { thisWeekRange } from "@/modules/my-stores/dateRange";
import { listEmployeeActions } from "./api";
import { TrainingCreditForm } from "./TrainingCreditForm";
import { PtoRequestForm } from "./PtoRequestForm";
import { ApprovalQueue } from "./ApprovalQueue";
import { RequestDetailDrawer } from "./RequestDetailDrawer";
import { statusKind, waitingOn } from "./statusMeta";
import type { PtoRow, TrainingCreditRow } from "./types";

// History time-window chips, matched against the request's ACTIVE DATE RANGE
// (the vacation period for PTO, the training period for training credits) —
// NOT the submission date. So a PTO submitted weeks ago for 6/29–7/05 shows
// up under "This week" of 6/29–7/05, which is what leadership expects when
// asking "who's on vacation this week?".
//
// Windows:
//   week   — Mon→Sun of the current week
//   month  — 1st→end-of-month of the current month
//   90     — trailing 90 days (past-only)
//   all    — unbounded
type HistoryRange = "week" | "month" | "90" | "all";

interface Window { start: Date | null; end: Date | null; }

function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}
function rangeWindow(range: HistoryRange): Window {
  if (range === "all") return { start: null, end: null };
  if (range === "week") {
    const { start, end } = thisWeekRange();
    const s = localDate(start);
    const e = localDate(end);
    if (e) e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (range === "month") {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  // "90" — trailing 90 days, past-only.
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// True when a row's [rowStart, rowEnd] overlaps the chosen [start, end].
// When the row date is missing, falls back to created_at so the row stays
// discoverable somewhere. A null window bound = unbounded that side.
function overlaps(rowStartIso: string | null, rowEndIso: string | null, fallbackIso: string, win: Window): boolean {
  if (!win.start && !win.end) return true;
  const rowStart = (rowStartIso && localDate(rowStartIso)) ?? localDate(fallbackIso) ?? new Date(fallbackIso);
  const rowEndRaw = (rowEndIso && localDate(rowEndIso)) ?? rowStart;
  const rowEnd = new Date(rowEndRaw);
  rowEnd.setHours(23, 59, 59, 999);
  if (win.start && rowEnd.getTime() < win.start.getTime()) return false;
  if (win.end && rowStart.getTime() > win.end.getTime()) return false;
  return true;
}

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
        description="Training credit and PTO requests. Submitting notifies the store's DO, SDO and RVP."
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
  const [range, setRange] = useState<HistoryRange>("week");
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

  // Per-row date-range overlap with the chosen window:
  //  - PTO: pto_start_date → pto_end_date (the actual vacation window)
  //  - Training credit: start_date → last_day_date (the training window)
  // Falls back to created_at when both date columns are null so the row
  // stays discoverable somewhere.
  //
  // The chip-count memo MUST sit above any early returns below — otherwise
  // the loading→loaded transition would change the hook count between
  // renders (React error #310). Empty arrays as defaults keep the math
  // safe when query.data isn't ready yet.
  const trainingCredits = query.data?.trainingCredits ?? [];
  const ptoRequests = query.data?.ptoRequests ?? [];
  const counts = useMemo(() => {
    const trainingMatches = (r: TrainingCreditRow, w: Window) =>
      overlaps(r.start_date, r.last_day_date, r.created_at, w);
    const ptoMatches = (r: PtoRow, w: Window) =>
      overlaps(r.pto_start_date, r.pto_end_date, r.created_at, w);
    const make = (r: HistoryRange) => {
      const w = rangeWindow(r);
      return (
        trainingCredits.filter((row) => trainingMatches(row, w)).length +
        ptoRequests.filter((row) => ptoMatches(row, w)).length
      );
    };
    return { week: make("week"), month: make("month"), "90": make("90"), all: make("all") };
  }, [trainingCredits, ptoRequests]);

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

  const trainingMatches = (r: TrainingCreditRow, w: Window) =>
    overlaps(r.start_date, r.last_day_date, r.created_at, w);
  const ptoMatches = (r: PtoRow, w: Window) =>
    overlaps(r.pto_start_date, r.pto_end_date, r.created_at, w);
  const win = rangeWindow(range);
  const visibleTraining = trainingCredits.filter((r) => trainingMatches(r, win));
  const visiblePto = ptoRequests.filter((r) => ptoMatches(r, win));
  const total = visibleTraining.length + visiblePto.length;

  if (trainingCredits.length + ptoRequests.length === 0) {
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
    <div className="space-y-4">
      {/* Time-window chips — mirrors the Segmented filter Approvals uses.
          Defaults to "This week" so leadership sees the running week first. */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<HistoryRange>
          value={range}
          onChange={setRange}
          options={[
            { value: "week",  label: "This week",   count: counts.week },
            { value: "month", label: "This month",  count: counts.month },
            { value: "90",    label: "Last 90 days", count: counts["90"] },
            { value: "all",   label: "All",         count: counts.all },
          ]}
        />
      </div>

      {total === 0 && (
        <Card>
          <EmptyState
            title="No requests in this window"
            description="Widen the range to see older requests."
          />
        </Card>
      )}

      {visibleTraining.length > 0 && (
      <Section title="Training Credit Requests" count={visibleTraining.length}>
        {visibleTraining.map((r) => (
          <TrainingRow key={r.id} row={r} onOpen={() => setSelected({ kind: "training", row: r })} />
        ))}
      </Section>)}
      {visiblePto.length > 0 && (
      <Section title="PTO Requests" count={visiblePto.length}>
        {visiblePto.map((r) => (
          <PtoRowItem key={r.id} row={r} onOpen={() => setSelected({ kind: "pto", row: r })} />
        ))}
      </Section>)}

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
