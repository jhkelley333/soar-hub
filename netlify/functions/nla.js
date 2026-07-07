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

// ── Built-in instrument templates ─────────────────────────────────────────────
// The role rubrics ship in code and self-seed idempotently (insert-if-missing,
// keyed on target_role+version / template_id+competency_key), so adding a role
// never requires pasting SQL. The Shift→AGM rubric also lives in migration
// 0217; its entry here is a no-op wherever that already ran.
const BUILTIN_TEMPLATES = [
  {
    target_role: "gm", version: 1,
    title: "First Assistant Manager to General Manager",
    items: [
      ["Brand Purpose", "listen", "Attentive Listening",
        "Gives people full attention; uses paraphrasing and repeats things back to ensure understanding; allows people to finish their statements before responding or asking questions.",
        "Maintains focus on the speaker; uses appropriate verbal and non-verbal cues; treats others how they want to be treated; is candid, open and transparent in response."],
      ["Brand Purpose", "respect", "Respectful Communication",
        "All communications are professional and respectful, no hidden agendas; keeps others informed to ensure the most inspiring, engaging working environment.",
        "All posted communication is clean, current and professional; presents and communicates professionally at all times; handles disappointments and issues calmly; asserts opinions respectfully."],
      ["Brand Purpose", "team", "Teamwork",
        "Consistently treats people with respect, maintains a positive attitude and makes work fun; shows appreciation and recognition to team members; works hard with the team and cross-functionally to meet objectives; constantly encourages.",
        "Achieves service goals by creating a positive, cohesive team environment; involves everyone on the team; supports the team by jumping in and helping when needed."],
      ["Leadership", "inspire", "Inspiring Others",
        "Emphasizes the importance of people's contributions; lets people know why their work matters and how it benefits themselves and others; ties work to people's personal and career goals, interests and brand values.",
        "Is trusted and respected by the team; engenders enthusiasm; is an effective coach and mentor; shares experiences that tie contributions to work."],
      ["Leadership", "manageperf", "Managing Performance",
        "Monitors performance and metrics; gives in-the-moment and end-of-shift feedback.",
        "Completes appraisals on time with specific examples; sets ongoing goals for management and holds them accountable for results; displays high standards in guest service and holds the team accountable to do the same."],
      ["Leadership", "conflict", "Resolves Conflict",
        "Addresses conflicts before they escalate into major problems; helps people find common goals and interests; finds mutually agreeable solutions; shows appreciation for the differences of others.",
        "Regularly checks in with the team; calmly responds to tense situations; addresses issues with the intent to find agreement and acceptance."],
      ["Leadership", "collab", "Collaborates with Others",
        "Works well with others; listens to opposing viewpoints; remains composed.",
        "Asks for and listens to opposing viewpoints; respectfully debates viewpoints; ensures all voices are heard."],
      ["Gets Results", "decision", "Decision Making",
        "Bases decisions on a systematic review of relevant facts; avoids assumptions, emotional decisions or rushing to judgment; provides clear rationale for decisions.",
        "Effectively focuses on facts, not assumptions; requires minimal AS/DM input when making decisions; follows through to ensure decisions are implemented."],
      ["Gets Results", "accept", "Accepting Responsibility",
        "Takes accountability for delivering on commitments; owns mistakes and uses them as opportunities for learning and finding solutions; openly discusses actions and their consequences, good and bad.",
        "Admits when mistakes are made and does not hide them; takes ownership and works toward solutions; accepts responsibility for business performance; does not make excuses."],
      ["Innovates", "initiative", "Demonstrates Initiative",
        "Takes action without being prompted; handles problems independently; resolves issues without relying on extensive help; does more than is expected or asked.",
        "Volunteers to take on projects; works to improve systems, service and quality; open to new ideas."],
      ["Innovates", "problem", "Problem Solving",
        "Breaks down large problems into smaller, more manageable components; identifies the key factors that influence the viability of different solutions; clarifies the information needed to solve problems.",
        "Accurately diagnoses and analyzes problems; effectively brainstorms solutions; identifies when problems are larger than the current scope."],
      ["Builds Talent", "delegate", "Delegation",
        "Provides people with clear objectives and lets them take ownership of their goals; gives a mix of tasks that challenge but do not overwhelm; acts as a resource by development level.",
        "Effectively trains and assigns managers new tasks to provide growth opportunity; follows up on progress and provides feedback."],
      ["Builds Talent", "develop", "Develops Talent",
        "Invests time and resources into building team capabilities; helps people define career goals and establish development plans; gives constructive, developmental feedback and advice; delegates tasks that challenge without overwhelming.",
        "Empowers the team to perform at their best; regularly identifies management talent and uses training programs and tools to prepare team members for the next step."],
      ["Technical Skills", "pl", "P&L Analysis",
        "Understands the biggest drivers in food and labor costs. Can speak to the sales budget and TCI. Understands company sales and EBITDA targets. Can effectively troubleshoot problem areas of the P&L.",
        null],
      ["Technical Skills", "tech", "Technology Proficiency",
        "Proficient with the store's core systems: Microsoft Office and calendar, Workday, Cornerstone.",
        null],
      ["Technical Skills", "change", "Change Management",
        "Gains the support of the team when presenting new processes and ideas. Shows flexibility and positivity when new initiatives are introduced.",
        null],
    ],
  },
];

