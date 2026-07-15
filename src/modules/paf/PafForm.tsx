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
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { fetchCutoffInfo, fetchMyStores, fetchPafConfig, resubmitPaf, submitPaf, type PafSubmitInput } from "./api";
import { calcPafCost, formatUSD } from "./cost";
import type { MyStore, PafConfigDoc, PafFieldDisplay, PafRow, ReferralTier } from "./types";

const OFFER_BUCKET = "paf-offer-letters";
const OFFER_MIME = ["application/pdf", "image/jpeg", "image/png"];
const OFFER_MAX_BYTES = 10 * 1024 * 1024;

// Mirror of bindCat() — locked logic. Returns the set of section keys
// visible for the current form state. Branches on category and
// bonus_type so the bonus sub-section reveals after the user picks a
// type.
function visibleSections(category: string, bonusType: string, crossClockedOther = ""): Set<string> {
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
  if (c === PAY_ADJ_SALARY) {
    // Notes only from config; the custom pay-adjustment block renders the rest.
    return out;
  }
  if (c === "Cross Store Work") {
    out.add("store");
    if (crossClockedOther === "no") {
      // Not clocked in at the other store — hours pay here, tips included.
      out.add("tips");
      out.add("pay");
    }
    // crossClockedOther === "yes": a focused OT-hours block (custom, below)
    // captures the OT to charge the other store — no generic pay section.
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

// SDO and higher (plus back-office) may waive the Drive-In # on a Demotion.
const DRIVEIN_OVERRIDE_ROLES = new Set(["sdo", "rvp", "vp", "coo", "payroll", "admin"]);

// New, code-driven category (its fields are custom-rendered, not config).
const NEW_HIRE_LEADER = "New Hire (Salary Leader)";
const NH_ROLES = ["GM", "DO", "SDO"];
// Pay Adjustment (Salary) — SDO/RVP only; VP approves. Also code-driven.
const PAY_ADJ_SALARY = "Pay Adjustment (Salary)";
const PAY_ADJ_ROLES = ["GM", "DO", "SDO"];
const PAY_ADJ_SUBMITTER_ROLES = new Set(["sdo", "rvp", "admin"]);
// "Wed, Jul 15, 10:00 AM CT"
function fmtCutoff(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " CT";
}

const NH_INPUT =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

// Demotion field order is set in code: jsonb normalizes config key order
// by length, so it can't live in the config. `demotion_effective_date` is
// a code-only field (no config entry) injected into the section below.
const DEMOTION_FIELD_ORDER = [
  "from_role", // Current Role
  "new_role", // New Role
  "demotion_effective_date",
  "current_pay_rate",
  "new_pay_rate",
  "location_change",
  "new_location",
];

const DEMOTION_EFFECTIVE_FIELD: PafFieldDisplay = {
  label: "New Role Effective Date",
  placeholder: "",
  helpText: "Date the new role takes effect.",
  required: true,
  visible: true,
  locked: false,
  sections: ["demotion"],
};

function NhField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      {children}
    </div>
  );
}

// Pre-submit gate: the submitter must click to confirm the entered home store.
// Warns (but still allows) when it doesn't match their primary store.
function HomeStoreVerify({
  verified,
  onVerify,
  storeNum,
  storeName,
  primaryMismatch,
  primary,
}: {
  verified: boolean;
  onVerify: () => void;
  storeNum: string;
  storeName: string | null;
  primaryMismatch: boolean;
  primary: MyStore | null;
}) {
  const labelFor = (num: string, name: string | null) => `#${num}${name ? ` — ${name}` : ""}`;
  if (verified) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">✓</span>
        Home store verified: <strong>{labelFor(storeNum, storeName)}</strong>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          Confirm the home store before submitting: <strong>{labelFor(storeNum, storeName)}</strong>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onVerify}>
          Verify home store
        </Button>
      </div>
      {primaryMismatch && primary && (
        <div className="mt-1.5 text-xs text-amber-800">
          Heads up — this isn't your primary store ({labelFor(String(primary.number), primary.name)}). Verify only if this PAF is intentionally for a different store.
        </div>
      )}
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

