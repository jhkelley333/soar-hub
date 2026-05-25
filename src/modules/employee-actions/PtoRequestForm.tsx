import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyStores, submitPto } from "./api";
import { CheckboxRow, DateField, SelectField, StoreSelect, TextField } from "./formFields";
import type { PtoInput } from "./types";

// Half-day granularity up to three weeks of PTO.
const DAY_OPTIONS = Array.from({ length: 30 }, (_, i) => String((i + 1) * 0.5));

interface State {
  store_number: string;
  gm_name: string;
  pto_start_date: string;
  pto_end_date: string;
  days_used: string;
  send_copy: boolean;
}

const EMPTY: State = {
  store_number: "",
  gm_name: "",
  pto_start_date: "",
  pto_end_date: "",
  days_used: "",
  send_copy: false,
};

export function PtoRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
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
    mutationFn: (input: PtoInput) => submitPto(input),
    onSuccess: () => {
      toast.push("PTO request submitted — DO + RVP notified.", "success");
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

    if (!state.store_number.trim()) return setError("Store Number is required.");
    if (!state.gm_name.trim()) return setError("GM Name is required.");
    if (!state.pto_start_date.trim()) return setError("PTO Start Date is required.");
    if (!state.pto_end_date.trim()) return setError("PTO End Date is required.");
    if (state.pto_end_date < state.pto_start_date)
      return setError("PTO End Date cannot be before the Start Date.");
    if (!state.days_used.trim()) return setError("How Many Days PTO Used is required.");

    submit.mutate({
      store_number: state.store_number,
      gm_name: state.gm_name,
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
            GM Vacation Request &amp; Approval Tracker
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Submit vacation requests for approval to the Director of Operations (DO) and
            Regional Vice President (RVP). Submit at least 2–3 weeks in advance.
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
            <TextField
              id="pto-gm"
              label="GM Name"
              required
              value={state.gm_name}
              onChange={(v) => set("gm_name", v)}
            />
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
          </div>

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
