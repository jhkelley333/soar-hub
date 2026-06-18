// qsr-learn.js — SOAR QSR learner runtime (Milestone 2).
//
// Server is the source of truth: quiz scoring, video watch-gating, poll
// aggregation, and completion are all decided here — the client only renders
// and reports. Quiz `answer`/`explain` are stripped from lesson reads so a
// learner never receives the key; `explain` is returned only in the scored
// answer response. Auth is enforced per request (service-role client).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const DEFAULT_VIDEO_THRESHOLD = 0.9;
const RANK = { seen: 0, answered: 1, passed: 2 };

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("qsr-learn env not configured");
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

async function ensureEnrollment(supa, userId, courseId) {
  const { data: ex } = await supa
    .from("qsr_enrollments").select("id, status").eq("user_id", userId).eq("course_id", courseId).maybeSingle();
  if (ex) return ex;
  const { data, error } = await supa
    .from("qsr_enrollments").insert({ user_id: userId, course_id: courseId }).select("id, status").single();
  if (error) throw error;
  return data;
}

async function courseIdForCard(supa, cardId) {
  const { data: card } = await supa
    .from("qsr_cards").select("id, type, data, lesson_id").eq("id", cardId).maybeSingle();
  if (!card) return null;
  const { data: lesson } = await supa.from("qsr_lessons").select("course_id").eq("id", card.lesson_id).maybeSingle();
  return { card, courseId: lesson?.course_id };
}

// Aggregate poll votes (server-authoritative results) for one card.
async function pollCounts(supa, cardId, optionCount) {
  const counts = new Array(optionCount).fill(0);
  const { data: votes } = await supa
    .from("qsr_card_progress").select("answer_index").eq("card_id", cardId).not("answer_index", "is", null);
  for (const v of votes || []) if (v.answer_index != null && v.answer_index < optionCount) counts[v.answer_index]++;
  return counts;
}

// Only ever upgrade a card's progress state (seen → answered → passed).
async function upsertProgressUpgrade(supa, enrollmentId, cardId, state, extra = {}) {
  const { data: ex } = await supa
    .from("qsr_card_progress").select("state").eq("enrollment_id", enrollmentId).eq("card_id", cardId).maybeSingle();
  const finalState = ex && RANK[ex.state] >= RANK[state] ? ex.state : state;
  await supa.from("qsr_card_progress").upsert(
    { enrollment_id: enrollmentId, card_id: cardId, state: finalState, updated_at: new Date().toISOString(), ...extra },
    { onConflict: "enrollment_id,card_id" },
  );
  return finalState;
}

// GET lesson — strips quiz keys, injects server-aggregated poll results,
// ensures an enrollment, and attaches the caller's per-card progress.
async function getLesson(supa, user, courseId) {
  if (!courseId) return { error: "course_id is required.", status: 400 };
  const { data: course } = await supa
    .from("qsr_courses").select("id, title, category, description, status, est_minutes, points").eq("id", courseId).maybeSingle();
  if (!course) return { error: "Course not found.", status: 404 };
  const author = isAuthor(user.role);
  if (course.status !== "published" && !author) return { error: "Course not available.", status: 403 };

  const { data: lessons } = await supa
    .from("qsr_lessons").select("id, title, module, ord").eq("course_id", courseId).order("ord");
  const lesson = lessons?.[0];
  if (!lesson) return { error: "Lesson not found.", status: 404 };

  const { data: cards } = await supa
    .from("qsr_cards").select("id, ord, type, data").eq("lesson_id", lesson.id).order("ord");

  const enrollment = await ensureEnrollment(supa, user.id, courseId);
  const { data: prog } = await supa
    .from("qsr_card_progress").select("card_id, state, answer_index, correct, watched_pct").eq("enrollment_id", enrollment.id);
  const progByCard = new Map((prog || []).map((p) => [p.card_id, p]));

  const safeCards = [];
  for (const c of cards || []) {
    let data = c.data || {};
    if (c.type === "quiz" && !author) {
      const { answer, explain, ...rest } = data; // never ship the key to a learner
      data = rest;
    }
    if (c.type === "poll") {
      const optionCount = Array.isArray(data.options) ? data.options.length : 0;
      data = { ...data, results: await pollCounts(supa, c.id, optionCount) };
    }
    safeCards.push({ id: c.id, ord: c.ord, type: c.type, data, progress: progByCard.get(c.id) || null });
  }

  return { course, lesson, enrollmentId: enrollment.id, cards: safeCards };
}

async function recordProgress(supa, user, body) {
  const { card_id, state, watched_pct } = body || {};
  if (!card_id) return { error: "card_id is required.", status: 400 };
  const ctx = await courseIdForCard(supa, card_id);
  if (!ctx?.courseId) return { error: "Card not found.", status: 404 };
  const enrollment = await ensureEnrollment(supa, user.id, ctx.courseId);

  // Video gating is decided here, never by the client.
  if (ctx.card.type === "video") {
    const threshold = ctx.card.data?.threshold ?? DEFAULT_VIDEO_THRESHOLD;
    const passable = (Number(watched_pct) || 0) >= threshold;
    const finalState = await upsertProgressUpgrade(
      supa, enrollment.id, card_id, passable ? "passed" : "seen",
      watched_pct != null ? { watched_pct: Number(watched_pct) } : {},
    );
    return { ok: true, state: finalState, passable };
  }

  const finalState = await upsertProgressUpgrade(supa, enrollment.id, card_id, state || "seen");
  return { ok: true, state: finalState };
}