// Convert a stored PAF row back into the form's string-keyed state so a
// rejected PAF can be re-opened for editing. Zero / null numerics blank
// out to match the create-form's empty look.
function s(v: unknown): string {
  return v == null ? "" : String(v);
}
function n(v: unknown): string {
  if (v == null || v === "") return "";
  const x = Number(v);
  return Number.isFinite(x) && x !== 0 ? String(x) : "";
}
function pafRowToFormState(p: PafRow): FormState {
  return {
    category: s(p.category),
    bonus_type: s(p.bonus_type),
    pay_basis:
      p.pay_basis === "hourly" ? "Hourly" : p.pay_basis === "salary" ? "Salary" : "",
    drive_in: s(p.drive_in),
    drivein_na: p.drivein_na ? "yes" : "",
    market_do: s(p.market_do),
    employee_name: s(p.employee_name),
    last4_ssn: s(p.last4_ssn),
    explanation: s(p.explanation),
    pay_period_end: s(p.pay_period_end),
    job_position: s(p.job_position),
    approving_mgr: s(p.approving_mgr),
    reg_pay_rate: n(p.reg_pay_rate),
    reg_hours: n(p.reg_hours),
    ot_hours: n(p.ot_hours),
    cc_tips: n(p.cc_tips),
    declared_tips: n(p.declared_tips),
    backpay_type: p.backpay_type === "partial" ? "partial" : "",
    backpay_paid_reg: n(p.backpay_paid_reg),
    backpay_paid_cc_tips: n(p.backpay_paid_cc_tips),
    backpay_paid_declared_tips: n(p.backpay_paid_declared_tips),
    pto_hours: n(p.pto_hours),
    illness_hours: n(p.illness_hours),
    original_store: s(p.original_store),
    temp_new_store: s(p.temp_new_store),
    store_chrged_ot: s(p.store_chrged_ot),
    cross_clocked_other:
      p.cross_clocked_other === true ? "yes" : p.cross_clocked_other === false ? "no" : "",
    current_store: s(p.current_store),
    new_store: s(p.new_store),
    current_position: s(p.current_position),
    new_position: s(p.new_position),
    from_role: s(p.from_role),
    new_role: s(p.new_role),
    current_pay_rate: n(p.current_pay_rate),
    new_pay_rate: n(p.new_pay_rate),
    location_change:
      p.location_change === true ? "Yes" : p.location_change === false ? "No" : "",
    new_location: s(p.new_location),
    demotion_effective_date: s(p.demotion_effective_date),
    last_day_worked: s(p.last_day_worked),
    termed_in_tr: s(p.termed_in_tr),
    final_check_hrs: n(p.final_check_hrs),
    spot_bonus_amt: n(p.spot_bonus_amt),
    spot_bonus_reason: s(p.spot_bonus_reason),
    training_bonus_amt: n(p.training_bonus_amt),
    trained_employee_name: s(p.trained_employee_name),
    trained_at_store: s(p.trained_at_store),
    training_days: p.training_days != null ? String(p.training_days) : "",
    referral_bonus_amt: n(p.referral_bonus_amt),
    referral_tier: s(p.referral_tier),
    referred_employee_name: s(p.referred_employee_name),
    referral_start_date: s(p.referral_start_date),
    nh_role: s(p.nh_role),
    nh_start_date: s(p.nh_start_date),
    nh_hours_last_period: n(p.nh_hours_last_period),
    nh_home_store: s(p.nh_home_store),
    nh_no_market: p.nh_no_market ? "yes" : "",
    nh_market: s(p.nh_market),
    nh_area: s(p.nh_area),
    nh_stores: s(p.nh_stores),
    nh_offer_letter_path: s(p.nh_offer_letter_path),
    pa_role: s(p.pa_role),
    pa_new_salary: n(p.pa_new_salary),
    pa_start_date: s(p.pa_start_date),
  };
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
  // Pay Adjustment (Salary): same treatment — the custom block collects
  // everything, so only the category picker renders from config.
  if (state.category === PAY_ADJ_SALARY) {
    return fieldKey === "category";
  }
  // Demotion: SDO+ submitters can waive the Drive-In # (hides the field).
  if (
    fieldKey === "drive_in" &&
    state.category === "Demotion" &&
    state.drivein_na === "yes"
  ) {
    return false;
  }
  if (fieldKey === "reg_pay_rate") {
    // Clocked in at the other store: no pay accrues here, so no rate to enter.
    if (state.category === "Cross Store Work" && state.cross_clocked_other === "yes") return false;
    return state.pay_basis !== "Salary";
  }
  if (fieldKey === "new_location") {
    return state.location_change === "Yes";
  }
  return true;
}

