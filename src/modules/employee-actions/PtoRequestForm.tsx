import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { fetchMyStores, submitPto } from "./api";
import {
  CheckboxRow,
  DateField,
  NumberField,
  pickDefaultStoreNumber,
  SelectField,
  StoreSelect,
  TextField,
  VacationHoursEditor,
} from "./formFields";
import type { PtoInput, PtoVacationDayInput } from "./types";

const POSITIONS = ["GM", "Associate Manager", "First Assistant"];
const WEEKLY_HOUR_CAP = 40;
const MAX_HOURS_PER_DAY = 8;

// Half-day granularity up to three weeks of PTO (GM day-based path).
const DAY_OPTIONS = Array.from({ length: 30 }, (_, i) => String((i + 1) * 0.5));

function fmtUSD(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function isHourlyPosition(p: string): boolean {
  return p === "Associate Manager" || p === "First Assistant";
}

interface State {
  store_number: string;
  employee_name: string;
  position: string;
  // GM path
  pto_start_date: string;
  pto_end_date: string;
  days_used: string;
  // Hourly path
  hourly_wage: string;
  vacation_days: PtoVacationDayInput[];
  hours_worked: string;
  send_copy: boolean;
}

const EMPTY: State = {
  store_number: "",
  employee_name: "",
  position: "",
  pto_start_date: "",
  pto_end_date: "",
  days_used: "",
  hourly_wage: "",
  vacation_days: [],
  hours_worked: "",
  send_copy: false,
};

export function PtoRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const myName = profile?.preferred_name || profile?.full_name || "";
  const [state, setState] = useState<State>(EMPTY);
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
    mutationFn: (input: PtoInput) => submitPto(input),
    onSuccess: () => {
      toast.push("PTO request submitted — DO + RVP notified.", "success");
      qc.invalidateQueries({ queryKey: ["ea-list"] });
      setState({ ...EMPTY, store_number: defaultStore });
      onSubmitted();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Submit failed."),
  });

  function set<K extends keyof State>(key: K, value: State[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  // Selecting GM auto-fills the employee name with the signed-in user's name
  // (the GM is filing for themselves). Still editable afterward.
  function setPosition(value: string) {
    setState((prev) => ({
      ...prev,
      position: value,
      employee_name:
        value === "GM" && !prev.employee_name.trim() ? myName : prev.employee_name,
    }));
  }

  const hourly = isHourlyPosition(state.position);
  const wage = Number(state.hourly_wage) || 0;
  const vacationHours = state.vacation_days.reduce((s, d) => s + (Number(d.hours) || 0), 0);
  const vacationAmount = vacationHours * wage;
  const hoursWorked = Number(state.hours_worked) || 0;
  const weekTotal = vacationHours + hoursWorked;
  const over40 = weekTotal > WEEKLY_HOUR_CAP;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!state.store_number.trim()) return setError("Store Number is required.");
    if (!state.employee_name.trim()) return setError("Employee Name is required.");
    if (!state.position.trim()) return setError("Position is required.");

    if (hourly) {
      if (!state.hourly_wage.trim()) return setError("Hourly Wage is required.");
      if (!state.vacation_days.length)
        return setError("Add at least one vacation day with hours.");
      for (const d of state.vacation_days) {
        if (!d.date) return setError("Each vacation day needs a date.");
        const h = Number(d.hours) || 0;
        if (h <= 0) return setError(`Enter hours for ${d.date}.`);
        if (h > MAX_HOURS_PER_DAY)
          return setError(`${d.date}: a vacation day can't exceed ${MAX_HOURS_PER_DAY} hours.`);
      }
      if (over40)
        return setError(
          `Vacation (${vacationHours}h) + hours worked (${hoursWorked}h) exceeds the ${WEEKLY_HOUR_CAP}-hour weekly limit.`
        );

      submit.mutate({
        store_number: state.store_number,
        employee_name: state.employee_name,
        position: state.position,
        hourly_wage: state.hourly_wage,
        vacation_days: state.vacation_days,
        hours_worked: state.hours_worked,
        send_copy: state.send_copy,
      });
      return;
    }

    // GM path
    if (!state.pto_start_date.trim()) return setError("PTO Start Date is required.");
    if (!state.pto_end_date.trim()) return setError("PTO End Date is required.");
    if (state.pto_end_date < state.pto_start_date)
      return setError("PTO End Date cannot be before the Start Date.");
    if (!state.days_used.trim()) return setError("How Many Days PTO Used is required.");

    submit.mutate({
      store_number: state.store_number,
      employee_name: state.employee_name,
      position: state.position,
      pto_start_date: state.pto_start_date,
      pto_end_date: state.pto_end_date,
      days_used: state.days_used,
      send_copy: state.send_copy,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="border-t-4 border-accent">
        <CardBody>
          <h3 className="text-sm font-semibold tracking-tight text-midnight">
            Vacation Request &amp; Approval Tracker
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Submit vacation requests for approval to the Director of Operations (DO) and
            Regional Vice President (RVP). Submit at least 2–3 weeks in advance. GMs are
            tracked by days; hourly managers are tracked by hours (max {MAX_HOURS_PER_DAY}/day).
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StoreSelect
              id="pto-store"
              label="Store Number"
              required
              value={state.store_number}
              onChange={(v) => set("store_number", v)}
              stores={stores}
            />
            <SelectField
              id="pto-position"
              label="Position"
              required
              value={state.position}
              onChange={setPosition}
              options={POSITIONS}
            />
            <TextField
              id="pto-employee"
              label="Employee Name"
              required
              value={state.employee_name}
              onChange={(v) => set("employee_name", v)}
            />

            {state.position && !hourly && (
              <>
                <DateField
                  id="pto-start"
                  label="PTO Start Date"
                  required
                  value={state.pto_start_date}
                  onChange={(v) => set("pto_start_date", v)}
                />
                <DateField
                  id="pto-end"
                  label="PTO End Date"
                  required
                  value={state.pto_end_date}
                  onChange={(v) => set("pto_end_date", v)}
                />
                <SelectField
                  id="pto-days"
                  label="How Many Days PTO Used"
                  required
                  value={state.days_used}
                  onChange={(v) => set("days_used", v)}
                  options={DAY_OPTIONS}
                />
              </>
            )}

            {hourly && (
              <>
                <NumberField
                  id="pto-wage"
                  label="Hourly Wage"
                  required
                  prefix="$"
                  value={state.hourly_wage}
                  onChange={(v) => set("hourly_wage", v)}
                  helpText="Used to cost the vacation hours."
                />
                <NumberField
                  id="pto-worked"
                  label="Hours Worked This Week"
                  required
                  step="0.5"
                  value={state.hours_worked}
                  onChange={(v) => set("hours_worked", v)}
                  helpText={`Vacation + worked can't exceed ${WEEKLY_HOUR_CAP} hrs/week.`}
                />
                <VacationHoursEditor
                  label="Vacation Days (hourly)"
                  required
                  value={state.vacation_days}
                  onChange={(v) => set("vacation_days", v)}
                  wage={wage}
                  helpText={`Add each vacation day and its hours (max ${MAX_HOURS_PER_DAY}/day). Amount = hours × wage.`}
                />
              </>
            )}
          </div>

          {hourly && state.vacation_days.length > 0 && (
            <div
              className={
                "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm " +
                (over40
                  ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                  : "bg-zinc-50 text-zinc-600")
              }
            >
              <span>
                Week total: <span className="font-semibold tabular-nums">{weekTotal}</span> hrs
                {" "}({vacationHours} vacation + {hoursWorked} worked) of {WEEKLY_HOUR_CAP}
              </span>
              {over40 && <span className="font-semibold">Over the 40-hour limit</span>}
            </div>
          )}

          <div className="mt-4 border-t border-zinc-100 pt-3">
            <CheckboxRow
              id="pto-copy"
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
              {hourly ? (
                <>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    Vacation amount
                  </div>
                  <div className="text-2xl font-semibold tracking-tight text-midnight tabular-nums">
                    {fmtUSD(vacationAmount)}
                  </div>
                </>
              ) : (
                <div className="text-xs text-zinc-400">
                  GM vacation is tracked by days (no dollar amount).
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {error && (
                <Badge tone="danger" className="max-w-xs whitespace-normal">
                  {error}
                </Badge>
              )}
              <Button type="submit" disabled={submit.isPending || over40}>
                {submit.isPending ? "Submitting…" : "Submit request"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
