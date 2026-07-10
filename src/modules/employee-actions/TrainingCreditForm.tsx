import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { fetchCreditBalance, fetchMyStores, submitTrainingCredit, updateTrainingCredit } from "./api";
import {
  calcDayHours,
  CheckboxRow,
  DateField,
  NumberField,
  pickDefaultStoreNumber,
  SelectField,
  StoreSelect,
  TextField,
  TrainingDaysEditor,
} from "./formFields";
import type { TrainingCreditInput, TrainingCreditRow, TrainingDayInput } from "./types";

function fmtUSD(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const TRAINING_TYPES = [
  "Onboarding / New Hire",
  "Sonic Training Classes",
  "Serve Safe",
  "Other",
];

interface State {
  store_number: string;
  employee_name: string;
  hourly_wage: string;
  training_type: string;
  training_other: string;
  start_date: string;
  last_day_date: string;
  training_days: TrainingDayInput[];
  send_copy: boolean;
}

const EMPTY: State = {
  store_number: "",
  employee_name: "",
  hourly_wage: "",
  training_type: "",
  training_other: "",
  start_date: "",
  last_day_date: "",
  training_days: [],
  send_copy: false,
};

function stateFromRow(row: TrainingCreditRow): State {
  return {
    store_number: row.store_number,
    employee_name: row.employee_name,
    hourly_wage: row.hourly_wage != null ? String(row.hourly_wage) : "",
    training_type: row.training_type,
    training_other: row.training_other ?? "",
    start_date: row.start_date ?? "",
    last_day_date: row.last_day_date ?? "",
    training_days: row.training_days.map((d) => ({
      day: d.day,
      start_time: d.start_time,
      end_time: d.end_time,
    })),
    send_copy: row.send_copy,
  };
}

export function TrainingCreditForm({
  onSubmitted,
  editRow,
}: {
  onSubmitted: () => void;
  editRow?: TrainingCreditRow | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const isEditing = !!editRow;
  const [state, setState] = useState<State>(editRow ? stateFromRow(editRow) : EMPTY);
  const [error, setError] = useState<string | null>(null);

  const storesQuery = useQuery({
    queryKey: ["ea-my-stores"],
    queryFn: fetchMyStores,
    staleTime: 5 * 60_000,
  });
  const stores = useMemo(() => storesQuery.data?.stores ?? [], [storesQuery.data]);

  const defaultStore = useMemo(
    () => pickDefaultStoreNumber(stores, profile?.primary_store_id),
    [stores, profile?.primary_store_id]
  );
  // Pre-fill the store once it can be determined, without clobbering a manual
  // pick. Re-applies after a submit reset.
  useEffect(() => {
    if (defaultStore) {
      setState((prev) => (prev.store_number ? prev : { ...prev, store_number: defaultStore }));
    }
  }, [defaultStore]);

  const submit = useMutation({
    mutationFn: (input: TrainingCreditInput) =>
      isEditing ? updateTrainingCredit(editRow!.id, input) : submitTrainingCredit(input),
    onSuccess: () => {
      toast.push(
        isEditing
          ? "Training credit resubmitted for approval."
          : "Training credit request submitted — DO + RVP notified.",
        "success"
      );
      qc.invalidateQueries({ queryKey: ["ea-list"] });
      qc.invalidateQueries({ queryKey: ["ea-queue"] });
      qc.invalidateQueries({ queryKey: ["ea-credit-balance"] });
      qc.invalidateQueries({ queryKey: ["ea-credit-register"] });
      setState({ ...EMPTY, store_number: defaultStore });
      onSubmitted();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Submit failed."),
  });

  function set<K extends keyof State>(key: K, value: State[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!state.store_number.trim()) return setError("Store Name / Number is required.");
    if (!state.employee_name.trim()) return setError("Employee Full Name is required.");
    if (!state.hourly_wage.trim()) return setError("Hourly Wage is required.");
    if (!state.training_type.trim()) return setError("Please pick what the request is for.");
    if (!state.start_date.trim()) return setError("Start Date is required.");
    if (!state.last_day_date.trim()) return setError("Last Training Day is required.");
    if (state.last_day_date < state.start_date)
      return setError("Last Training Day can't be before the Start Date.");
    if (!state.training_days.length)
      return setError("Add at least one of the first three training days.");
    for (const d of state.training_days) {
      if (!d.start_time || !d.end_time)
        return setError(`Enter a start and end time for ${d.day}.`);
      const hrs = calcDayHours(d.start_time, d.end_time);
      // 0 hrs = same start & end time (overnight wraps now produce a real
      // positive number from calcDayHours, so this catches actual data errors).
      if (hrs <= 0)
        return setError(`${d.day}: end time can't be the same as the start time.`);
      if (hrs > 16)
        return setError(`${d.day}: that's over 16 hours — double-check the times.`);
    }

    submit.mutate({
      store_number: state.store_number,
      employee_name: state.employee_name,
      hourly_wage: state.hourly_wage,
      training_type: state.training_type,
      training_other: state.training_other,
      start_date: state.start_date,
      last_day_date: state.last_day_date,
      training_days: state.training_days,
      send_copy: state.send_copy,
    });
  }

  const wage = Number(state.hourly_wage) || 0;
  const total = state.training_days.reduce(
    (sum, d) => sum + calcDayHours(d.start_time, d.end_time) * wage,
    0
  );

  // Live bank balance for the picked store — warns before the server blocks
  // an overdraw. (Editing gives the request's own amount back, so the strict
  // check stays server-side.)
  const balanceQ = useQuery({
    queryKey: ["ea-credit-balance", state.store_number],
    queryFn: () => fetchCreditBalance(state.store_number),
    enabled: !!state.store_number.trim(),
    staleTime: 60_000,
  });
  const bal = balanceQ.data;
  const overdraws = !isEditing && bal != null && total > bal.remaining + 0.005;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="border-t-4 border-accent">
        <CardBody>
          <h3 className="text-sm font-semibold tracking-tight text-midnight">
            Training Credit Request
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Each store has a $2,000 annual budget for hourly team training. Requests are
            reviewed by the DO and RVP before funds are charged to the store's training
            budget.
          </p>
          {bal && (
            <p className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
              overdraws ? "bg-red-50 text-red-700 ring-red-200"
                : bal.remaining < bal.budget * 0.15 ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
              Store #{state.store_number}: {fmtUSD(bal.remaining)} of {fmtUSD(bal.budget)} training credit left for {bal.year}
              {overdraws ? ` — this request (${fmtUSD(total)}) overdraws it` : ""}
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StoreSelect
              id="tc-store"
              label="Store Name / Number"
              required
              value={state.store_number}
              onChange={(v) => set("store_number", v)}
              stores={stores}
            />
            <TextField
              id="tc-employee"
              label="Employee Full Name"
              required
              value={state.employee_name}
              onChange={(v) => set("employee_name", v)}
              helpText="Name of person that the request is being made for."
            />
            <NumberField
              id="tc-wage"
              label="Hourly Wage"
              required
              prefix="$"
              value={state.hourly_wage}
              onChange={(v) => set("hourly_wage", v)}
              helpText="Hourly wage the employee is receiving while in training."
            />
            <SelectField
              id="tc-type"
              label="What Training is this Request For?"
              required
              value={state.training_type}
              onChange={(v) => set("training_type", v)}
              options={TRAINING_TYPES}
            />
            <TextField
              id="tc-other"
              label="Other"
              value={state.training_other}
              onChange={(v) => set("training_other", v)}
              helpText="If you selected Other, describe the training."
            />
            <DateField
              id="tc-start"
              label="Start Date (Training Credit)"
              required
              value={state.start_date}
              onChange={(v) => set("start_date", v)}
              helpText="Date the team member will complete Day 1 orientation / first position."
            />
            <DateField
              id="tc-last-day"
              label="Last Training Day"
              required
              value={state.last_day_date}
              onChange={(v) => set("last_day_date", v)}
              helpText="Final training day — used to time the DO's closeout."
            />
            <TrainingDaysEditor
              label="First Three Training Days"
              required
              value={state.training_days}
              onChange={(v) => set("training_days", v)}
              wage={wage}
              helpText="Pick up to three days. Enter each day's start and end time — the credit per day is the hours worked times the hourly wage."
            />
          </div>

          <div className="mt-4 border-t border-zinc-100 pt-3">
            <CheckboxRow
              id="tc-copy"
              label="Send me a copy of my responses"
              checked={state.send_copy}
              onChange={(v) => set("send_copy", v)}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Requested credit amount
              </div>
              <div className="text-2xl font-semibold tracking-tight text-midnight tabular-nums">
                {fmtUSD(total)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {error && (
                <Badge tone="danger" className="max-w-xs whitespace-normal">
                  {error}
                </Badge>
              )}
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending
                  ? isEditing
                    ? "Resubmitting…"
                    : "Submitting…"
                  : isEditing
                    ? "Resubmit"
                    : "Submit request"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
