// Next Level Assessment (NLA) — backend.
//
// Service-role gatekeeper. Unlike team-pipeline, ANY authenticated user can
// reach this: a subject self-assesses their own NLA. Every action scope-checks
// — you can only touch an assessment where you are the subject, the leader, or
// (for opening) a leader whose visible stores include the subject's store.
//
// Independent ratings: before both sides submit, a rater sees only their own
// ratings. The DB also enforces immutability of locked ratings via triggers
// (migration 0217).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("nla env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, email, full_name, preferred_name, role, is_active, primary_store_id")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const displayName = (p) => p?.preferred_name || p?.full_name || p?.email || "Someone";
const RATINGS = new Set(["M", "A", "O"]);

// Store ids the caller can see (leadership scope), via the shared SQL function.
async function visibleStoreIds(supa, uid) {
  const { data } = await supa.rpc("user_visible_stores", { uid });
  return new Set((data || []).map((r) => (typeof r === "string" ? r : r.id ?? r.store_id)));
}

// The current active template for a target role (highest active version).
async function templateForRole(supa, targetRole) {
  const { data: tpl } = await supa.from("tp_nla_templates")
    .select("*").eq("target_role", targetRole).eq("status", "active")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!tpl) return null;
  const { data: items } = await supa.from("tp_nla_template_items")
    .select("*").eq("template_id", tpl.id).order("sort_order", { ascending: true });
  return { template: tpl, items: items || [] };
}

async function getTemplate(supa, params) {
  const role = params?.target_role;
  if (!role) return { error: "Missing target role.", status: 400 };
  const t = await templateForRole(supa, role);
  if (!t) return { error: "No active assessment template for that role.", status: 404 };
  return t;
}

// All active templates (one per target role, highest version) — for the picker.
async function listTemplates(supa) {
  const { data } = await supa.from("tp_nla_templates")
    .select("id, target_role, version, title").eq("status", "active")
    .order("target_role", { ascending: true }).order("version", { ascending: false });
  const seen = new Set(); const out = [];
  for (const t of data || []) { if (seen.has(t.target_role)) continue; seen.add(t.target_role); out.push(t); }
  return { templates: out };
}

// Assessments where the caller is the subject or the leader.
async function listAssessments(supa, user) {
  const { data } = await supa.from("tp_nla_assessments")
    .select("*").or(`subject_profile_id.eq.${user.id},leader_profile_id.eq.${user.id}`)
    .neq("status", "archived").order("created_at", { ascending: false });
  const rows = data || [];
  // Resolve names + submission state.
  const profileIds = [...new Set(rows.flatMap((a) => [a.subject_profile_id, a.leader_profile_id]))];
  const { data: profs } = profileIds.length
    ? await supa.from("profiles").select("id, full_name, preferred_name, email").in("id", profileIds)
    : { data: [] };
  const pById = new Map((profs || []).map((p) => [p.id, p]));
  const ids = rows.map((a) => a.id);
  const { data: resp } = ids.length
    ? await supa.from("tp_nla_responses").select("assessment_id, rater_profile_id, rater_type, submitted_at").in("assessment_id", ids)
    : { data: [] };
  const respByAssess = new Map();
  for (const r of resp || []) {
    const arr = respByAssess.get(r.assessment_id) || [];
    arr.push(r); respByAssess.set(r.assessment_id, arr);
  }
  return {
    assessments: rows.map((a) => {
      const mine = (respByAssess.get(a.id) || []).find((r) => r.rater_profile_id === user.id) || null;
      const rs = respByAssess.get(a.id) || [];
      return {
        id: a.id, status: a.status, target_role: a.target_role,
        subject_name: displayName(pById.get(a.subject_profile_id)),
        leader_name: displayName(pById.get(a.leader_profile_id)),
        my_role: a.subject_profile_id === user.id ? "self" : a.leader_profile_id === user.id ? "leader" : null,
        my_submitted: !!mine?.submitted_at,
        both_submitted: rs.length >= 2 && rs.every((r) => r.submitted_at),
        created_at: a.created_at,
      };
    }),
  };
}

