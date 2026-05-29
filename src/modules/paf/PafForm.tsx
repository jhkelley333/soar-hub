// Config-driven PAF submission form. Reads paf_form config (from
// netlify/functions/paf?action=config) and renders sections per the
// bindCat() logic locked in code. Cost preview computed live with
// the same formula the server uses on submit.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyStores, fetchPafConfig, submitPaf, type PafSubmitInput } from "./api";
import { calcPafCost, formatUSD } from "./cost";
import type { MyStore, PafConfigDoc, PafFieldDisplay, ReferralTier } from "./types";

// Mirror of bindCat() — locked logic. Returns the set of section keys
// visible for the current form state. Branches on category and
// bonus_type so the bonus sub-section reveals after the user picks a
// type.
function visibleSections(category: string, bonusType: string): Set<string> {
  const out = new Set<string>(["notes"]);
  const c = category.trim();

  if (c === "Bonus") {
    out.add("bonus");
    const bt = bonusType.trim();
    if (bt === "Spot Bonus") out.add("bonus_spot");
    else if (bt === "Training") out.add("bonus_training");
    else if (bt === "Referral") out.add("bonus_referral");
    return out;
  }

  if (c === "PTO") {
    out.add("leave");
    return out;
  }
  if (c === "Illness") {
    out.add("illness");
    return out;
  }
  if (c === "Demotion") {
    out.add("demotion");
    return out;
  }
  if (c === "Transfer") {
    out.add("transfer");
    return out;
  }
  if (c === "Termination") {
    out.add("term");
    return out;
  }
  if (c === NEW_HIRE_LEADER) {
    // Notes only from config; the custom salary-leader block renders the rest.
    return out;
  }
  if (c === "Cross Store Work") {
    out.add("tips");
    out.add("store");
    out.add("pay");
    return out;
  }
  if (c === "POS Adjustment" || c === "Backpay") {
    out.add("tips");
    out.add("pay");
    return out;
  }
  // Default fallback (shouldn't be hit with the locked category list).
  if (c) out.add("pay");
  return out;
}

// Read either the new `sections` array or the legacy `section` string
// so older config_versions still render.
function fieldSections(f: PafFieldDisplay): string[] {
  if (Array.isArray(f.sections) && f.sections.length) return f.sections;
  if (typeof f.section === "string" && f.section) return [f.section];
  return [];
}

// New, code-driven category (its fields are custom-rendered, not config).
const NEW_HIRE_LEADER = "New Hire (Salary Leader)";
const NH_ROLES = ["GM", "DO", "SDO"];
const NH_INPUT =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

function NhField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      {children}
    </div>
  );
}

// snake_case keys used in the DB / config.
type FormState = Record<string, string>;

function initialState(cfg: PafConfigDoc): FormState {
  const out: FormState = {};
  for (const k of Object.keys(cfg.fields)) out[k] = "";
  return out;
}

// Field-level visibility that goes beyond section visibility:
//   - reg_pay_rate hides when pay_basis === Salary
//   - new_location hides when location_change !== Yes
function isFieldVisibleForState(fieldKey: string, state: FormState): boolean {
  // New Hire (Salary Leader) has its own custom section that collects
  // identity + pay-period details, so suppress every standard field
  // except the category picker to avoid duplicate data entry.
  if (state.category === NEW_HIRE_LEADER) {
    return fieldKey === "category";
  }
  if (fieldKey === "reg_pay_rate") {
    return state.pay_basis !== "Salary";
  }
  if (fieldKey === "new_location") {
    return state.location_change === "Yes";
  }
  return true;
}

