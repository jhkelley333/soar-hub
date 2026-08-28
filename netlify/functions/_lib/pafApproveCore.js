// Shared PAF approval transition — used by the in-app approve, the one-click
// email link, and the email-reply approve so all three do the EXACT same thing:
// flip a COO-pending PAF (Pending VP / SDO Approval) to "Pending" (the Payroll
// queue), stamp the decision, and write the audit row. Notifications are the
// caller's job (templates live in paf.js). Financially sensitive, so the update
// is guarded against a double-approve race with a conditional status filter.

export const APPROVAL_PENDING_STATUSES = ["Pending SDO Approval", "Pending VP Approval"];

const SELECT =
  "id, status, sdo_approver_id, employee_name, drive_in, bonus_type, category, pa_role, submitter_email, resubmitted_by_email";

// Finalize an approval. Returns { ok, existing, isVpFlow } on success, or
// { error, status } on any failure (not found / wrong status / raced).
export async function finalizePafApproval(supa, pafId, { actorEmail = null, note = null, channel = "app" } = {}) {
  const { data: existing, error: fErr } = await supa
    .from("paf_submissions").select(SELECT).eq("id", pafId).maybeSingle();
  if (fErr) return { error: fErr.message, status: 500 };
  if (!existing) return { error: "PAF not found.", status: 404 };
  if (!APPROVAL_PENDING_STATUSES.includes(existing.status)) {
    return { error: `PAF is not awaiting approval (status: ${existing.status}).`, status: 400 };
  }
  const isVpFlow = existing.status === "Pending VP Approval";
  const now = new Date().toISOString();

  // Conditional on the pending status so only the first concurrent approve wins.
  const { data: updated, error } = await supa
    .from("paf_submissions")
    .update({
      status: "Pending",
      sdo_decided_at: now,
      sdo_decision: "approved",
      sdo_decision_note: note,
      action_token: null,
      token_expires_at: null,
    })
    .eq("id", pafId)
    .in("status", APPROVAL_PENDING_STATUSES)
    .select("id");
  if (error) return { error: error.message, status: 500 };
  if (!updated || updated.length === 0) return { error: "PAF was already decided.", status: 409 };

  try {
    await supa.from("paf_audit_log").insert({
      paf_id: pafId,
      actor_id: null,
      actor_email: actorEmail,
      action: isVpFlow ? "vp-approved" : "sdo-approved",
      detail: {
        channel,
        employee_name: existing.employee_name,
        drive_in: existing.drive_in,
        bonus_type: existing.bonus_type,
        note,
      },
    });
  } catch (e) {
    console.warn("[pafApproveCore] audit insert failed", e?.message || e);
  }

  return { ok: true, existing, isVpFlow };
}