// Insert any missing built-in template (+ items). Safe to call on every read:
// one cheap select when everything exists; unique indexes make races harmless.
let builtinsEnsured = false;
async function ensureBuiltinTemplates(supa) {
  if (builtinsEnsured) return;
  const { data: existing } = await supa.from("tp_nla_templates").select("target_role, version");
  const have = new Set((existing || []).map((t) => `${t.target_role}:${t.version}`));
  for (const b of BUILTIN_TEMPLATES) {
    if (have.has(`${b.target_role}:${b.version}`)) continue;
    await supa.from("tp_nla_templates").upsert(
      { target_role: b.target_role, version: b.version, title: b.title, status: "active", effective_date: new Date().toISOString().slice(0, 10) },
      { onConflict: "target_role,version", ignoreDuplicates: true },
    );
    const { data: tpl } = await supa.from("tp_nla_templates")
      .select("id").eq("target_role", b.target_role).eq("version", b.version).maybeSingle();
    if (!tpl) continue;
    const rows = b.items.map(([category, key, name, description, example], i) => ({
      template_id: tpl.id, category, sort_order: i + 1, competency_key: key, name, description, example,
    }));
    await supa.from("tp_nla_template_items").upsert(rows, { onConflict: "template_id,competency_key", ignoreDuplicates: true });
  }
  builtinsEnsured = true;
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
  await ensureBuiltinTemplates(supa);
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

// ── Acknowledge -> auto-build the PDP + readiness snapshot ───────────────────
const DAY_MS = 86_400_000;
const addDays = (n) => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);

