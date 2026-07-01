import { useQuery } from "@tanstack/react-query";
import { Check, Clock } from "lucide-react";
import { fetchOfferLetterUrl, fetchPafAudit } from "./api";
import type { PafAuditEntry, PafRow } from "./types";
import { formatUSD } from "./cost";
import { cn } from "@/lib/cn";
import { useToast } from "@/shared/ui/Toaster";
import { DiscussButton } from "@/modules/chat/DiscussButton";
import { PayPeriodBadge } from "./PayPeriodBadge";

// Maps audit log action codes (kept short for storage) to human labels.
const AUDIT_LABEL: Record<string, string> = {
  submit: "Submitted",
  resubmit: "Edited & resubmitted",
  reject: "Rejected by Payroll",
  "needs-approval": "Sent for external approval",
  "token-approved": "Approval link clicked",
  "mark-processed": "Marked Processed",
  "sdo-approved": "Approved by SDO",
  "sdo-rejected": "Rejected by SDO",
  "notify-approver": "Approver notified",
  delete: "Deleted by System Admin",
};

function formatAuditTime(iso: string): string {
  // Compact format: "May 7, 5:38 PM" — ADP-style, easy to scan.
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

// Render every category-relevant block. Fields gate on truthiness so a
// PAF only shows the sections it actually carries.
export function PafDetail({ paf }: { paf: PafRow }) {
  const isHourly = paf.pay_basis === "hourly";
  const toast = useToast();

  async function openOfferLetter() {
    try {
      const { url } = await fetchOfferLetterUrl(paf.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Couldn't open offer letter.", "error");
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PayPeriodBadge />
        <DiscussButton scopeKind="submission" scopeRef={paf.id} label="Message the submitter" />
      </div>

      <ApprovalStepper paf={paf} />

      <Section title="Submission">
        <Grid>
          <Field
            label="Home Store"
            value={
              !paf.drive_in
                ? paf.drivein_na
                  ? "N/A (district/area-level)"
                  : "—"
                : paf.store_name
                  ? `#${paf.drive_in} — ${paf.store_name}`
                  : `#${paf.drive_in}`
            }
          />
          <Field label="Market / DO" value={paf.market_do ?? "—"} />
          <Field label="Employee" value={paf.employee_name} />
          <Field label="Last 4 SSN" value={paf.last4_ssn} mono />
          <Field label="Category" value={paf.category} />
          <Field label="Status" value={paf.status} />
          <Field label="Submitted" value={paf.created_at.slice(0, 10)} />
          <Field label="Pay Period End" value={paf.pay_period_end} />
          {paf.pay_basis && (
            <Field label="Pay Basis" value={isHourly ? "Hourly" : "Salary"} />
          )}
          {paf.job_position && <Field label="Job Position" value={paf.job_position} />}
          {paf.approving_mgr && (
            <Field label="Approving Manager" value={paf.approving_mgr} />
          )}
        </Grid>
      </Section>

      {(Number(paf.reg_pay_rate) > 0 ||
        Number(paf.reg_hours) > 0 ||
        Number(paf.ot_hours) > 0 ||
        Number(paf.cc_tips) > 0 ||
        Number(paf.declared_tips) > 0) && (
        <Section title="Pay & Tips">
          <Grid>
            {Number(paf.reg_pay_rate) > 0 && (
              <Field label="Reg Pay Rate" value={formatUSD(Number(paf.reg_pay_rate))} />
            )}
            {Number(paf.reg_hours) > 0 && (
              <Field label="Reg Hours" value={String(paf.reg_hours)} />
            )}
            {Number(paf.ot_hours) > 0 && (
              <Field label="OT Hours" value={String(paf.ot_hours)} />
            )}
            {Number(paf.cc_tips) > 0 && (
              <Field label="CC Tips" value={formatUSD(Number(paf.cc_tips))} />
            )}
            {Number(paf.declared_tips) > 0 && (
              <Field label="Declared Tips" value={formatUSD(Number(paf.declared_tips))} />
            )}
          </Grid>
        </Section>
      )}

      {paf.category === "Backpay" && (
        <Section title="Back Pay">
          <Grid>
            <Field label="Type" value={paf.backpay_type === "partial" ? "Partial — netted to remaining owed" : "Full"} />
            {paf.backpay_type === "partial" && (
              <>
                <Field label="Already Paid — Regular" value={formatUSD(Number(paf.backpay_paid_reg ?? 0))} />
                <Field label="Already Paid — CC Tips" value={formatUSD(Number(paf.backpay_paid_cc_tips ?? 0))} />
                <Field label="Already Paid — Declared Tips" value={formatUSD(Number(paf.backpay_paid_declared_tips ?? 0))} />
              </>
            )}
          </Grid>
        </Section>
      )}

      {(Number(paf.pto_hours) > 0 || Number(paf.illness_hours) > 0) && (
        <Section title="Leave">
          <Grid>
            {Number(paf.pto_hours) > 0 && (
              <Field label="PTO Hours" value={String(paf.pto_hours)} />
            )}
            {Number(paf.illness_hours) > 0 && (
              <Field label="Illness Hours" value={String(paf.illness_hours)} />
            )}
          </Grid>
        </Section>
      )}

      {(paf.original_store || paf.temp_new_store || paf.store_chrged_ot) && (
        <Section title="Cross Store Work">
          <Grid>
            {paf.original_store && (
              <Field label="Original Store" value={`#${paf.original_store}`} />
            )}
            {paf.temp_new_store && (
              <Field label="Temp / New Store" value={`#${paf.temp_new_store}`} />
            )}
            {paf.store_chrged_ot && (
              <Field label="Store Charged OT" value={`#${paf.store_chrged_ot}`} />
            )}
          </Grid>
        </Section>
      )}

      {paf.category === "Transfer" &&
        (paf.current_store ||
          paf.new_store ||
          paf.current_position ||
          paf.new_position) && (
          <Section title="Transfer">
            <Grid>
              {paf.current_store && (
                <Field label="Original Store" value={`#${paf.current_store}`} />
              )}
              {paf.new_store && <Field label="New Store" value={`#${paf.new_store}`} />}
              {paf.current_position && (
                <Field label="Current Position" value={paf.current_position} />
              )}
              {paf.new_position && (
                <Field label="New Position" value={paf.new_position} />
              )}
              {paf.current_pay_rate != null && (
                <Field
                  label="Current Pay Rate"
                  value={formatUSD(Number(paf.current_pay_rate))}
                />
              )}
              {paf.new_pay_rate != null && (
                <Field
                  label="New Pay Rate"
                  value={formatUSD(Number(paf.new_pay_rate))}
                />
              )}
            </Grid>
          </Section>
        )}

      {paf.category === "New Hire (Salary Leader)" && (
        <Section title="New Hire — Salary Leader">
          <Grid>
            {paf.nh_role && <Field label="Role" value={paf.nh_role} />}
            {paf.nh_start_date && <Field label="Start Date" value={paf.nh_start_date} />}
            {paf.nh_hours_last_period != null && Number(paf.nh_hours_last_period) > 0 && (
              <Field label="Hours (Last Pay Period)" value={String(paf.nh_hours_last_period)} />
            )}
            {paf.nh_home_store && <Field label="Home Store" value={`#${paf.nh_home_store}`} />}
            {paf.nh_market && <Field label="Market (District)" value={paf.nh_market} />}
            {paf.nh_area && <Field label="Area" value={paf.nh_area} />}
            {paf.nh_no_market && (
              <Field label="Market" value="No market yet (plus-one / in training)" />
            )}
            {paf.nh_stores && <Field label="Stores" value={paf.nh_stores} />}
          </Grid>
          {paf.nh_offer_letter_path && (
            <button
              type="button"
              onClick={openOfferLetter}
              className="mt-3 inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-accent ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50"
            >
              View offer letter
            </button>
          )}
        </Section>
      )}

      {paf.category === "Demotion" &&
        (paf.from_role || paf.new_role || paf.location_change != null) && (
          <Section title="Demotion">
            <Grid>
              {paf.from_role && <Field label="Current Role" value={paf.from_role} />}
              {paf.new_role && <Field label="New Role" value={paf.new_role} />}
              <Field
                label="New Role Effective Date"
                value={paf.demotion_effective_date || "Not set"}
                highlight
              />
              {paf.current_pay_rate != null && (
                <Field
                  label="Current Pay Rate"
                  value={formatUSD(Number(paf.current_pay_rate))}
                />
              )}
              {paf.new_pay_rate != null && (
                <Field
                  label="New Pay Rate"
                  value={formatUSD(Number(paf.new_pay_rate))}
                />
              )}
              {paf.location_change != null && (
                <Field
                  label="Location Change"
                  value={paf.location_change ? "Yes" : "No"}
                />
              )}
              {paf.new_location && (
                <Field label="New Location" value={`#${paf.new_location}`} />
              )}
            </Grid>
          </Section>
        )}

      {(paf.last_day_worked || paf.termed_in_tr || paf.category === "Termination") && (
        <Section title="Termination">
          <Grid>
            {paf.last_day_worked && (
              <Field label="Last Day Worked" value={paf.last_day_worked} />
            )}
            {paf.termed_in_tr && <Field label="Termed in TR" value={paf.termed_in_tr} />}
            {paf.category === "Termination" && (
              <Field label="Final Check Hours" value={String(paf.final_check_hrs ?? 0)} />
            )}
            {paf.term_demotion && (
              <Field label="Termination Type (legacy)" value={paf.term_demotion} />
            )}
          </Grid>
        </Section>
      )}

      {paf.bonus_type && (
        <Section title={`Bonus — ${paf.bonus_type}`}>
          <Grid>
            {paf.bonus_type === "Spot Bonus" && (
              <>
                {Number(paf.spot_bonus_amt) > 0 && (
                  <Field
                    label="Bonus Amount"
                    value={formatUSD(Number(paf.spot_bonus_amt))}
                  />
                )}
                {paf.spot_bonus_reason && (
                  <Field label="For What" value={paf.spot_bonus_reason} />
                )}
              </>
            )}
            {paf.bonus_type === "Training" && (
              <>
                {paf.training_bonus_amt != null && (
                  <Field
                    label="Training Bonus Amount"
                    value={formatUSD(Number(paf.training_bonus_amt))}
                  />
                )}
                {paf.trained_employee_name && (
                  <Field label="Who Was Trained" value={paf.trained_employee_name} />
                )}
                {paf.trained_at_store && (
                  <Field label="At Store" value={`#${paf.trained_at_store}`} />
                )}
                {paf.training_days != null && (
                  <Field label="Days" value={String(paf.training_days)} />
                )}
              </>
            )}
            {paf.bonus_type === "Referral" && (
              <>
                {paf.referral_tier && (
                  <Field label="Tier" value={paf.referral_tier} />
                )}
                {paf.referral_bonus_amt != null && (
                  <Field
                    label="Bonus Amount"
                    value={formatUSD(Number(paf.referral_bonus_amt))}
                  />
                )}
                {paf.referred_employee_name && (
                  <Field
                    label="Referred Employee"
                    value={paf.referred_employee_name}
                  />
                )}
                {paf.referral_start_date && (
                  <Field label="Start Date" value={paf.referral_start_date} />
                )}
              </>
            )}
            {/* Legacy single-bonus row — populated only when bonus_type isn't
                one of the consolidated three (i.e. historical Spot Bonus
                rows submitted under the old form). */}
            {paf.bonus_type !== "Spot Bonus" &&
              paf.bonus_type !== "Training" &&
              paf.bonus_type !== "Referral" &&
              Number(paf.spot_bonus_amt) > 0 && (
                <Field
                  label="Bonus Amount (legacy)"
                  value={formatUSD(Number(paf.spot_bonus_amt))}
                />
              )}
          </Grid>
        </Section>
      )}

      {(paf.status === "Pending SDO Approval" ||
        paf.sdo_decided_at ||
        paf.sdo_decision) && (
        <Section title="SDO Approval">
          <Grid>
            {paf.sdo_decision && (
              <Field
                label="Decision"
                value={
                  paf.sdo_decision === "approved"
                    ? "Approved"
                    : paf.sdo_decision === "rejected"
                      ? "Rejected"
                      : paf.sdo_decision
                }
              />
            )}
            {paf.sdo_decided_at && (
              <Field label="Decided At" value={paf.sdo_decided_at.slice(0, 10)} />
            )}
            {paf.status === "Pending SDO Approval" && !paf.sdo_decided_at && (
              <Field label="Status" value="Awaiting SDO action" />
            )}
          </Grid>
          {paf.sdo_decision_note && (
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Note
              </div>
              <div className="mt-1 text-sm text-zinc-700 whitespace-pre-wrap">
                {paf.sdo_decision_note}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Cost">
        <Grid>
          <Field
            label="Estimated Cost"
            value={formatUSD(Number(paf.estimated_cost) || 0)}
          />
        </Grid>
      </Section>

      <AuditTimeline pafId={paf.id} />

      {paf.rejection_reason && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700">
            Rejection reason
          </div>
          <div className="mt-1 text-sm text-red-700">{paf.rejection_reason}</div>
        </div>
      )}
      {paf.explanation && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Explanation
          </div>
          <div className="mt-1 text-sm text-zinc-700 whitespace-pre-wrap">
            {paf.explanation}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-midnight">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          {label}
        </div>
        <div className={`mt-0.5 font-semibold text-amber-900 ${mono ? "font-mono" : ""}`}>
          {value}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className={`mt-0.5 text-zinc-700 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

// Horizontal stepper that visualizes where a PAF sits in its workflow.
// The set of visible steps depends on category — bonus PAFs include the
// SDO step; everything else goes Submitter -> Payroll -> Processed.
type StepState = "done" | "current" | "upcoming" | "rejected" | "skipped";
interface Step {
  key: string;
  label: string;
  state: StepState;
  hint?: string;
}

function buildSteps(paf: PafRow): Step[] {
  const status = paf.status;
  const rejected =
    status === "Rejected" ||
    paf.sdo_decision === "rejected";
  const isBonusFlow = paf.category === "Bonus" && !!paf.sdo_approver_id;

  const submitted: Step = {
    key: "submit",
    label: "Submitted",
    state: "done",
    hint: paf.created_at.slice(0, 10),
  };

  const sdo: Step | null = isBonusFlow
    ? {
        key: "sdo",
        label: "SDO Review",
        state:
          paf.sdo_decision === "approved"
            ? "done"
            : paf.sdo_decision === "rejected"
              ? "rejected"
              : status === "Pending SDO Approval"
                ? "current"
                : "upcoming",
        hint:
          paf.sdo_decision === "approved"
            ? "Approved"
            : paf.sdo_decision === "rejected"
              ? "Rejected"
              : status === "Pending SDO Approval"
                ? "Awaiting SDO"
                : undefined,
      }
    : null;

  const payroll: Step = {
    key: "payroll",
    label: "Payroll",
    state:
      status === "Processed"
        ? "done"
        : rejected
          ? "skipped"
          : status === "Pending" ||
              status === "Approved" ||
              status === "Needs Approval"
            ? "current"
            : sdo && sdo.state !== "done" && sdo.state !== "rejected"
              ? "upcoming"
              : "current",
    hint:
      status === "Approved"
        ? "Approved by external"
        : status === "Needs Approval"
          ? "Awaiting external approval"
          : undefined,
  };

  const processed: Step = {
    key: "processed",
    label: rejected ? "Rejected" : "Processed",
    state: rejected
      ? "rejected"
      : status === "Processed"
        ? "done"
        : "upcoming",
    hint:
      status === "Processed" && paf.payroll_processed_at
        ? paf.payroll_processed_at.slice(0, 10)
        : undefined,
  };

  return [submitted, ...(sdo ? [sdo] : []), payroll, processed];
}

function ApprovalStepper({ paf }: { paf: PafRow }) {
  const steps = buildSteps(paf);
  return (
    <ol className="flex items-start gap-1.5 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5">
      {steps.map((s, i) => (
        <StepNode key={s.key} step={s} isLast={i === steps.length - 1} />
      ))}
    </ol>
  );
}

function StepNode({ step, isLast }: { step: Step; isLast: boolean }) {
  const dotClass = (() => {
    switch (step.state) {
      case "done":
        return "bg-emerald-500 text-white";
      case "current":
        return "bg-amber-500 text-white";
      case "rejected":
        return "bg-red-600 text-white";
      case "skipped":
        return "bg-zinc-300 text-zinc-600";
      default:
        return "bg-white text-zinc-400 ring-1 ring-zinc-200";
    }
  })();

  const labelClass = (() => {
    switch (step.state) {
      case "done":
        return "text-emerald-800";
      case "current":
        return "text-amber-800 font-medium";
      case "rejected":
        return "text-red-700 font-medium";
      case "skipped":
        return "text-zinc-400 line-through";
      default:
        return "text-zinc-500";
    }
  })();

  const Icon = step.state === "done" ? Check : Clock;
  const showIcon = step.state === "done" || step.state === "current";

  return (
    <li className="flex min-w-0 flex-1 items-start gap-1.5">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
            dotClass
          )}
        >
          {showIcon ? <Icon className="h-3 w-3" strokeWidth={2.5} /> : null}
          {step.state === "rejected" ? "✕" : null}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-xs", labelClass)}>{step.label}</div>
        {step.hint && (
          <div className="truncate text-[10px] text-zinc-500">{step.hint}</div>
        )}
      </div>
      {!isLast && (
        <span
          className="mt-2 hidden h-px flex-1 bg-zinc-200 sm:block"
          aria-hidden="true"
        />
      )}
    </li>
  );
}

// Reads paf_audit_log for the open PAF and renders a vertical timeline.
// Lazy: only fires the request when the modal mounts.
function AuditTimeline({ pafId }: { pafId: string }) {
  const query = useQuery({
    queryKey: ["paf-audit", pafId],
    queryFn: () => fetchPafAudit(pafId),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return (
      <Section title="History">
        <div className="text-xs text-zinc-500">Loading…</div>
      </Section>
    );
  }
  if (query.isError) {
    return (
      <Section title="History">
        <div className="text-xs text-red-700">
          {(query.error as Error)?.message ?? "Couldn't load history."}
        </div>
      </Section>
    );
  }
  const entries = query.data?.entries ?? [];
  if (entries.length === 0) {
    return null;
  }

  return (
    <Section title="History">
      <ol className="relative ml-1 space-y-3 border-l border-zinc-200 pl-4 text-xs">
        {entries.map((e) => (
          <AuditRow key={e.id} entry={e} />
        ))}
      </ol>
    </Section>
  );
}

function AuditRow({ entry }: { entry: PafAuditEntry }) {
  const label = AUDIT_LABEL[entry.action] ?? entry.action;
  const detailNote =
    entry.detail && typeof entry.detail === "object"
      ? renderAuditDetail(entry.action, entry.detail)
      : null;

  return (
    <li className="relative">
      <span
        className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-white"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-midnight">{label}</span>
        <span className="text-zinc-400">{formatAuditTime(entry.created_at)}</span>
      </div>
      {entry.actor_email && (
        <div className="mt-0.5 text-zinc-500">{entry.actor_email}</div>
      )}
      {detailNote && <div className="mt-0.5 text-zinc-600">{detailNote}</div>}
    </li>
  );
}

function renderAuditDetail(
  action: string,
  detail: Record<string, unknown>
): string | null {
  if (action === "reject" || action === "sdo-rejected" || action === "delete") {
    const reason = detail.reason ?? detail.note;
    return reason ? `Reason: ${String(reason)}` : null;
  }
  if (action === "sdo-approved" && detail.note) {
    return `Note: ${String(detail.note)}`;
  }
  if (action === "needs-approval" && detail.approval_email) {
    return `To: ${String(detail.approval_email)}`;
  }
  if (action === "submit" && detail.routed_to_sdo) {
    return "Routed to SDO for bonus approval";
  }
  return null;
}
