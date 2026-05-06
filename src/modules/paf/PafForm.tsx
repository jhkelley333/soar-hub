// Config-driven PAF submission form. Reads paf_form config (from
// netlify/functions/paf?action=config) and renders sections per the
// bindCat() logic locked in code. Cost preview computed live with
// the same formula the server uses on submit.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { fetchPafConfig, submitPaf, type PafSubmitInput } from "./api";
import { calcPafCost, formatUSD } from "./cost";
import type { PafConfigDoc, PafFieldDisplay } from "./types";

// Mirror of bindCat() in App Script Index.html — locked logic.
function visibleSections(category: string): Set<string> {
  const out = new Set<string>(["notes"]);
  const c = category.toLowerCase();
  const isBonus =
    c.includes("bonus") || c === "training" || c === "referral";
  const isPTO = c === "pto";
  const isIllness = c === "illness";
  const isTerm = c === "termination" || c === "final check";
  const isDemotion = c === "demotion";
  const isStore = c === "cross store work" || c === "transfer";
  const isTips =
    c === "pos adjustment" || c === "backpay" || c === "other";

  if (!isBonus && !isPTO && !isIllness && !isDemotion) out.add("pay");
  if (isTips || isStore) out.add("tips");
  if (isPTO) out.add("leave");
  if (isIllness) out.add("illness");
  if (isStore) out.add("store");
  if (isTerm) out.add("term");
  if (isDemotion) out.add("demotion");
  if (isBonus) out.add("bonus");
  return out;
}

// snake_case keys used in the DB / config.
type FormState = Record<string, string>;

function initialState(cfg: PafConfigDoc): FormState {
  const out: FormState = {};
  for (const k of Object.keys(cfg.fields)) out[k] = "";
  return out;
}

export function PafForm({ onSubmitted }: { onSubmitted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const cfgQuery = useQuery({
    queryKey: ["paf-config-active"],
    queryFn: fetchPafConfig,
    staleTime: 60_000,
  });

  const [state, setState] = useState<FormState>({});
  const [error, setError] = useState<string | null>(null);

  // Hydrate empty state once config arrives.
  useEffect(() => {
    if (cfgQuery.data && Object.keys(state).length === 0) {
      setState(initialState(cfgQuery.data.config_json));
    }
  }, [cfgQuery.data, state]);

  const cfg = cfgQuery.data?.config_json;

  const visible = useMemo(
    () => (cfg ? visibleSections(state.category ?? "") : new Set<string>()),
    [cfg, state.category]
  );

  const orderedSections = useMemo(() => {
    if (!cfg) return [];
    return [...cfg.sections].sort((a, b) => a.order - b.order);
  }, [cfg]);

  const fieldsBySection = useMemo(() => {
    const out: Record<string, [string, PafFieldDisplay][]> = {};
    if (!cfg) return out;
    for (const [key, f] of Object.entries(cfg.fields)) {
      if (!f.visible) continue;
      const sec = f.section || "top";
      (out[sec] ||= []).push([key, f]);
    }
    return out;
  }, [cfg]);

  const liveCost = useMemo(() => {
    return calcPafCost({
      reg_pay_rate: state.reg_pay_rate,
      reg_hours: state.reg_hours,
      ot_hours: state.ot_hours,
      cc_tips: state.cc_tips,
      declared_tips: state.declared_tips,
      pto_hours: state.pto_hours,
      illness_hours: state.illness_hours,
      final_check_hrs: state.final_check_hrs,
      spot_bonus_amt: state.spot_bonus_amt,
    });
  }, [state]);

  const submit = useMutation({
    mutationFn: (input: PafSubmitInput) => submitPaf(input),
    onSuccess: () => {
      toast.push("PAF submitted to Payroll.", "success");
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      if (cfg) setState(initialState(cfg));
      onSubmitted();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Submit failed."),
  });

  function patch(key: string, value: string) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cfg) return;

    // Required-field check based on the active config + section visibility.
    for (const [k, f] of Object.entries(cfg.fields)) {
      if (!f.visible || !f.required) continue;
      if (f.section !== "top" && f.section !== "notes" && !visible.has(f.section)) {
        // Field belongs to a section that isn't shown for this category.
        continue;
      }
      const v = state[k];
      if (v === undefined || String(v).trim() === "") {
        setError(`"${f.label}" is required.`);
        return;
      }
    }

    if (!/^\d{4}$/.test(String(state.last4_ssn ?? ""))) {
      setError("Last 4 SSN must be 4 digits.");
      return;
    }

    submit.mutate(state as unknown as PafSubmitInput);
  }

  if (cfgQuery.isLoading) {
    return (
      <Card>
        <CardBody>Loading PAF form…</CardBody>
      </Card>
    );
  }

  if (cfgQuery.isError || !cfg) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-red-700">
            Couldn't load form config. Make sure migration 0015 ran.
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Top-of-form fields */}
      <FormSection title="New Payroll Adjustment" intent="hero">
        <FieldGrid
          fields={fieldsBySection.top ?? []}
          state={state}
          onChange={patch}
          categories={cfg.lists.categories}
        />
      </FormSection>

      {/* Conditional sections in their configured order */}
      {orderedSections
        .filter((s) => s.key !== "notes" && visible.has(s.key))
        .map((s) => (
          <FormSection key={s.key} title={s.title} description={s.description}>
            <FieldGrid
              fields={fieldsBySection[s.key] ?? []}
              state={state}
              onChange={patch}
              positions={cfg.lists.positions}
              bonusTypes={cfg.lists.bonusTypes}
              termTypes={cfg.lists.termTypes}
            />
          </FormSection>
        ))}

      {/* Notes — always shown */}
      <FormSection
        title={
          orderedSections.find((s) => s.key === "notes")?.title ?? "Notes"
        }
      >
        <FieldGrid
          fields={fieldsBySection.notes ?? []}
          state={state}
          onChange={patch}
        />
      </FormSection>

      {/* Live cost + submit */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Estimated cost
              </div>
              <div className="text-2xl font-semibold tracking-tight text-midnight tabular-nums">
                {formatUSD(liveCost)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {error && (
                <Badge tone="danger" className="max-w-xs whitespace-normal">
                  {error}
                </Badge>
              )}
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending ? "Submitting…" : "Submit PAF to Payroll"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function FormSection({
  title,
  description,
  intent,
  children,
}: {
  title: string;
  description?: string;
  intent?: "hero";
  children: React.ReactNode;
}) {
  return (
    <Card className={intent === "hero" ? "border-t-4 border-accent" : undefined}>
      <CardBody>
        <h3 className="text-sm font-semibold tracking-tight text-midnight">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
        )}
        <div className="mt-3">{children}</div>
      </CardBody>
    </Card>
  );
}