async function listAcks(supa, user, params) {
  const id = params?.assessment_id;
  if (!id) return { error: "Missing assessment.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  const { data: acks } = await supa.from("tp_nla_acks").select("user_id, ack_role, acknowledged_at").eq("assessment_id", id);
  const a = acc.a;
  return {
    acks: acks || [],
    subject_acked: (acks || []).some((k) => k.user_id === a.subject_profile_id),
    leader_acked: (acks || []).some((k) => k.user_id === a.leader_profile_id),
    my_acked: (acks || []).some((k) => k.user_id === user.id),
    status: a.status,
  };
}

// On the second acknowledgement, materialize the plan: one goal per focus area
// (extends the existing PDP), three milestones each (Weeks 1-2 / Day 30 / Day
// 60), and the readiness snapshot for the pipeline.
async function buildPlanAndReadiness(supa, a, focus) {
  const t = await templateForRole(supa, a.target_role);
  const nameByKey = new Map((t?.items ?? []).map((it) => [it.competency_key, it.name]));

  // Readiness band from the leader's ratings (the objective view).
  const { data: resps } = await supa.from("tp_nla_responses").select("id, rater_type").eq("assessment_id", a.id);
  const leaderResp = (resps || []).find((r) => r.rater_type === "leader");
  const counts = { M: 0, A: 0, O: 0 };
  if (leaderResp) {
    const { data: rr } = await supa.from("tp_nla_ratings").select("rating").eq("response_id", leaderResp.id);
    for (const r of rr || []) counts[r.rating] = (counts[r.rating] || 0) + 1;
  }
  const total = counts.M + counts.A + counts.O || 1;
  const score = (counts.M * 3 + counts.A * 2 + counts.O * 1) / total;
  const band = counts.O === 0 && score >= 2.6 ? "ready_now" : score >= 2.2 ? "ready_soon" : "developing";

  const { data: cmp } = await supa.from("tp_nla_comparison").select("gap_type").eq("assessment_id", a.id);
  const gaps = { aligned: 0, blind_spot: 0, confidence_gap: 0 };
  for (const c of cmp || []) if (c.gap_type in gaps) gaps[c.gap_type]++;

  await supa.from("tp_readiness_snapshots").insert({
    subject_member_id: a.subject_member_id, subject_profile_id: a.subject_profile_id,
    source_assessment_id: a.id, target_role: a.target_role,
    summary: { ratings: counts, gaps, focus: focus.map((f) => f.competency_key) },
    readiness_band: band,
  });

  // The plan attaches to the roster member. Without one, the readiness snapshot
  // still lands but there is no PDP to build.
  if (!a.subject_member_id) return { goals: 0, milestones: 0, band };

  const { data: leadProf } = await supa.from("profiles").select("full_name, preferred_name, email").eq("id", a.leader_profile_id).maybeSingle();
  const leaderName = displayName(leadProf);

  let { data: plan } = await supa.from("tp_dev_plans").select("id").eq("member_id", a.subject_member_id).eq("status", "active").maybeSingle();
  if (!plan) {
    const { data: p } = await supa.from("tp_dev_plans").insert({
      member_id: a.subject_member_id, store_id: a.store_id, target_role: a.target_role, created_by: a.leader_profile_id,
    }).select("id").single();
    plan = p;
  }

  let goals = 0, milestones = 0, rank = 0;
  for (const f of focus) {
    const compName = nameByKey.get(f.competency_key) || f.competency_key;
    const { data: existing } = await supa.from("tp_dev_items").select("id").eq("plan_id", plan.id).eq("focus_area", compName).maybeSingle();
    if (existing) continue;
    const { data: item } = await supa.from("tp_dev_items").insert({
      plan_id: plan.id, store_id: a.store_id, focus_area: compName,
      goal: f.note || null, actions: f.suggested_resource || null, status: "open", rank: rank++, created_by: a.leader_profile_id,
    }).select("id").single();
    if (!item) continue;
    goals++;
    const res = f.suggested_resource || "the recommended resource";
    const rows = [
      { title: `Weeks 1-2: Complete ${res}`, due: 14, sort: 0 },
      { title: `Day 30: Apply on shift; ${leaderName} observes and coaches`, due: 30, sort: 1 },
      { title: `Day 60: Reassess ${compName}`, due: 60, sort: 2 },
    ].map((m) => ({
      item_id: item.id, store_id: a.store_id, title: m.title, due_date: addDays(m.due),
      owner_profile_id: a.subject_profile_id, status: "not_started", sort_order: m.sort,
    }));
    const { error } = await supa.from("tp_dev_milestones").insert(rows);
    if (!error) milestones += rows.length;
  }
  return { goals, milestones, band };
}

async function acknowledge(supa, user, body) {
  const id = body?.assessment_id;
  if (!id) return { error: "Missing assessment.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  if (!acc.isSubject && !acc.isLeader) return { error: "Only the subject or the leader can acknowledge.", status: 403 };
  const a = acc.a;
  if (a.status === "acknowledged") return { ok: true, both_acked: true, already: true };

  const { data: focus } = await supa.from("tp_nla_focus_areas")
    .select("competency_key, note, suggested_resource, template_item_id, sort_order")
    .eq("assessment_id", id).order("sort_order", { ascending: true });
  if (!focus || focus.length === 0) return { error: "Select at least one focus area before signing off.", status: 400 };

  const ackRole = acc.isSubject ? "team_member" : "first_level";
  await supa.from("tp_nla_acks")
    .upsert({ assessment_id: id, user_id: user.id, ack_role: ackRole }, { onConflict: "assessment_id,user_id", ignoreDuplicates: true });

  const { data: acks } = await supa.from("tp_nla_acks").select("user_id").eq("assessment_id", id);
  const both = (acks || []).some((k) => k.user_id === a.subject_profile_id) && (acks || []).some((k) => k.user_id === a.leader_profile_id);
  let built = null;
  if (both) {
    built = await buildPlanAndReadiness(supa, a, focus);
    await supa.from("tp_nla_assessments").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).eq("id", id);
  }
  return { ok: true, both_acked: both, plan: built };
}

// The goals + milestones created for this assessment (the "plan created" view).
async function getPlan(supa, user, params) {
  const id = params?.assessment_id;
  if (!id) return { error: "Missing assessment.", status: 400 };
  const acc = await resolveAccess(supa, user, id);
  if (acc.error) return acc;
  const a = acc.a;
  const { data: focus } = await supa.from("tp_nla_focus_areas").select("competency_key").eq("assessment_id", id);
  const t = await templateForRole(supa, a.target_role);
  const names = new Set((focus || [])
    .map((f) => (t?.items ?? []).find((it) => it.competency_key === f.competency_key)?.name)
    .filter(Boolean));
  if (!a.subject_member_id || names.size === 0) return { goals: [] };
  const { data: plan } = await supa.from("tp_dev_plans").select("id").eq("member_id", a.subject_member_id).eq("status", "active").maybeSingle();
  if (!plan) return { goals: [] };
  const { data: items } = await supa.from("tp_dev_items").select("id, focus_area, goal, status").eq("plan_id", plan.id);
  const goalItems = (items || []).filter((it) => names.has(it.focus_area));
  const ids = goalItems.map((g) => g.id);
  const { data: ms } = ids.length
    ? await supa.from("tp_dev_milestones").select("item_id, title, due_date, status, sort_order").in("item_id", ids).order("sort_order", { ascending: true })
    : { data: [] };
  const byItem = new Map();
  for (const m of ms || []) { const arr = byItem.get(m.item_id) || []; arr.push(m); byItem.set(m.item_id, arr); }
  return { goals: goalItems.map((g) => ({ focus_area: g.focus_area, goal: g.goal, status: g.status, milestones: byItem.get(g.id) || [] })) };
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
      if (action === "acks") return unwrap(await listAcks(supa, user, params));
      if (action === "plan") return unwrap(await getPlan(supa, user, params));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "open") return unwrap(await openAssessment(supa, user, body));
    if (action === "save-rating") return unwrap(await saveRating(supa, user, body));
    if (action === "submit") return unwrap(await submitResponse(supa, user, body));
    if (action === "set-focus") return unwrap(await setFocus(supa, user, body));
    if (action === "remove-focus") return unwrap(await removeFocus(supa, user, body));
    if (action === "acknowledge") return unwrap(await acknowledge(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