export function PafForm({
  onSubmitted,
  editPaf,
}: {
  onSubmitted: () => void;
  // When set, the form opens pre-filled to edit + resubmit a rejected PAF.
  editPaf?: PafRow;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!editPaf;

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

  const { profile } = useAuth();
  // Weekly payroll cutoff (Wednesday 10:00 AM Central unless overridden) —
  // shown up front so nobody is surprised their PAF lands in next week.
  const cutoffQ = useQuery({ queryKey: ["paf-cutoff-info"], queryFn: fetchCutoffInfo, staleTime: 60_000 });
  const cutoff = cutoffQ.data;
  // Config-driven labels for the code-rendered blocks (New Hire / Pay
  // Adjustment): the admin edits these under PAF Config -> Fields; the code
  // fallback keeps the form working on older config versions.
  const cfgLabel = (key: string, fallback: string) => cfg?.fields?.[key]?.label || fallback;
  // True when a leader is editing a rejected PAF someone else submitted.
  const onBehalf = isEdit && !!profile && editPaf!.submitter_id !== profile.id;
  const [state, setState] = useState<FormState>({});
  const [error, setError] = useState<string | null>(null);
  const [offerName, setOfferName] = useState<string | null>(null);
  // Home-store verification: the submitter must confirm the entered home store
  // before submitting. Resets whenever the store changes.
  const [homeVerified, setHomeVerified] = useState(false);
  const [offerUploading, setOfferUploading] = useState(false);

  async function handleOfferPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || !profile) return;
    if (!OFFER_MIME.includes(file.type)) {
      setError("Offer letter must be a PDF, JPG, or PNG.");
      return;
    }
    if (file.size > OFFER_MAX_BYTES) {
      setError("Offer letter must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setOfferUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(OFFER_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      patch("nh_offer_letter_path", path);
      setOfferName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setOfferUploading(false);
    }
  }

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
    const base = initialState(cfgQuery.data.config_json);
    if (editPaf) {
      setState({ ...base, ...pafRowToFormState(editPaf) });
      if (editPaf.nh_offer_letter_path) setOfferName("Offer letter on file");
    } else {
      setState(base);
    }
  }, [cfgQuery.data, editPaf]);

  const cfg = cfgQuery.data?.config_json;

  const visible = useMemo(
    () =>
      cfg
        ? visibleSections(state.category ?? "", state.bonus_type ?? "", state.cross_clocked_other ?? "")
        : new Set<string>(),
    [cfg, state.category, state.bonus_type, state.cross_clocked_other]
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
    // Demotion: inject the code-only effective-date field, then apply the
    // explicit field order (Current Role before New Role, etc.).
    if (out.demotion) {
      out.demotion.push(["demotion_effective_date", DEMOTION_EFFECTIVE_FIELD]);
      const ord = (k: string) => {
        const i = DEMOTION_FIELD_ORDER.indexOf(k);
        return i === -1 ? 999 : i;
      };
      out.demotion.sort((a, b) => ord(a[0]) - ord(b[0]));
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
      backpay_type: state.backpay_type,
      backpay_paid_reg: state.backpay_paid_reg,
      backpay_paid_cc_tips: state.backpay_paid_cc_tips,
      backpay_paid_declared_tips: state.backpay_paid_declared_tips,
    });
  }, [state]);

  // Home-store verification state.
  const homeStoreNum = (state.drive_in ?? "").trim();
  const primaryStore = useMemo(
    () => myStores.find((s) => s.id === profile?.primary_store_id) ?? null,
    [myStores, profile?.primary_store_id],
  );
  const enteredStore = useMemo(
    () => myStores.find((s) => String(s.number) === homeStoreNum) ?? null,
    [myStores, homeStoreNum],
  );
  const primaryMismatch = !!(primaryStore && homeStoreNum && String(primaryStore.number) !== homeStoreNum);
  // Verify only when an actual home store was entered (the Salary-Leader new
  // hire uses its own multi-store picker, not the home-store field).
  const needsHomeVerify = homeStoreNum !== "" && state.category !== NEW_HIRE_LEADER;
  // Any change to the entered home store clears a prior verification.
  useEffect(() => { setHomeVerified(false); }, [homeStoreNum]);

  const submit = useMutation({
    mutationFn: (input: PafSubmitInput) =>
      editPaf ? resubmitPaf(editPaf.id, input) : submitPaf(input),
    onSuccess: (res) => {
      const awaitingSdo = res.status === "Pending SDO Approval";
      const awaitingVp = res.status === "Pending VP Approval";
      if (res.late) {
        toast.push(
          `Heads up: submitted after this week's cutoff — it's in the payroll batch for the week of ${res.process_week}.`,
          "info"
        );
      }
      toast.push(
        isEdit
          ? awaitingSdo
            ? "PAF resubmitted — awaiting SDO approval."
            : awaitingVp
              ? "PAF resubmitted — awaiting VP approval."
              : "PAF resubmitted to Payroll."
          : awaitingSdo
            ? "Bonus PAF submitted — awaiting SDO approval."
            : awaitingVp
              ? "Pay adjustment submitted — awaiting VP approval (VP + COO copied)."
              : "PAF submitted to Payroll.",
        "success"
      );
      qc.invalidateQueries({ queryKey: ["paf-list"] });
      qc.invalidateQueries({ queryKey: ["paf-sdo-queue"] });
      if (editPaf) qc.invalidateQueries({ queryKey: ["paf-audit", editPaf.id] });
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
        // Drop back-pay sub-state so it can't ship when not on Backpay.
        next.backpay_type = "";
        next.backpay_paid_reg = "";
        next.backpay_paid_cc_tips = "";
        next.backpay_paid_declared_tips = "";
      }
      // Switching back to Full clears the already-paid amounts.
      if (key === "backpay_type" && value !== "partial") {
        next.backpay_paid_reg = "";
        next.backpay_paid_cc_tips = "";
        next.backpay_paid_declared_tips = "";
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

    // Require an explicit home-store verification when a store was entered.
    if (needsHomeVerify && !homeVerified) {
      setError("Please verify the home store before submitting.");
      return;
    }

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
      if (String(state.nh_offer_letter_path ?? "").trim() === "") {
        setError("Attach the offer letter before submitting.");
        return;
      }
    } else if (state.category === PAY_ADJ_SALARY) {
      const req: Array<[string, string]> = [
        ["pa_role", "Role"],
        ["employee_name", "Employee name"],
        ["pa_new_salary", "New salary"],
        ["pa_start_date", "New salary start date"],
        ["pay_period_end", "Pay period end"],
      ];
      for (const [k, lbl] of req) {
        if (String(state[k] ?? "").trim() === "") {
          setError(`"${lbl}" is required.`);
          return;
        }
      }
      if (!(Number(state.pa_new_salary) > 0)) {
        setError("New salary must be greater than zero.");
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

    if (state.category === "Cross Store Work") {
      if (state.cross_clocked_other !== "yes" && state.cross_clocked_other !== "no") {
        setError('Answer "Did the team member clock in at the other store?"');
        return;
      }
      if (state.cross_clocked_other === "yes" && String(state.store_chrged_ot ?? "").trim() === "") {
        setError('"Store Charged OT" is required when the team member clocked in at the other store.');
        return;
      }
    }

    if (
      state.category === "Demotion" &&
      String(state.demotion_effective_date ?? "").trim() === ""
    ) {
      setError('"New Role Effective Date" is required.');
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
      {isEdit && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">
            {onBehalf
              ? `Editing on behalf of ${editPaf?.submitter_name || editPaf?.submitter_email}`
              : "Editing a rejected PAF"}
          </div>
          <p className="mt-0.5 text-xs text-amber-800">
            Make your changes and resubmit — it goes back through the normal
            review flow{onBehalf ? ", and stays under their name" : ""}.
          </p>
          {editPaf?.rejection_reason && (
            <p className="mt-1.5 text-xs text-amber-900">
              <span className="font-semibold">Rejection reason:</span>{" "}
              {editPaf.rejection_reason}
            </p>
          )}
        </div>
      )}

      {cutoff && (
        <div
          className={
            cutoff.late
              ? "rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              : "rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600"
          }
        >
          {cutoff.late ? (
            <>
              <span className="font-semibold">Past this week's payroll cutoff</span>{" "}
              ({fmtCutoff(cutoff.cutoff_at)}) — a PAF submitted now goes into the batch for the
              week of <span className="font-semibold">{cutoff.process_week}</span>.
            </>
          ) : (
            <>
              Payroll cutoff this week: <span className="font-semibold">{fmtCutoff(cutoff.cutoff_at)}</span>
              {cutoff.overridden ? " (holiday schedule)" : ""} · submissions before it process with the week of{" "}
              <span className="font-semibold">{cutoff.process_week}</span>.
            </>
          )}
        </div>
      )}

      {/* Top-of-form fields */}
      <FormSection
        title={isEdit ? "Edit Payroll Adjustment" : "New Payroll Adjustment"}
        intent="hero"
      >
        <FieldGrid
          fields={(fieldsBySection.top ?? []).filter(([k]) =>
            isFieldVisibleForState(k, state)
          )}
          state={state}
          onChange={patch}
          cfg={cfg}
          myStores={myStores}
          extraCategories={
            profile && PAY_ADJ_SUBMITTER_ROLES.has(profile.role) ? [PAY_ADJ_SALARY] : []
          }
          omitCategories={
            profile && PAY_ADJ_SUBMITTER_ROLES.has(profile.role) ? [] : [PAY_ADJ_SALARY]
          }
        />
        {state.category === "Demotion" &&
          !!profile &&
          DRIVEIN_OVERRIDE_ROLES.has(profile.role) && (
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={state.drivein_na === "yes"}
                  onChange={(e) => patch("drivein_na", e.target.checked ? "yes" : "")}
                  className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
                />
                No single Employee Home Store (district/area-level role)
              </label>
              <p className="mt-1 text-[11px] text-zinc-500">
                SDO and above can submit a demotion without an Employee Home Store.
              </p>
            </div>
          )}
      </FormSection>

      {/* Cross Store Work — the clock question decides the flow. Clocked in at
          the other store = paid through that store's clock: no additional pay
          here, payroll just gets told where the OT charges. Not clocked in =
          the hours process as pay, as before. */}
      {state.category === "Cross Store Work" && (
        <FormSection
          title="Cross store clock check"
          description="Did the team member clock in at the other store?"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {([["yes", "Yes — they clocked in there"], ["no", "No — they did not clock in"]] as [string, string][]).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    patch("cross_clocked_other", val);
                    if (val === "yes") {
                      // Pay flows through the other store's clock — clear the
                      // rate + tips so nothing double-pays, but KEEP the hours
                      // (payroll needs them to charge the other store).
                      patch("reg_pay_rate", "");
                      patch("cc_tips", "");
                      patch("declared_tips", "");
                    }
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                    state.cross_clocked_other === val
                      ? "bg-midnight text-white ring-midnight"
                      : "bg-white text-zinc-600 ring-zinc-200 hover:text-midnight"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {state.cross_clocked_other === "yes" && (
              <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
                <strong>No pay is added on this PAF</strong> — their hours already pay through the other store's
                clock. Enter the <strong>hours worked</strong> below and the <strong>Store Charged OT</strong> so
                payroll knows how many OT hours to charge, and which store. The PAF still nets $0.
              </div>
            )}
            {state.cross_clocked_other === "no" && (
              <p className="text-xs text-zinc-500">
                They didn't clock in at the other store — enter the hours below and they'll process as pay.
              </p>
            )}
          </div>
        </FormSection>
      )}

      {/* Cross store OT — clocked-in flow. Regular pay runs through the other
          store's clock; only the OT premium needs charging there. Capture the
          OT hours and show the 1.5× so payroll knows what to charge. No pay is
          added to this PAF (cost stays $0). */}
      {state.category === "Cross Store Work" && state.cross_clocked_other === "yes" && (
        <FormSection
          title="Cross store OT"
          description="OT hours worked at the other store — charged there at 1.5×. No pay is added on this PAF."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <NhField label="OT Hours">
                <input
                  inputMode="decimal"
                  value={state.ot_hours ?? ""}
                  onChange={(e) => patch("ot_hours", e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  className={NH_INPUT}
                />
              </NhField>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-100">
              At 1.5× = <strong className="text-midnight">{(Number(state.ot_hours || 0) * 1.5).toFixed(2)}</strong> OT-equivalent hour(s)
              {String(state.store_chrged_ot ?? "").trim() ? <> to charge store #{state.store_chrged_ot}</> : null}
            </div>
          </div>
        </FormSection>
      )}

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

      {/* Back pay type — custom block. Full = the form as-is; Partial nets out
          what the team member already received (reg pay / CC tips / declared). */}
      {state.category === "Backpay" && (
        <FormSection
          title="Back pay type"
          description="Full pays the entire amount above. Partial records what was already paid and nets the cost down to what's still owed."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {([["full", "Full back pay"], ["partial", "Partial back pay"]] as [string, string][]).map(([val, label]) => {
                const on = val === "partial" ? state.backpay_type === "partial" : state.backpay_type !== "partial";
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => patch("backpay_type", val)}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                      on ? "bg-midnight text-white ring-midnight" : "bg-white text-zinc-600 ring-zinc-200 hover:text-midnight"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {state.backpay_type === "partial" && (
              <>
                <p className="text-xs text-zinc-500">
                  Enter what was already paid in each bucket. The estimated cost above is the remaining amount owed.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {([
                    ["backpay_paid_reg", "Regular pay already paid"],
                    ["backpay_paid_cc_tips", "CC tips already paid"],
                    ["backpay_paid_declared_tips", "Declared tips already paid"],
                  ] as [string, string][]).map(([k, label]) => (
                    <NhField key={k} label={label}>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
                        <input
                          inputMode="decimal"
                          value={state[k] ?? ""}
                          onChange={(e) => patch(k, e.target.value.replace(/[^0-9.]/g, ""))}
                          placeholder="0.00"
                          className={`${NH_INPUT} pl-6`}
                        />
                      </div>
                    </NhField>
                  ))}
                </div>
                <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-100">
                  Remaining owed after partial payment: <strong className="text-midnight">{formatUSD(liveCost)}</strong>
                </div>
              </>
            )}
          </div>
        </FormSection>
      )}

      {/* New Hire (Salary Leader) — custom, role-conditional section. */}
      {state.category === PAY_ADJ_SALARY && (
        <FormSection
          title="Pay Adjustment — Salary"
          description="Salary change for a GM, DO, or SDO. The VP approves; VP and COO are copied."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NhField label={`${cfgLabel("pa_role", "Role")} *`}>
              <select
                value={state.pa_role ?? ""}
                onChange={(e) => patch("pa_role", e.target.value)}
                className={NH_INPUT}
              >
                <option value="">Select role…</option>
                {PAY_ADJ_ROLES.map((r) => (
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

            <NhField label={`${cfgLabel("pa_new_salary", "New salary (annual)")} *`}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={state.pa_new_salary ?? ""}
                onChange={(e) => patch("pa_new_salary", e.target.value)}
                className={NH_INPUT}
                placeholder="e.g. 68000"
              />
            </NhField>

            <NhField label={`${cfgLabel("pa_start_date", "New salary start date")} *`}>
              <input
                type="date"
                value={state.pa_start_date ?? ""}
                onChange={(e) => patch("pa_start_date", e.target.value)}
                className={NH_INPUT}
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
          </div>
        </FormSection>
      )}

      {state.category === NEW_HIRE_LEADER && (
        <FormSection
          title="New Hire — Salary Leader"
          description="Role, identity, and pay-period details for a new salaried leader."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NhField label={`${cfgLabel("nh_role", "Role")} *`}>
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

            <NhField label={`${cfgLabel("nh_start_date", "Start date")} *`}>
              <input
                type="date"
                value={state.nh_start_date ?? ""}
                onChange={(e) => patch("nh_start_date", e.target.value)}
                className={NH_INPUT}
              />
            </NhField>

            <NhField label={`${cfgLabel("nh_hours_last_period", "Hours worked last pay period")} *`}>
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
              <NhField label={`${cfgLabel("nh_home_store", "Home store")} *`}>
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
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Offer letter <span className="text-red-600">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex cursor-pointer items-center rounded-md px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 ${
                  offerUploading ? "bg-zinc-100 text-zinc-400" : "bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <input
                  type="file"
                  accept=".pdf,image/jpeg,image/png,application/pdf"
                  onChange={handleOfferPick}
                  disabled={offerUploading}
                  className="hidden"
                />
                {offerUploading ? "Uploading…" : state.nh_offer_letter_path ? "Replace file" : "Attach file"}
              </label>
              {state.nh_offer_letter_path && offerName && (
                <span className="text-sm text-zinc-600">{offerName}</span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">PDF, JPG, or PNG — up to 10 MB.</p>
          </div>
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

      {/* Home-store verification — shared across breakpoints so mobile can
          confirm too (the desktop cost card below is hidden on small screens). */}
      {needsHomeVerify && (
        <HomeStoreVerify
          verified={homeVerified}
          onVerify={() => setHomeVerified(true)}
          storeNum={homeStoreNum}
          storeName={enteredStore?.name ?? null}
          primaryMismatch={primaryMismatch}
          primary={primaryStore}
        />
      )}

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
                <Button type="submit" disabled={submit.isPending || (needsHomeVerify && !homeVerified)}>
                  {submit.isPending
                    ? isEdit
                      ? "Resubmitting…"
                      : "Submitting…"
                    : isEdit
                      ? "Resubmit PAF"
                      : "Submit PAF"}
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
            disabled={submit.isPending || (needsHomeVerify && !homeVerified)}
            className="h-11 px-5 text-sm"
          >
            {submit.isPending
              ? isEdit
                ? "Resubmitting…"
                : "Submitting…"
              : isEdit
                ? "Resubmit PAF"
                : "Submit PAF"}
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
  extraCategories = [],
  omitCategories = [],
}: {
  fields: [string, PafFieldDisplay][];
  state: FormState;
  onChange: (key: string, value: string) => void;
  cfg: PafConfigDoc;
  myStores: MyStore[];
  extraCategories?: string[];
  omitCategories?: string[];
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
          extraCategories={extraCategories}
          omitCategories={omitCategories}
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
  "final_check_hrs",
]);

const DATE_KEYS = new Set([
  "pay_period_end",
  "last_day_worked",
  "referral_start_date",
  "demotion_effective_date",
]);

function FieldRender({
  fieldKey,
  cfg,
  value,
  onChange,
  lists,
  readOnly,
  myStores,
  extraCategories = [],
  omitCategories = [],
}: {
  fieldKey: string;
  cfg: PafFieldDisplay;
  value: string;
  onChange: (v: string) => void;
  lists: PafConfigDoc["lists"];
  readOnly?: boolean;
  myStores: MyStore[];
  extraCategories?: string[];
  omitCategories?: string[];
}) {
  const id = `paf-${fieldKey}`;
  // UI-only label override: the config still stores "Drive-In #", but the
  // store-number field reads as "Employee Home Store" on screen.
  const displayLabel = fieldKey === "drive_in" ? "Employee Home Store" : cfg.label;
  const label = (
    <Label htmlFor={id}>
      {displayLabel}
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
        options={[
          ...lists.categories.filter((c) => !omitCategories.includes(c)),
          ...(lists.categories.includes(NEW_HIRE_LEADER) ? [] : [NEW_HIRE_LEADER]),
          ...extraCategories.filter((c) => !lists.categories.includes(c)),
        ]}
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