// One assessment for the take screen: meta, the template items, MY response +
// ratings. Counterpart ratings are withheld until both submit (Phase 3).
async function getAssessment(supa, user, params) {
  const id = params?.assessment_id;
  if (!id) return { error: "Missing assessment.", status: 400 };
  const { data: a } = await supa.from("tp_nla_assessments").select("*").eq("id", id).maybeSingle();
  if (!a) return { error: "Assessment not found.", status: 404 };
  const isSubject = a.subject_profile_id === user.id;
  const isLeader = a.leader_profile_id === user.id;
  if (!isSubject && !isLeader) {
    // Up-chain leaders may view within scope, but not rate.
    const scope = await visibleStoreIds(supa, user.id);
    if (!a.store_id || !scope.has(a.store_id)) return { error: "That assessment is outside your scope.", status: 403 };
  }
  const t = await templateForRole(supa, a.target_role);
  const { data: resps } = await supa.from("tp_nla_responses").select("*").eq("assessment_id", id);
  const mine = (resps || []).find((r) => r.rater_profile_id === user.id) || null;
  const bothSubmitted = (resps || []).length >= 2 && (resps || []).every((r) => r.submitted_at);

  let myRatings = [];
  if (mine) {
    const { data } = await supa.from("tp_nla_ratings").select("competency_key, rating, note").eq("response_id", mine.id);
    myRatings = data || [];
  }
  const { data: subjProf } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("id", a.subject_profile_id).maybeSingle();
  const { data: leadProf } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("id", a.leader_profile_id).maybeSingle();

  return {
    assessment: {
      id: a.id, status: a.status, target_role: a.target_role,
      subject_name: displayName(subjProf), leader_name: displayName(leadProf),
      opened_at: a.opened_at, comparison_ready_at: a.comparison_ready_at,
    },
    template: t?.template ?? null,
    items: t?.items ?? [],
    my_role: isSubject ? "self" : isLeader ? "leader" : null,
    my_response: mine ? { id: mine.id, submitted_at: mine.submitted_at, locked: mine.locked } : null,
    my_ratings: myRatings,
    both_submitted: bothSubmitted,
    counterpart_submitted: (resps || []).some((r) => r.rater_profile_id !== user.id && r.submitted_at),
  };
}

// A leader opens an assessment on a subject for a target role.
async function openAssessment(supa, user, body) {
  const subjectProfileId = body?.subject_profile_id;
  const targetRole = body?.target_role;
  if (!subjectProfileId || !targetRole) return { error: "Pick a team member and a target role.", status: 400 };
  if (subjectProfileId === user.id) return { error: "You cannot open an assessment on yourself.", status: 400 };

  const { data: subject } = await supa.from("profiles")
    .select("id, is_active, primary_store_id").eq("id", subjectProfileId).maybeSingle();
  if (!subject || subject.is_active === false) return { error: "That team member has no active account.", status: 400 };

  const t = await templateForRole(supa, targetRole);
  if (!t) return { error: "No active assessment template for that role.", status: 404 };

  // Scope: the subject's store must be in the leader's visible stores.
  const storeId = body?.store_id || subject.primary_store_id || null;
  const scope = await visibleStoreIds(supa, user.id);
  if (!storeId || !scope.has(storeId)) return { error: "That team member is outside your scope.", status: 403 };

  let districtId = null;
  if (storeId) {
    const { data: s } = await supa.from("stores").select("district_id").eq("id", storeId).maybeSingle();
    districtId = s?.district_id ?? null;
  }

  // One open (non-archived) assessment per subject+target at a time.
  const { data: existing } = await supa.from("tp_nla_assessments")
    .select("id").eq("subject_profile_id", subjectProfileId).eq("target_role", targetRole)
    .neq("status", "archived").maybeSingle();
  if (existing) return { ok: true, assessment_id: existing.id, existed: true };

  const { data: a, error } = await supa.from("tp_nla_assessments").insert({
    subject_member_id: body?.subject_member_id || null,
    subject_profile_id: subjectProfileId, template_id: t.template.id, target_role: targetRole,
    leader_profile_id: user.id, store_id: storeId, district_id: districtId,
    status: "awaiting_responses", created_by: user.id,
  }).select("id").single();
  if (error) return { error: error.message, status: 500 };

  const { error: rErr } = await supa.from("tp_nla_responses").insert([
    { assessment_id: a.id, rater_profile_id: subjectProfileId, rater_type: "self" },
    { assessment_id: a.id, rater_profile_id: user.id, rater_type: "leader" },
  ]);
  if (rErr) return { error: rErr.message, status: 500 };
  return { ok: true, assessment_id: a.id, existed: false };
}

// Resolve the caller's own (unlocked) response for an assessment.
async function myOpenResponse(supa, user, assessmentId) {
  const { data: r } = await supa.from("tp_nla_responses")
    .select("*").eq("assessment_id", assessmentId).eq("rater_profile_id", user.id).maybeSingle();
  return r || null;
}