export function PafForm({ onSubmitted }: { onSubmitted: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const cfgQuery = useQuery({
    queryKey: ["paf-config-active"],
    queryFn: fetchPafConfig,
    staleTime: 60_000,
  });

  const storesQuery = useQuery({
    queryKey: ["paf-my-stores"],
    queryFn: fetchMyStores,
    staleTime: 5 * 60_000,
  });
  const myStores = storesQuery.data?.stores ?? [];

  const [state, setState] = useState<FormState>({});
  const [error, setError] = useState<string | null>(null);

  // Distinct DO "markets" (districts) and SDO areas the submitter can
  // reach, derived from their visible stores. Powers the New Hire pickers.
  const nhDistricts = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of myStores) {
      if (s.district_id) m.set(s.district_id, s.district_name ?? s.district_id);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [myStores]);

  const nhAreas = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of myStores) {
      if (s.area_id) m.set(s.area_id, s.area_name ?? s.area_id);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [myStores]);

  // Stores auto-populated by the current market/area selection.
  const nhSelectedStores = useMemo(() => {
    if (state.nh_role === "DO" && state.nh_district_id) {
      return myStores.filter((s) => s.district_id === state.nh_district_id);
    }
    if (state.nh_role === "SDO" && state.nh_area_id) {
      return myStores.filter((s) => s.area_id === state.nh_area_id);
    }
    return [];
  }, [state.nh_role, state.nh_district_id, state.nh_area_id, myStores]);

  // Hydrate state once when config first arrives. The previous
  // implementation gated on `Object.keys(state).length === 0` and
  // included `state` in deps — fragile because (a) the moment a
  // config field has a non-empty default, the gate is true forever
  // and the effect never fires; (b) including `state` in deps trips
  // strict-mode infinite-render detection if initialState ever
  // returns {}. A ref guard runs the hydration exactly once per
  // mount, regardless of state shape.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!cfgQuery.data || hydratedRef.current) return;
    hydratedRef.current = true;
    setState(initialState(cfgQuery.data.config_json));
  }, [cfgQuery.data]);

  const cfg = cfgQuery.data?.config_json;

  const visible = useMemo(
    () =>
      cfg
        ? visibleSections(state.category ?? "", state.bonus_type ?? "")
        : new Set<string>(),
    [cfg, state.category, state.bonus_type]
  );

  const orderedSections = useMemo(() => {
    if (!cfg) return [];
    return [...cfg.sections].sort((a, b) => a.order - b.order);
  }, [cfg]);

  // Bucket fields by every section they belong to so shared fields
  // (current_pay_rate, new_pay_rate) appear under both Transfer and
  // Demotion when their section is visible.
  const fieldsBySection = useMemo(() => {
    const out: Record<string, [string, PafFieldDisplay][]> = {};
    if (!cfg) return out;
    for (const [key, f] of Object.entries(cfg.fields)) {
      if (!f.visible) continue;
      const secs = fieldSections(f);
      const buckets = secs.length ? secs : ["top"];
      for (const sec of buckets) {
        (out[sec] ||= []).push([key, f]);
      }
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
      spot_bonus_amt: state.spot_bonus_amt,
      training_bonus_amt: state.training_bonus_amt,
      referral_bonus_amt: state.referral_bonus_amt,
      pay_basis: (state.pay_basis ?? "").toLowerCase(),
    });
  }, [state]);

  const submit = useMutation({
    mutationFn: (input: PafSubmitInput) => submitPaf(input),
    onSuccess: (res) => {
      toast.push(
        res.status === "Pending SDO Approval"
          ? "Bonus PAF submitted — awaiting SDO approval."
          : "PAF submitted to Payroll.",
        "success"
      );
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      qc.invalidateQueries({ queryKey: ["paf-sdo-queue"] });
      if (cfg) setState(initialState(cfg));
      onSubmitted();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Submit failed."),
  });

  function patch(key: string, value: string) {
    setState((prev) => {
      const next = { ...prev, [key]: value };
      // Pay Basis -> Salary clears Reg Pay Rate so a stale value can't
      // sneak into estimated_cost.
      if (key === "pay_basis" && value === "Salary") {
        next.reg_pay_rate = "";
      }
      // Location Change -> No clears New Location.
      if (key === "location_change" && value !== "Yes") {
        next.new_location = "";
      }
      // Category / Bonus Type changes clear the now-irrelevant sub-fields
      // so we don't ship hidden state on submit.
      if (key === "category") {
        // Reset bonus_type so picking Bonus shows an empty sub-form.
        next.bonus_type = "";
      }
      // Referral Tier auto-fill — picking a tier writes the tier's amount
      // into referral_bonus_amt. Editable afterward.
      if (key === "referral_tier" && cfg?.lists.referralTiers) {
        const tier = cfg.lists.referralTiers.find((t) => t.label === value);
        if (tier) next.referral_bonus_amt = String(tier.amount);
      }
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cfg) return;

    if (state.category === NEW_HIRE_LEADER) {
      // This category's fields are custom-rendered, so validate them
      // directly (bypassing the config-field loop, which would otherwise
      // enforce unrelated fields like the standard store picker).
      const req: Array<[string, string]> = [
        ["nh_role", "Role"],
        ["employee_name", "Employee name"],
        ["nh_start_date", "Start date"],
        ["pay_period_end", "Pay period end"],
        ["nh_hours_last_period", "Hours worked last pay period"],
      ];
      for (const [k, lbl] of req) {
        if (String(state[k] ?? "").trim() === "") {
          setError(`"${lbl}" is required.`);
          return;
        }
      }
      if (state.nh_role === "GM" && String(state.nh_home_store ?? "").trim() === "") {
        setError('"Home store" is required for a GM.');
        return;
      }
      if (
        state.nh_role === "DO" &&
        state.nh_no_market !== "yes" &&
        String(state.nh_district_id ?? "").trim() === ""
      ) {
        setError('Select a market (district), or check "No market yet".');
        return;
      }
      if (
        state.nh_role === "SDO" &&
        state.nh_no_market !== "yes" &&
        String(state.nh_area_id ?? "").trim() === ""
      ) {
        setError('Select an area, or check "No market yet".');
        return;
      }
    } else {
      // Required-field check, gated by section visibility AND field
      // visibility (so hidden conditional fields don't block submit).
      for (const [k, f] of Object.entries(cfg.fields)) {
        if (!f.visible || !f.required) continue;
        const secs = fieldSections(f);
        const inVisibleSection =
          secs.length === 0 ||
          secs.includes("top") ||
          secs.includes("notes") ||
          secs.some((s) => visible.has(s));
        if (!inVisibleSection) continue;
        if (!isFieldVisibleForState(k, state)) continue;
        const v = state[k];
        if (v === undefined || String(v).trim() === "") {
          setError(`"${f.label}" is required.`);
          return;
        }
      }
    }

    if (!/^\d{4}$/.test(String(state.last4_ssn ?? ""))) {
      setError("Last 4 SSN must be 4 digits.");
      return;
    }

    // Map UI's "Hourly" / "Salary" radio to the lowercase value the
    // backend expects.
    const payload: FormState = { ...state };
    if (payload.pay_basis) payload.pay_basis = payload.pay_basis.toLowerCase();

    // Snapshot the New Hire market/area + its stores for the record. The
    // form tracks the selection by id; resolve to names + store numbers so
    // the PAF carries a permanent record independent of the viewer's scope.
    if (state.category === NEW_HIRE_LEADER && state.nh_no_market !== "yes") {
      if (state.nh_role === "DO") {
        payload.nh_market = nhDistricts.find((d) => d.id === state.nh_district_id)?.name ?? "";
        payload.nh_stores = nhSelectedStores.map((s) => s.number).join(", ");
      } else if (state.nh_role === "SDO") {
        payload.nh_area = nhAreas.find((a) => a.id === state.nh_area_id)?.name ?? "";
        payload.nh_stores = nhSelectedStores.map((s) => s.number).join(", ");
      }
    }

    submit.mutate(payload as unknown as PafSubmitInput);
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
            Couldn't load form config. Make sure migrations 0015–0019 ran.
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pb-24 sm:pb-4">
      {/* Top-of-form fields */}
      <FormSection title="New Payroll Adjustment" intent="hero">
        <FieldGrid
          fields={(fieldsBySection.top ?? []).filter(([k]) =>
            isFieldVisibleForState(k, state)
          )}
          state={state}
          onChange={patch}
          cfg={cfg}
          myStores={myStores}
        />
      </FormSection>

      {/* Conditional sections in their configured order */}
      {orderedSections
        .filter((s) => s.key !== "notes" && visible.has(s.key))
        .map((s) => (
          <FormSection key={s.key} title={s.title} description={s.description}>
            <FieldGrid
              fields={(fieldsBySection[s.key] ?? []).filter(([k]) =>
                isFieldVisibleForState(k, state)
              )}
              state={state}
              onChange={patch}
              cfg={cfg}
              myStores={myStores}
            />
          </FormSection>
        ))}

      {/* New Hire (Salary Leader) — custom, role-conditional section. */}
      {state.category === NEW_HIRE_LEADER && (
        <FormSection
          title="New Hire — Salary Leader"
          description="Role, identity, and pay-period details for a new salaried leader."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NhField label="Role *">
              <select
                value={state.nh_role ?? ""}
                onChange={(e) => patch("nh_role", e.target.value)}
                className={NH_INPUT}
              >
                <option value="">Select role…</option>
                {NH_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </NhField>

            <NhField label="Employee name *">
              <input
                value={state.employee_name ?? ""}
                onChange={(e) => patch("employee_name", e.target.value)}
                className={NH_INPUT}
                placeholder="Full name"
              />
            </NhField>

            <NhField label="Last 4 SSN *">
              <input
                value={state.last4_ssn ?? ""}
                onChange={(e) => patch("last4_ssn", e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                className={NH_INPUT}
                placeholder="1234"
              />
            </NhField>

            <NhField label="Start date *">
              <input
                type="date"
                value={state.nh_start_date ?? ""}
                onChange={(e) => patch("nh_start_date", e.target.value)}
                className={NH_INPUT}
              />
            </NhField>

            <NhField label="Hours worked last pay period *">
              <input
                type="number"
                min="0"
                step="0.25"
                value={state.nh_hours_last_period ?? ""}
                onChange={(e) => patch("nh_hours_last_period", e.target.value)}
                className={NH_INPUT}
                placeholder="e.g. 80"
              />
            </NhField>

            <NhField label="Pay period end *">
              <input
                type="date"
                value={state.pay_period_end ?? ""}
                onChange={(e) => patch("pay_period_end", e.target.value)}
                className={NH_INPUT}
              />
            </NhField>

            {state.nh_role === "GM" && (
              <NhField label="Home store *">
                <select
                  value={state.nh_home_store ?? ""}
                  onChange={(e) => patch("nh_home_store", e.target.value)}
                  className={NH_INPUT}
                >
                  <option value="">Select store…</option>
                  {myStores.map((s) => (
                    <option key={s.id} value={String(s.number)}>
                      {s.number}{s.name ? ` — ${s.name}` : ""}
                    </option>
                  ))}
                </select>
              </NhField>
            )}
          </div>

          {(state.nh_role === "DO" || state.nh_role === "SDO") && (
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={state.nh_no_market === "yes"}
                  onChange={(e) => patch("nh_no_market", e.target.checked ? "yes" : "")}
                  className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
                />
                No market yet (plus-one / in training)
              </label>

              {state.nh_no_market !== "yes" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {state.nh_role === "DO" ? (
                    <NhField label="Market (district) *">
                      <select
                        value={state.nh_district_id ?? ""}
                        onChange={(e) => patch("nh_district_id", e.target.value)}
                        className={NH_INPUT}
                      >
                        <option value="">Select market…</option>
                        {nhDistricts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </NhField>
                  ) : (
                    <NhField label="Area *">
                      <select
                        value={state.nh_area_id ?? ""}
                        onChange={(e) => patch("nh_area_id", e.target.value)}
                        className={NH_INPUT}
                      >
                        <option value="">Select area…</option>
                        {nhAreas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </NhField>
                  )}
                </div>
              )}

              {state.nh_no_market !== "yes" && nhSelectedStores.length > 0 && (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <p className="mb-1 text-xs font-medium text-zinc-600">
                    Stores in this {state.nh_role === "DO" ? "market" : "area"} (
                    {nhSelectedStores.length})
                  </p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700">
                    {nhSelectedStores.map((s) => (
                      <li key={s.id}>
                        #{s.number}
                        {s.name ? ` — ${s.name}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Shown for reference — no store access is assigned from this PAF.
                  </p>
                </div>
              )}
            </div>
          )}
        </FormSection>
      )}

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
          cfg={cfg}
          myStores={myStores}
        />
      </FormSection>

      {/* Cost + submit. Inline on desktop; sticky bottom bar on mobile so
          the user never has to scroll to find Submit on a long form. */}
      <div className="hidden sm:block">
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
                  {submit.isPending ? "Submitting…" : "Submit PAF"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white px-4 py-3 shadow-[0_-4px_8px_-4px_rgba(0,0,0,0.08)] sm:hidden">
        {error && (
          <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Estimated
            </div>
            <div className="text-lg font-semibold tracking-tight text-midnight tabular-nums">
              {formatUSD(liveCost)}
            </div>
          </div>
          <Button
            type="submit"
            disabled={submit.isPending}
            className="h-11 px-5 text-sm"
          >
            {submit.isPending ? "Submitting…" : "Submit PAF"}
          </Button>
        </div>
      </div>
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
  cfg,
  myStores,
}: {
  fields: [string, PafFieldDisplay][];
  state: FormState;
  onChange: (key: string, value: string) => void;
  cfg: PafConfigDoc;
  myStores: MyStore[];
}) {
  if (!fields.length) {
    return <div className="text-xs text-zinc-400">(no fields)</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(([k, f]) => (
        <FieldRender
          key={k}
          fieldKey={k}
          cfg={f}
          value={state[k] ?? ""}
          onChange={(v) => onChange(k, v)}
          lists={cfg.lists}
          myStores={myStores}
        />
      ))}
    </div>
  );
}

const NUMERIC_KEYS = new Set([
  "reg_pay_rate",
  "reg_hours",
  "ot_hours",
  "cc_tips",
  "declared_tips",
  "pto_hours",
  "illness_hours",
  "spot_bonus_amt",
  "training_bonus_amt",
  "training_days",
  "referral_bonus_amt",
  "current_pay_rate",
  "new_pay_rate",
]);

const DATE_KEYS = new Set([
  "pay_period_end",
  "last_day_worked",
  "referral_start_date",
]);

function FieldRender({
  fieldKey,
  cfg,
  value,
  onChange,
  lists,
  readOnly,
  myStores,
}: {
  fieldKey: string;
  cfg: PafFieldDisplay;
  value: string;
  onChange: (v: string) => void;
  lists: PafConfigDoc["lists"];
  readOnly?: boolean;
  myStores: MyStore[];
}) {
  const id = `paf-${fieldKey}`;
  const label = (
    <Label htmlFor={id}>
      {cfg.label}
      {cfg.required && <span className="ml-0.5 text-red-600">*</span>}
    </Label>
  );

  // Drive-In #: dropdown of stores the user has scope to. Falls back to a
  // text input if the store list is empty (admin without stores in DB,
  // or a fetch failure — server still validates the value on submit).
  if (fieldKey === "drive_in") {
    if (!myStores.length) {
      return (
        <div>
          {label}
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={cfg.placeholder}
          />
          {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
        </div>
      );
    }
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
          {myStores.map((s) => (
            <option key={s.id} value={String(s.number)}>
              #{s.number}
              {s.name ? ` — ${s.name}` : ""}
            </option>
          ))}
        </select>
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
      </div>
    );
  }

  // Dropdown special-cases driven by which list the field reads from.
  if (fieldKey === "category") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={
          lists.categories.includes(NEW_HIRE_LEADER)
            ? lists.categories
            : [...lists.categories, NEW_HIRE_LEADER]
        }
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "pay_basis") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={lists.payBases ?? ["Hourly", "Salary"]}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "bonus_type") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={lists.bonusTypes}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (
    fieldKey === "job_position" ||
    fieldKey === "current_position" ||
    fieldKey === "new_position" ||
    fieldKey === "from_role" ||
    fieldKey === "new_role"
  ) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={lists.positions}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "referral_tier") {
    const tiers: ReferralTier[] = lists.referralTiers ?? [];
    const tierLabels = tiers.map(
      (t) => `${t.label} ($${t.amount.toFixed(0)})`
    );
    // Display tier with amount appended, but persist just the label.
    const selectedIdx = tiers.findIndex((t) => t.label === value);
    return (
      <Select
        id={id}
        label={label}
        value={selectedIdx >= 0 ? tierLabels[selectedIdx] : ""}
        onChange={(v) => {
          const idx = tierLabels.indexOf(v);
          onChange(idx >= 0 ? tiers[idx].label : "");
        }}
        options={tierLabels}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }
  if (fieldKey === "termed_in_tr" || fieldKey === "location_change") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={["Yes", "No"]}
        placeholder={cfg.placeholder || "Select..."}
        helpText={cfg.helpText}
      />
    );
  }

  // Date inputs
  if (DATE_KEYS.has(fieldKey)) {
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
  if (NUMERIC_KEYS.has(fieldKey)) {
    return (
      <div>
        {label}
        <Input
          id={id}
          type="number"
          step={fieldKey === "training_days" ? "1" : "0.01"}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cfg.placeholder}
          readOnly={readOnly}
          className={readOnly ? "bg-zinc-50 text-zinc-500" : undefined}
        />
        {cfg.helpText && <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.helpText}</p>}
        {readOnly && fieldKey === "referral_bonus_amt" && (
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Locked by selected tier.
          </p>
        )}
      </div>
    );
  }

  // Long text
  if (
    fieldKey === "explanation" ||
    fieldKey === "approval_notes" ||
    fieldKey === "spot_bonus_reason"
  ) {
    return (
      <div className="sm:col-span-2 lg:col-span-3">
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
