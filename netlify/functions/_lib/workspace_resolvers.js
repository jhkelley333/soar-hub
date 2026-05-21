// netlify/functions/_lib/workspace_resolvers.js
//
// Shared resolution helpers for the Workspace feature. Extracted from
// workspaces.js + workspace-schedules-sweep.js to keep both files
// from duplicating the same org-hierarchy walks and rule-to-users
// resolution logic.
//
// All functions take a `supabase` client (service-role) as the first
// arg. None of them write — they only read + return.

// Walk the org hierarchy DOWN from (kind, id) → list of store ids.
// Used by per_store assignee/approver rules to enumerate the target
// stores under a region/area/district scope.
export async function storesUnderScope(supabase, kind, id) {
  if (kind === "store") return [id];
  let areaIds = [], districtIds = [], storeIds = [];
  if (kind === "region") {
    const { data: areas } = await supabase.from("areas").select("id").eq("region_id", id);
    areaIds = (areas || []).map((a) => a.id);
  } else if (kind === "area") {
    areaIds = [id];
  } else if (kind === "district") {
    districtIds = [id];
  }
  if (areaIds.length) {
    const { data: dists } = await supabase.from("districts").select("id").in("area_id", areaIds);
    districtIds.push(...(dists || []).map((d) => d.id));
  }
  if (districtIds.length) {
    const { data: stores } = await supabase.from("stores").select("id").in("district_id", districtIds);
    storeIds = (stores || []).map((s) => s.id);
  }
  return storeIds;
}

// Build the list of (scope_type, scope_id) tuples that would cover a
// given (kind, id) — the anchor itself plus every ancestor up the
// hierarchy. Used to find users whose user_scopes overlaps with the
// anchor (direct or inherited).
export async function coveringScopes(supabase, kind, id) {
  const covering = [{ scope_type: kind, scope_id: id }];
  if (kind === "store") {
    const { data: s } = await supabase.from("stores").select("district_id").eq("id", id).maybeSingle();
    if (s?.district_id) {
      covering.push({ scope_type: "district", scope_id: s.district_id });
      const { data: d } = await supabase.from("districts").select("area_id").eq("id", s.district_id).maybeSingle();
      if (d?.area_id) {
        covering.push({ scope_type: "area", scope_id: d.area_id });
        const { data: a } = await supabase.from("areas").select("region_id").eq("id", d.area_id).maybeSingle();
        if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
      }
    }
  } else if (kind === "district") {
    const { data: d } = await supabase.from("districts").select("area_id").eq("id", id).maybeSingle();
    if (d?.area_id) {
      covering.push({ scope_type: "area", scope_id: d.area_id });
      const { data: a } = await supabase.from("areas").select("region_id").eq("id", d.area_id).maybeSingle();
      if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
    }
  } else if (kind === "area") {
    const { data: a } = await supabase.from("areas").select("region_id").eq("id", id).maybeSingle();
    if (a?.region_id) covering.push({ scope_type: "region", scope_id: a.region_id });
  }
  return covering;
}

// Find active profiles with `role` whose user_scopes covers (kind, id).
// Coverage: direct, any ancestor, or global. Returns array of user_ids.
export async function usersAtAnchorWithRole(supabase, kind, id, role) {
  const covering = await coveringScopes(supabase, kind, id);
  const filterParts = covering.map(
    (c) => `and(scope_type.eq.${c.scope_type},scope_id.eq.${c.scope_id})`
  );
  filterParts.push("scope_type.eq.global");
  const { data: scopes } = await supabase
    .from("user_scopes")
    .select("user_id, profiles:user_id(id, role, is_active)")
    .or(filterParts.join(","));
  const ids = new Set();
  const targetRole = String(role).toLowerCase();
  for (const r of scopes || []) {
    const p = r.profiles;
    if (!p || !p.is_active) continue;
    if (String(p.role || "").toLowerCase() !== targetRole) continue;
    ids.add(p.id);
  }
  return Array.from(ids);
}

// Resolve approver_rule → candidate_user_ids at the moment a submission
// is created. The list is then snapshotted onto the signoff row so
// downstream personnel changes don't break the chain.
//
// step is { approver_rule, ... } from workspace_template_approval_steps.
// workspace must include scope_anchor_kind + scope_anchor_id.
// submissionStoreId is the store the submission was filled out at
// (null when the submission has no associated store).
export async function resolveSignoffCandidates(supabase, step, workspace, submissionStoreId) {
  const rule = step.approver_rule || {};
  const kind = rule.kind;

  if (kind === "fixed") {
    return [rule.user_id];
  }

  if (kind === "role_relative") {
    let anchorKind = null, anchorId = null;
    if (rule.anchor === "submission_store" && submissionStoreId) {
      anchorKind = "store";
      anchorId = submissionStoreId;
    } else if (rule.anchor === "scope_anchor"
               && workspace?.scope_anchor_kind && workspace?.scope_anchor_id) {
      anchorKind = workspace.scope_anchor_kind;
      anchorId = workspace.scope_anchor_id;
    }
    if (!anchorKind) return [];
    return await usersAtAnchorWithRole(supabase, anchorKind, anchorId, rule.role);
  }

  if (kind === "role_any") {
    // Any active profile with the role, no scope filter.
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_active", true)
      .ilike("role", rule.role);
    return (data || []).map((p) => p.id);
  }

  if (kind === "any_of_roles") {
    const roles = (rule.roles || []).map((r) => String(r).toLowerCase());
    if (!roles.length) return [];
    const { data } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("is_active", true);
    return (data || [])
      .filter((p) => roles.includes(String(p.role || "").toLowerCase()))
      .map((p) => p.id);
  }

  return [];
}

// ── Audit scoring ───────────────────────────────────────────
//
// For an audit submission, computes score_total / score_possible /
// score_percent / critical_failed / outcome from the answers + the
// template's pass_fail_na questions. Only pass_fail_na answers
// contribute to scoring; other field types are informational.
//
// Returns the fields to set on the workspace_submissions row.
export function computeAuditScoring(template, questions, answers) {
  const qById = new Map((questions || []).map((q) => [q.id, q]));

  let total = 0, possible = 0, criticalFailed = false;
  for (const ans of answers) {
    const q = qById.get(ans.question_id);
    if (!q || q.field_type !== "pass_fail_na") continue;
    const weight = Number(q.weight || 0);
    if (ans.audit_result === "pass") {
      total += weight;
      possible += weight;
    } else if (ans.audit_result === "fail") {
      possible += weight;
      if (q.is_critical) criticalFailed = true;
    }
    // 'na' contributes to neither.
  }

  const percent = possible > 0 ? (total / possible) * 100 : 100;
  // If a threshold isn't set, treat 100% as the bar — strict by default.
  const threshold = template.audit_pass_threshold != null
    ? Number(template.audit_pass_threshold)
    : 100;

  let outcome;
  if (criticalFailed && template.critical_fails_audit) {
    outcome = "fail_critical";
  } else if (percent >= threshold) {
    outcome = "pass";
  } else {
    outcome = "fail";
  }

  return {
    audit_score_total: Number(total.toFixed(2)),
    audit_score_possible: Number(possible.toFixed(2)),
    audit_score_percent: Number(percent.toFixed(2)),
    audit_critical_failed: criticalFailed,
    audit_outcome: outcome,
  };
}