async function saveRating(supa, user, body) {
  const assessmentId = body?.assessment_id;
  const competencyKey = body?.competency_key;
  const rating = String(body?.rating || "");
  if (!assessmentId || !competencyKey) return { error: "Missing assessment or competency.", status: 400 };
  if (!RATINGS.has(rating)) return { error: "Rating must be M, A, or O.", status: 400 };
  const resp = await myOpenResponse(supa, user, assessmentId);
  if (!resp) return { error: "You are not a rater on this assessment.", status: 403 };
  if (resp.locked || resp.submitted_at) return { error: "Your assessment is already submitted.", status: 409 };

  const { data: a } = await supa.from("tp_nla_assessments").select("template_id").eq("id", assessmentId).maybeSingle();
  const { data: item } = await supa.from("tp_nla_template_items")
    .select("id").eq("template_id", a.template_id).eq("competency_key", competencyKey).maybeSingle();
  if (!item) return { error: "Unknown competency.", status: 400 };

  const note = body?.note == null || body.note === "" ? null : String(body.note).slice(0, 1000);
  const { error } = await supa.from("tp_nla_ratings").upsert({
    assessment_id: assessmentId, response_id: resp.id, template_item_id: item.id,
    competency_key: competencyKey, rating, note,
  }, { onConflict: "response_id,template_item_id" });
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function submitResponse(supa, user, body) {
  const assessmentId = body?.assessment_id;
  if (!assessmentId) return { error: "Missing assessment.", status: 400 };
  const resp = await myOpenResponse(supa, user, assessmentId);
  if (!resp) return { error: "You are not a rater on this assessment.", status: 403 };
  if (resp.locked || resp.submitted_at) return { error: "Already submitted.", status: 409 };

  // Require every competency rated before locking.
  const { data: a } = await supa.from("tp_nla_assessments").select("template_id").eq("id", assessmentId).maybeSingle();
  const { count: itemCount } = await supa.from("tp_nla_template_items")
    .select("id", { count: "exact", head: true }).eq("template_id", a.template_id);
  const { count: ratedCount } = await supa.from("tp_nla_ratings")
    .select("id", { count: "exact", head: true }).eq("response_id", resp.id);
  if ((ratedCount || 0) < (itemCount || 0)) {
    return { error: `Rate all ${itemCount} competencies before submitting.`, status: 400 };
  }

  const { error } = await supa.from("tp_nla_responses")
    .update({ submitted_at: new Date().toISOString(), locked: true }).eq("id", resp.id);
  if (error) return { error: error.message, status: 500 };

  // If both sides are now in, open the comparison.
  const { data: all } = await supa.from("tp_nla_responses").select("submitted_at").eq("assessment_id", assessmentId);
  const both = (all || []).length >= 2 && (all || []).every((r) => r.submitted_at);
  if (both) {
    await supa.from("tp_nla_assessments")
      .update({ status: "both_submitted", comparison_ready_at: new Date().toISOString() }).eq("id", assessmentId);
  }
  return { ok: true, both_submitted: both };
}

// Resolve an assessment and the caller's relationship to it.
async function resolveAccess(supa, user, id) {
  const { data: a } = await supa.from("tp_nla_assessments").select("*").eq("id", id).maybeSingle();
  if (!a) return { error: "Assessment not found.", status: 404 };
  const isSubject = a.subject_profile_id === user.id;
  const isLeader = a.leader_profile_id === user.id;
  if (!isSubject && !isLeader) {
    const scope = await visibleStoreIds(supa, user.id);
    if (!a.store_id || !scope.has(a.store_id)) return { error: "That assessment is outside your scope.", status: 403 };
  }
  return { a, isSubject, isLeader };
}
const BOTH_IN = new Set(["both_submitted", "aligned", "acknowledged"]);

// The side-by-side comparison (only once both sides have submitted).
async function comparison(supa, user, params) {
  const id = params?.assessment_id;
  if (!id) return { error: "Missing assessment.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  const a = acc.a;
  if (!BOTH_IN.has(a.status)) return { error: "Both sides must submit before the comparison unlocks.", status: 409 };

  const t = await templateForRole(supa, a.target_role);
  const itemMeta = new Map((t?.items ?? []).map((it) => [it.competency_key, it]));
  const { data: cmp } = await supa.from("tp_nla_comparison").select("*").eq("assessment_id", id);
  const { data: focus } = await supa.from("tp_nla_focus_areas").select("*").eq("assessment_id", id).order("sort_order", { ascending: true });
  const { data: subjProf } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("id", a.subject_profile_id).maybeSingle();
  const { data: leadProf } = await supa.from("profiles").select("id, full_name, preferred_name, email").eq("id", a.leader_profile_id).maybeSingle();

  const rows = (cmp || []).map((c) => {
    const it = itemMeta.get(c.competency_key);
    return {
      competency_key: c.competency_key, name: it?.name ?? c.competency_key,
      category: it?.category ?? "", sort_order: it?.sort_order ?? 0,
      self_rating: c.self_rating, leader_rating: c.leader_rating, delta: c.delta, gap_type: c.gap_type,
    };
  }).sort((x, y) => x.sort_order - y.sort_order);

  const summary = { aligned: 0, blind_spot: 0, confidence_gap: 0 };
  for (const r of rows) if (r.gap_type in summary) summary[r.gap_type]++;

  return {
    assessment: {
      id: a.id, status: a.status, target_role: a.target_role,
      subject_name: displayName(subjProf), leader_name: displayName(leadProf),
      comparison_ready_at: a.comparison_ready_at, acknowledged_at: a.acknowledged_at,
    },
    rows, summary,
    focus_areas: (focus || []).map((f) => ({
      competency_key: f.competency_key, gap_type: f.gap_type,
      note: f.note, suggested_resource: f.suggested_resource, sort_order: f.sort_order,
    })),
    can_edit: acc.isSubject || acc.isLeader,
    locked: a.status === "acknowledged",
  };
}

// Select / update a focus area (max 3). Leader or subject only; they align it
// together in the sit-down.
async function setFocus(supa, user, body) {
  const id = body?.assessment_id;
  const key = body?.competency_key;
  if (!id || !key) return { error: "Missing assessment or competency.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  if (!acc.isSubject && !acc.isLeader) return { error: "Only the rater or the subject can set focus areas.", status: 403 };
  if (acc.a.status === "acknowledged") return { error: "This assessment is locked.", status: 409 };
  if (!BOTH_IN.has(acc.a.status)) return { error: "Both sides must submit first.", status: 409 };

  const { data: existing } = await supa.from("tp_nla_focus_areas").select("competency_key, sort_order").eq("assessment_id", id);
  const already = (existing || []).some((f) => f.competency_key === key);
  if (!already && (existing || []).length >= 3) return { error: "Pick at most 3 focus areas.", status: 400 };

  const { data: cmpRow } = await supa.from("tp_nla_comparison")
    .select("gap_type").eq("assessment_id", id).eq("competency_key", key).maybeSingle();
  const nextOrder = already
    ? (existing.find((f) => f.competency_key === key)?.sort_order ?? 0)
    : (existing || []).reduce((mx, f) => Math.max(mx, (f.sort_order ?? 0) + 1), 0);

  const row = {
    assessment_id: id, competency_key: key,
    template_item_id: body?.template_item_id || null,
    gap_type: cmpRow?.gap_type ?? null,
    note: body?.note == null || body.note === "" ? null : String(body.note).slice(0, 1000),
    suggested_resource: body?.suggested_resource == null || body.suggested_resource === "" ? null : String(body.suggested_resource).slice(0, 300),
    sort_order: nextOrder, created_by: user.id,
  };
  const { error } = await supa.from("tp_nla_focus_areas").upsert(row, { onConflict: "assessment_id,competency_key" });
  if (error) return { error: error.message, status: 500 };
  if (acc.a.status === "both_submitted") {
    await supa.from("tp_nla_assessments").update({ status: "aligned" }).eq("id", id);
  }
  return { ok: true };
}

async function removeFocus(supa, user, body) {
  const id = body?.assessment_id;
  const key = body?.competency_key;
  if (!id || !key) return { error: "Missing assessment or competency.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  if (!acc.isSubject && !acc.isLeader) return { error: "Only the rater or the subject can change focus areas.", status: 403 };
  if (acc.a.status === "acknowledged") return { error: "This assessment is locked.", status: 409 };

  const { error } = await supa.from("tp_nla_focus_areas").delete().eq("assessment_id", id).eq("competency_key", key);
  if (error) return { error: error.message, status: 500 };
  const { count } = await supa.from("tp_nla_focus_areas").select("id", { count: "exact", head: true }).eq("assessment_id", id);
  if ((count || 0) === 0 && acc.a.status === "aligned") {
    await supa.from("tp_nla_assessments").update({ status: "both_submitted" }).eq("id", id);
  }
  return { ok: true };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "template") return unwrap(await getTemplate(supa, params));
      if (action === "templates") return unwrap(await listTemplates(supa));
      if (action === "list") return unwrap(await listAssessments(supa, user));
      if (action === "get") return unwrap(await getAssessment(supa, user, params));
      if (action === "comparison") return unwrap(await comparison(supa, user, params));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "open") return unwrap(await openAssessment(supa, user, body));
    if (action === "save-rating") return unwrap(await saveRating(supa, user, body));
    if (action === "submit") return unwrap(await submitResponse(supa, user, body));
    if (action === "set-focus") return unwrap(await setFocus(supa, user, body));
    if (action === "remove-focus") return unwrap(await removeFocus(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
