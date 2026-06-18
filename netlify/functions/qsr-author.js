// qsr-author.js — SOAR QSR authoring backend (Milestone 4, Course Builder).
//
// Author-only (mirrors qsr_can_author() = admin). Server validates card.data
// per type before any write and keeps ordering append-correct. RLS on the
// qsr_* tables is the backstop; this layer adds validation + convenience
// (full draft tree reads, publish guards, reorder).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const CARD_TYPES = ["intro", "steps", "image", "video", "quiz", "reveal", "poll", "done"];

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("qsr-author env not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function isAuthor(role) {
  return ["admin"].includes(String(role)); // mirrors qsr_can_author()
}

async function getUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Per-type card validation (spec §6). Returns an error string or null.
function validateCard(type, d) {
  const has = (k) => typeof d[k] === "string" && d[k].trim().length > 0;
  const opts = Array.isArray(d.options) ? d.options.filter((o) => String(o ?? "").trim()) : [];
  switch (type) {
    case "intro": return has("title") ? null : "Intro card needs a title.";
    case "steps":
      return has("title") && Array.isArray(d.steps) && d.steps.length &&
        d.steps.every((s) => s && typeof s.t === "string" && s.t.trim())
        ? null : "Steps card needs a title and at least one step.";
    case "image": return has("title") ? null : "Image card needs a title.";
    case "video": return has("title") ? null : "Video card needs a title.";
    case "quiz":
      if (!has("q")) return "Quiz needs a question.";
      if (opts.length < 2) return "Quiz needs at least two options.";
      if (typeof d.answer !== "number" || d.answer < 0 || d.answer >= d.options.length)
        return "Pick the correct answer.";
      return null;
    case "reveal":
      return has("title") && has("reveal") ? null : "Reveal card needs a title and reveal text.";
    case "poll":
      if (!has("q")) return "Poll needs a question.";
      if (opts.length < 2) return "Poll needs at least two options.";
      return null;
    case "done": return has("title") ? null : "Done card needs a title.";
    default: return "Unknown card type.";
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────
async function listCourses(supa) {
  const { data: courses } = await supa.from("qsr_courses").select("*").order("updated_at", { ascending: false });
  const ids = (courses || []).map((c) => c.id);
  const { data: lessons } = ids.length
    ? await supa.from("qsr_lessons").select("id, course_id").in("course_id", ids) : { data: [] };
  const lessonToCourse = new Map((lessons || []).map((l) => [l.id, l.course_id]));
  const lessonByCourse = new Map();
  for (const l of lessons || []) lessonByCourse.set(l.course_id, (lessonByCourse.get(l.course_id) || 0) + 1);
  const lessonIds = (lessons || []).map((l) => l.id);
  const { data: cards } = lessonIds.length
    ? await supa.from("qsr_cards").select("id, lesson_id").in("lesson_id", lessonIds) : { data: [] };
  const cardByCourse = new Map();
  for (const cd of cards || []) {
    const cid = lessonToCourse.get(cd.lesson_id);
    cardByCourse.set(cid, (cardByCourse.get(cid) || 0) + 1);
  }
  return {
    courses: (courses || []).map((c) => ({
      ...c, lesson_count: lessonByCourse.get(c.id) || 0, card_count: cardByCourse.get(c.id) || 0,
    })),
  };
}

async function getCourseTree(supa, courseId) {
  if (!courseId) return { error: "course_id required.", status: 400 };
  const { data: course } = await supa.from("qsr_courses").select("*").eq("id", courseId).maybeSingle();
  if (!course) return { error: "Course not found.", status: 404 };
  const { data: lessons } = await supa.from("qsr_lessons").select("*").eq("course_id", courseId).order("ord");
  const lessonIds = (lessons || []).map((l) => l.id);
  const { data: cards } = lessonIds.length
    ? await supa.from("qsr_cards").select("*").in("lesson_id", lessonIds).order("ord") : { data: [] };
  const byLesson = new Map();
  for (const cd of cards || []) {
    const a = byLesson.get(cd.lesson_id) || []; a.push(cd); byLesson.set(cd.lesson_id, a);
  }
  return { course, lessons: (lessons || []).map((l) => ({ ...l, cards: byLesson.get(l.id) || [] })) };
}

// ── Writes ─────────────────────────────────────────────────────────────────
async function saveCourse(supa, user, body) {
  const { id, title, category, description, est_minutes, points } = body || {};
  if (!title || !String(title).trim()) return { error: "Title is required.", status: 400 };
  const patch = {
    title: String(title).trim(),
    category: category || null,
    description: description || null,
    est_minutes: est_minutes != null && est_minutes !== "" ? Number(est_minutes) : null,
    points: Number(points) || 0,
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const { data, error } = await supa.from("qsr_courses").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return { course: data };
  }
  const { data, error } = await supa.from("qsr_courses").insert({ ...patch, created_by: user.id }).select().single();
  if (error) throw error;
  return { course: data };
}

async function setPublish(supa, body) {
  const { id, publish } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  if (publish) {
    const { data: lessons } = await supa.from("qsr_lessons").select("id").eq("course_id", id);
    const lessonIds = (lessons || []).map((l) => l.id);
    const { count } = lessonIds.length
      ? await supa.from("qsr_cards").select("id", { count: "exact", head: true }).in("lesson_id", lessonIds)
      : { count: 0 };
    if (!count) return { error: "Add at least one card before publishing.", status: 400 };
  }
  const { data, error } = await supa.from("qsr_courses")
    .update({ status: publish ? "published" : "draft", updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw error;
  return { course: data };
}

async function deleteCourse(supa, body) {
  const { id } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  const { error } = await supa.from("qsr_courses").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

async function saveLesson(supa, body) {
  const { id, course_id, title, module: mod, ord } = body || {};
  if (!title || !String(title).trim()) return { error: "Lesson title is required.", status: 400 };
  const patch = { title: String(title).trim(), module: mod || null };
  if (ord != null) patch.ord = ord;
  if (id) {
    const { data, error } = await supa.from("qsr_lessons").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return { lesson: data };
  }
  if (!course_id) return { error: "course_id required.", status: 400 };
  const { data: last } = await supa.from("qsr_lessons")
    .select("ord").eq("course_id", course_id).order("ord", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supa.from("qsr_lessons")
    .insert({ course_id, ...patch, ord: patch.ord ?? ((last?.ord ?? -1) + 1) }).select().single();
  if (error) throw error;
  return { lesson: data };
}

async function deleteLesson(supa, body) {
  const { id } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  const { error } = await supa.from("qsr_lessons").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

async function saveCard(supa, body) {
  const { id, lesson_id, type, data, ord } = body || {};
  if (!CARD_TYPES.includes(type)) return { error: "Invalid card type.", status: 400 };
  const verr = validateCard(type, data || {});
  if (verr) return { error: verr, status: 400 };
  if (id) {
    const { data: row, error } = await supa.from("qsr_cards")
      .update({ type, data: data || {} }).eq("id", id).select().single();
    if (error) throw error;
    return { card: row };
  }
  if (!lesson_id) return { error: "lesson_id required.", status: 400 };
  const { data: last } = await supa.from("qsr_cards")
    .select("ord").eq("lesson_id", lesson_id).order("ord", { ascending: false }).limit(1).maybeSingle();
  const { data: row, error } = await supa.from("qsr_cards")
    .insert({ lesson_id, type, data: data || {}, ord: ord ?? ((last?.ord ?? -1) + 1) }).select().single();
  if (error) throw error;
  return { card: row };
}

async function deleteCard(supa, body) {
  const { id } = body || {};
  if (!id) return { error: "id required.", status: 400 };
  const { error } = await supa.from("qsr_cards").delete().eq("id", id);
  if (error) throw error;
  return { ok: true };
}

// Persist a new order: items = [{ id, ord }, …] for cards or lessons.
async function reorder(supa, body) {
  const { table, items } = body || {};
  const target = table === "lessons" ? "qsr_lessons" : "qsr_cards";
  if (!Array.isArray(items)) return { error: "items required.", status: 400 };
  for (const it of items) {
    if (!it?.id) continue;
    await supa.from(target).update({ ord: it.ord }).eq("id", it.id);
  }
  return { ok: true };
}

function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getUser(supa, event).catch(() => null);
  if (!user) return respond(401, { error: "unauthorized" });
  if (!isAuthor(user.role)) return respond(403, { error: "forbidden" });

  const params = event.queryStringParameters || {};
  const action = params.action || "courses";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    if (action === "courses") return unwrap(await listCourses(supa));
    if (action === "course") return unwrap(await getCourseTree(supa, params.course_id));
    if (action === "saveCourse") return unwrap(await saveCourse(supa, user, body));
    if (action === "setPublish") return unwrap(await setPublish(supa, body));
    if (action === "deleteCourse") return unwrap(await deleteCourse(supa, body));
    if (action === "saveLesson") return unwrap(await saveLesson(supa, body));
    if (action === "deleteLesson") return unwrap(await deleteLesson(supa, body));
    if (action === "saveCard") return unwrap(await saveCard(supa, body));
    if (action === "deleteCard") return unwrap(await deleteCard(supa, body));
    if (action === "reorder") return unwrap(await reorder(supa, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