async function answerQuiz(supa, user, body) {
  const { card_id, answer_index } = body || {};
  if (!card_id || answer_index == null) return { error: "card_id and answer_index are required.", status: 400 };
  const { data: card } = await supa.from("qsr_cards").select("id, type, data, lesson_id").eq("id", card_id).maybeSingle();
  if (!card || card.type !== "quiz") return { error: "Not a quiz card.", status: 400 };

  const correctIndex = card.data?.answer;
  const correct = Number(answer_index) === Number(correctIndex);
  const cardPoints = Number(card.data?.points ?? 10);

  // No points on retries of the same card.
  const { data: prior } = await supa
    .from("qsr_quiz_attempts").select("id").eq("user_id", user.id).eq("card_id", card_id).limit(1);
  const pointsAwarded = correct && (!prior || prior.length === 0) ? cardPoints : 0;

  await supa.from("qsr_quiz_attempts").insert({ user_id: user.id, card_id, answer_index, correct, points_awarded: pointsAwarded });

  const ctx = await courseIdForCard(supa, card_id);
  const enrollment = await ensureEnrollment(supa, user.id, ctx.courseId);
  await upsertProgressUpgrade(supa, enrollment.id, card_id, correct ? "passed" : "answered", { answer_index, correct });

  return { ok: true, correct, pointsAwarded, answer: correctIndex, explain: card.data?.explain ?? null };
}

async function votePoll(supa, user, body) {
  const { card_id, option_index } = body || {};
  if (!card_id || option_index == null) return { error: "card_id and option_index are required.", status: 400 };
  const { data: card } = await supa.from("qsr_cards").select("id, type, data, lesson_id").eq("id", card_id).maybeSingle();
  if (!card || card.type !== "poll") return { error: "Not a poll card.", status: 400 };
  const ctx = await courseIdForCard(supa, card_id);
  const enrollment = await ensureEnrollment(supa, user.id, ctx.courseId);

  // One vote per learner (per enrollment).
  await upsertProgressUpgrade(supa, enrollment.id, card_id, "answered", { answer_index: Number(option_index) });
  const optionCount = Array.isArray(card.data?.options) ? card.data.options.length : 0;
  return { ok: true, results: await pollCounts(supa, card_id, optionCount) };
}

async function completeLesson(supa, user, body) {
  const { course_id } = body || {};
  if (!course_id) return { error: "course_id is required.", status: 400 };
  const { data: course } = await supa.from("qsr_courses").select("id, points").eq("id", course_id).maybeSingle();
  if (!course) return { error: "Course not found.", status: 404 };

  const enrollment = await ensureEnrollment(supa, user.id, course_id);
  await supa.from("qsr_enrollments")
    .update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", enrollment.id);

  // Real score + points (server-computed), never the seeded static values.
  const { data: lessons } = await supa.from("qsr_lessons").select("id").eq("course_id", course_id);
  const lessonIds = (lessons || []).map((l) => l.id);
  const { data: quizCards } = lessonIds.length
    ? await supa.from("qsr_cards").select("id").eq("type", "quiz").in("lesson_id", lessonIds)
    : { data: [] };
  const quizIds = (quizCards || []).map((c) => c.id);

  let correctCount = 0;
  let pointsFromQuiz = 0;
  if (quizIds.length) {
    const { data: attempts } = await supa
      .from("qsr_quiz_attempts").select("card_id, correct, points_awarded").eq("user_id", user.id).in("card_id", quizIds);
    const correctByCard = new Set();
    for (const a of attempts || []) {
      pointsFromQuiz += a.points_awarded || 0;
      if (a.correct) correctByCard.add(a.card_id);
    }
    correctCount = correctByCard.size;
  }

  // Streak = distinct local days with a completed lesson (refined to
  // consecutive-day logic in Milestone 3; this is a real value, not a stub).
  const { data: completed } = await supa
    .from("qsr_enrollments").select("completed_at").eq("user_id", user.id).not("completed_at", "is", null);
  const streak = new Set((completed || []).map((e) => (e.completed_at || "").slice(0, 10))).size;

  return {
    ok: true,
    points: pointsFromQuiz + (course.points || 0),
    score: `${correctCount}/${quizIds.length}`,
    streak,
  };
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

  const params = event.queryStringParameters || {};
  const action = params.action || "lesson";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    if (action === "lesson") return unwrap(await getLesson(supa, user, params.course_id));
    if (action === "progress") return unwrap(await recordProgress(supa, user, body));
    if (action === "quiz") return unwrap(await answerQuiz(supa, user, body));
    if (action === "poll") return unwrap(await votePoll(supa, user, body));
    if (action === "complete") return unwrap(await completeLesson(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
