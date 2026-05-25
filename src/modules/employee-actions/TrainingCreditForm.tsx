import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyStores, submitTrainingCredit } from "./api";
import {
  CheckboxRow,
  DateField,
  DayPicker,
  NumberField,
  SelectField,
  StoreSelect,
  TextField,
} from "./formFields";
import type { TrainingCreditInput } from "./types";

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
  requested_amount: string;
  training_days: string[];
  send_copy: boolean;
}

const EMPTY: State = {
  store_number: "",
  employee_name: "",
  hourly_wage: "",
  training_type: "",
  training_other: "",
  start_date: "",
  requested_amount: "",
  training_days: [],
  send_copy: false,
};

export function TrainingCreditForm({ onSubmitted }: { onSubmitted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<State>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const storesQuery = useQuery({
    queryKey: ["ea-my-stores"],
    queryFn: fetchMyStores,
    staleTime: 5 * 60_000,
  });
  const stores = useMemo(() => storesQuery.data?.stores ?? [], [storesQuery.data]);

  const submit = useMutation({
    mutationFn: (input: TrainingCreditInput) => submitTrainingCredit(input),
    onSuccess: () => {
      toast.push("Training credit request submitted — DO + RVP notified.", "success");
      qc.invalidateQueries({ queryKey: ["ea-list"] });
      setState(EMPTY);
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
    if (!state.requested_amount.trim()) return setError("Requested Credit Amount is required.");
    if (!state.training_days.length)
      return setError("Select the first three training days.");

    submit.mutate({
      store_number: state.store_number,
      employee_name: state.employee_name,
      hourly_wage: state.hourly_wage,
      training_type: state.training_type,
      training_other: state.training_other,
      start_date: state.start_date,
      requested_amount: state.requested_amount,
      training_days: state.training_days,
      send_copy: state.send_copy,
    });
  }

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
            <NumberField
              id="tc-amount"
              label="Requested Credit Amount ($$$)"
              required
              prefix="$"
              value={state.requested_amount}
              onChange={(v) => set("requested_amount", v)}
            />
            <DayPicker
              label="First Three Training Days"
              required
              value={state.training_days}
              onChange={(v) => set("training_days", v)}
              helpText="Choose the first three days of training. Choose all that apply."
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            {error && (
              <Badge tone="danger" className="max-w-xs whitespace-normal">
                {error}
              </Badge>
            )}
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