function FieldGrid({
  fields,
  state,
  onChange,
  categories,
  positions,
  bonusTypes,
  termTypes,
}: {
  fields: [string, PafFieldDisplay][];
  state: FormState;
  onChange: (key: string, value: string) => void;
  categories?: string[];
  positions?: string[];
  bonusTypes?: string[];
  termTypes?: string[];
}) {
  if (!fields.length) {
    return <div className="text-xs text-zinc-400">(no fields)</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {fields.map(([k, f]) => (
        <FieldRender
          key={k}
          fieldKey={k}
          cfg={f}
          value={state[k] ?? ""}
          onChange={(v) => onChange(k, v)}
          categories={categories}
          positions={positions}
          bonusTypes={bonusTypes}
          termTypes={termTypes}
        />
      ))}
    </div>
  );
}

function FieldRender({
  fieldKey,
  cfg,
  value,
  onChange,
  categories,
  positions,
  bonusTypes,
  termTypes,
}: {
  fieldKey: string;
  cfg: PafFieldDisplay;
  value: string;
  onChange: (v: string) => void;
  categories?: string[];
  positions?: string[];
  bonusTypes?: string[];
  termTypes?: string[];
}) {
  const id = `paf-${fieldKey}`;
  const label = (
    <Label htmlFor={id}>
      {cfg.label}
      {cfg.required && <span className="ml-0.5 text-red-600">*</span>}
    </Label>
  );

  // Fields that map to a select dropdown.
  if (fieldKey === "category" && categories) {
    return (
      <div>
        {label}
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">{cfg.placeholder || "Select..."}</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
      </div>
    );
  }
  if (fieldKey === "job_position" && positions) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={positions}
        placeholder={cfg.placeholder}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "bonus_type" && bonusTypes) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={bonusTypes}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "term_demotion" && termTypes) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={termTypes}
        placeholder={cfg.placeholder}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "termed_in_tr") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={["Yes", "No", "N/A"]}
        placeholder={cfg.placeholder}
        helpText={cfg.helpText}
      />
    );
  }

  // Date inputs
  if (fieldKey === "pay_period_end" || fieldKey === "last_day_worked") {
    return (
      <div>
        {label}
        <Input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
      </div>
    );
  }

  // Numeric inputs
  if (
    [
      "reg_pay_rate",
      "reg_hours",
      "ot_hours",
      "cc_tips",
      "declared_tips",
      "pto_hours",
      "illness_hours",
      "final_check_hrs",
      "spot_bonus_amt",
    ].includes(fieldKey)
  ) {
    return (
      <div>
        {label}
        <Input
          id={id}
          type="number"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cfg.placeholder}
        />
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
      </div>
    );
  }

  // Long text
  if (fieldKey === "explanation" || fieldKey === "approval_notes") {
    return (
      <div className="sm:col-span-3">
        {label}
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cfg.placeholder}
          className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
      </div>
    );
  }

  // Default: text input
  return (
    <div>
      {label}
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={cfg.placeholder}
        maxLength={fieldKey === "last4_ssn" ? 4 : undefined}
        inputMode={fieldKey === "last4_ssn" ? "numeric" : undefined}
      />
      {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  helpText,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  helpText?: string;
}) {
  return (
    <div>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">{placeholder || "Select..."}</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      {helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{helpText}</p>}
    </div>
  );
}
