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

// Overlay a card's Spanish (or other) translation onto the base English data:
// per-field text + a language-specific videoUrl, falling back to English for
// anything not translated. Always strips the i18n blob from what we ship.
const I18N_TEXT_KEYS = ["kicker", "title", "body", "q", "explain", "reveal", "videoUrl", "imageUrl"];
function localizeCardData(raw, lang) {
  const { i18n, ...base } = raw || {};
  const tr = i18n && i18n[lang];
  if (lang === "en" || !tr) return base;
  const out = { ...base };
  for (const k of I18N_TEXT_KEYS) if (tr[k] != null && tr[k] !== "") out[k] = tr[k];
  if (Array.isArray(base.options) && Array.isArray(tr.options))
    out.options = base.options.map((o, i) => (tr.options[i] != null && tr.options[i] !== "" ? tr.options[i] : o));
  if (Array.isArray(base.steps) && Array.isArray(tr.steps))
    out.steps = base.steps.map((s, i) => ({ ...s, t: tr.steps[i]?.t || s.t, d: tr.steps[i]?.d ?? s.d }));
  if (Array.isArray(base.meta) && Array.isArray(tr.meta))
    out.meta = base.meta.map((m, i) => ({ ...m, k: tr.meta[i]?.k || m.k }));
  return out;
}

// GET lesson — strips quiz keys, injects server-aggregated poll results,
// ensures an enrollment, and attaches the caller's per-card progress.
async function getLesson(supa, user, courseId, lang = "en") {
  if (!courseId) return { error: "course_id is required.", status: 400 };
  const { data: course } = await supa
    .from("qsr_courses").select("id, title, category, description, status, est_minutes, points, languages").eq("id", courseId).maybeSingle();
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
    let data = localizeCardData(c.data, lang);
    if (c.type === "quiz" && !author) {
      const { answer, answers, explain, ...rest } = data; // never ship the key(s) to a learner
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

// Option indices → bitmask, so a multi-select answer fits the integer
// answer_index column without a schema change.
const maskOf = (arr) => (arr || []).reduce((m, i) => m | (1 << Number(i)), 0);

async function answerQuiz(supa, user, body) {
  const { card_id, answer_index, answer_indices, lang } = body || {};
  if (!card_id) return { error: "card_id is required.", status: 400 };
  const { data: card } = await supa.from("qsr_cards").select("id, type, data, lesson_id").eq("id", card_id).maybeSingle();
  if (!card || card.type !== "quiz") return { error: "Not a quiz card.", status: 400 };

  const d = card.data || {};
  const multi = !!d.multi;

  // Grade server-side; persist a single integer (raw index, or a bitmask of the
  // selected set when multi).
  let correct, storedIndex, correctAnswers;
  if (multi) {
    if (!Array.isArray(answer_indices)) return { error: "answer_indices is required for a multi-select quiz.", status: 400 };
    const sel = answer_indices.map(Number).filter((x) => Number.isInteger(x) && x >= 0);
    const correctSet = (Array.isArray(d.answers) ? d.answers : []).map(Number);
    correct = maskOf(sel) === maskOf(correctSet);
    storedIndex = maskOf(sel);
    correctAnswers = correctSet;
  } else {
    if (answer_index == null) return { error: "answer_index is required.", status: 400 };
    correct = Number(answer_index) === Number(d.answer);
    storedIndex = Number(answer_index);
    correctAnswers = d.answer == null ? [] : [Number(d.answer)];
  }
  const cardPoints = Number(d.points ?? 10);

  // No points on retries — but only a prior *correct* attempt burns them, so a
  // wrong guess before getting it right still earns the points.
  const { data: prior } = await supa
    .from("qsr_quiz_attempts").select("id").eq("user_id", user.id).eq("card_id", card_id).eq("correct", true).limit(1);
  const pointsAwarded = correct && (!prior || prior.length === 0) ? cardPoints : 0;

  await supa.from("qsr_quiz_attempts").insert({ user_id: user.id, card_id, answer_index: storedIndex, correct, points_awarded: pointsAwarded });

  const ctx = await courseIdForCard(supa, card_id);
  const enrollment = await ensureEnrollment(supa, user.id, ctx.courseId);
  await upsertProgressUpgrade(supa, enrollment.id, card_id, correct ? "passed" : "answered", { answer_index: storedIndex, correct });

  // Points ledger is the source of truth (§8). First correct attempt only.
  if (pointsAwarded > 0) {
    await supa.from("qsr_points_ledger")
      .insert({ user_id: user.id, delta: pointsAwarded, reason: "quiz_correct", card_id, course_id: ctx.courseId })
      .then(() => {}, () => {});
  }

  const explain = (lang === "es" && d.i18n?.es?.explain) ? d.i18n.es.explain : (d.explain ?? null);
  return { ok: true, correct, pointsAwarded, answer: multi ? null : Number(d.answer), answers: correctAnswers, multi, explain };
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

// ── Gamification (§8) — ledger is the source of truth ─────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

async function totalPoints(supa, userId) {
  const { data } = await supa.from("qsr_points_ledger").select("delta").eq("user_id", userId);
  return (data || []).reduce((s, r) => s + (r.delta || 0), 0);
}

// +1 on a new local day, +1 more if yesterday was active, else reset to 1.
async function bumpStreak(supa, userId) {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const { data: row } = await supa
    .from("qsr_streaks").select("current, longest, last_active_date").eq("user_id", userId).maybeSingle();
  let current = 1, longest = 1;
  if (row) {
    if (row.last_active_date === today) { current = row.current || 1; longest = row.longest || current; }
    else {
      current = row.last_active_date === yesterday ? (row.current || 0) + 1 : 1;
      longest = Math.max(row.longest || 0, current);
    }
  }
  await supa.from("qsr_streaks")
    .upsert({ user_id: userId, current, longest, last_active_date: today, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return { current, longest };
}

// Rule-based, idempotent. Returns the keys newly earned.
async function evaluateBadges(supa, userId, ctx) {
  const { data: badges } = await supa.from("qsr_badges").select("id, key");
  const { data: earned } = await supa.from("qsr_user_badges").select("badge_id").eq("user_id", userId);
  const earnedIds = new Set((earned || []).map((e) => e.badge_id));
  const byKey = new Map((badges || []).map((b) => [b.key, b]));
  const { count: completedCount } = await supa
    .from("qsr_enrollments").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed");

  const want = [
    ["first_lesson", (completedCount || 0) >= 1],
    ["perfect_score", !!ctx.perfect],
    ["streak_3", (ctx.streakCurrent || 0) >= 3],
    ["streak_7", (ctx.streakCurrent || 0) >= 7],
  ];
  const toAward = [];
  for (const [key, ok] of want) {
    const b = byKey.get(key);
    if (ok && b && !earnedIds.has(b.id)) toAward.push({ user_id: userId, badge_id: b.id, key });
  }
  if (toAward.length) {
    await supa.from("qsr_user_badges")
      .insert(toAward.map(({ user_id, badge_id }) => ({ user_id, badge_id })))
      .then(() => {}, () => {}); // ignore unique conflicts
  }
  return toAward.map((t) => t.key);
}

async function completeLesson(supa, user, body) {
  const { course_id } = body || {};
  if (!course_id) return { error: "course_id is required.", status: 400 };
  const { data: course } = await supa.from("qsr_courses").select("id, points").eq("id", course_id).maybeSingle();
  if (!course) return { error: "Course not found.", status: 404 };

  const enrollment = await ensureEnrollment(supa, user.id, course_id);
  await supa.from("qsr_enrollments")
    .update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", enrollment.id);

  // Completion bonus → ledger, once per (user, course) via the unique index.
  if (course.points) {
    await supa.from("qsr_points_ledger")
      .insert({ user_id: user.id, delta: course.points, reason: "lesson_complete", course_id })
      .then(() => {}, () => {});
  }

  // Real score: correct quiz cards / total quiz cards.
  const { data: lessons } = await supa.from("qsr_lessons").select("id").eq("course_id", course_id);
  const lessonIds = (lessons || []).map((l) => l.id);
  const { data: quizCards } = lessonIds.length
    ? await supa.from("qsr_cards").select("id").eq("type", "quiz").in("lesson_id", lessonIds)
    : { data: [] };
  const quizIds = (quizCards || []).map((c) => c.id);
  let correctCount = 0;
  if (quizIds.length) {
    const { data: attempts } = await supa
      .from("qsr_quiz_attempts").select("card_id, correct").eq("user_id", user.id).in("card_id", quizIds);
    const correctByCard = new Set();
    for (const a of attempts || []) if (a.correct) correctByCard.add(a.card_id);
    correctCount = correctByCard.size;
  }
  const perfect = quizIds.length > 0 && correctCount === quizIds.length;

  const streak = await bumpStreak(supa, user.id);
  const points = await totalPoints(supa, user.id);
  const newBadges = await evaluateBadges(supa, user.id, { perfect, streakCurrent: streak.current });

  return {
    ok: true,
    points,
    score: `${correctCount}/${quizIds.length}`,
    streak: streak.current,
    longest: streak.longest,
    newBadges,
  };
}

// Caller's points + streak + badges (for the Hub stats strip).
async function getStats(supa, user) {
  const points = await totalPoints(supa, user.id);
  const { data: streak } = await supa
    .from("qsr_streaks").select("current, longest, last_active_date").eq("user_id", user.id).maybeSingle();
  const { data: ub } = await supa.from("qsr_user_badges").select("badge_id, earned_at").eq("user_id", user.id);
  const ids = (ub || []).map((x) => x.badge_id);
  const { data: cat } = ids.length
    ? await supa.from("qsr_badges").select("id, key, name, icon").in("id", ids)
    : { data: [] };
  const catById = new Map((cat || []).map((c) => [c.id, c]));
  const badges = (ub || []).map((x) => ({ ...(catById.get(x.badge_id) || {}), earned_at: x.earned_at }));
  const atRisk = !!streak && (streak.current || 0) > 0 && streak.last_active_date !== todayStr();
  return { points, streak: { current: streak?.current || 0, longest: streak?.longest || 0, atRisk }, badges };
}

// Weekly leaderboard for the caller's store (sum of ledger over 7 days).
async function getLeaderboard(supa, user) {
  const { data: me } = await supa.from("profiles").select("primary_store_id").eq("id", user.id).maybeSingle();
  const storeId = me?.primary_store_id;
  if (!storeId) return { storeId: null, entries: [] };
  const { data: mates } = await supa
    .from("profiles").select("id, full_name, preferred_name").eq("primary_store_id", storeId).eq("is_active", true);
  const ids = (mates || []).map((m) => m.id);
  if (!ids.length) return { storeId, entries: [] };
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: ledger } = await supa
    .from("qsr_points_ledger").select("user_id, delta, at").in("user_id", ids).gte("at", since);
  const sums = new Map();
  for (const r of ledger || []) sums.set(r.user_id, (sums.get(r.user_id) || 0) + (r.delta || 0));
  const nameById = new Map((mates || []).map((m) => [m.id, m.preferred_name || m.full_name || "Crew"]));
  const entries = ids
    .map((id) => ({ user_id: id, name: nameById.get(id), points: sums.get(id) || 0, isMe: id === user.id }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);
  return { storeId, entries };
}

function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

// ── Required ("pop up on login") training ────────────────────────────────
// Fiscal model mirrors src/lib/fiscal.ts (FY2026 4-4-5). A quarterly course is
// "outstanding" if the caller's role is targeted and they haven't completed it
// since the start of the current fiscal quarter.
const RQ_FY_START = "2025-12-29";
const RQ_PERIOD_WEEKS = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];
const rqUtc = (iso) => Date.parse(`${iso}T00:00:00Z`);
const rqAddDays = (iso, n) => new Date(rqUtc(iso) + n * 86400000).toISOString().slice(0, 10);
function rqPeriod(iso) {
  const days = Math.floor((rqUtc(iso) - rqUtc(RQ_FY_START)) / 86400000);
  if (days < 0) return null;
  const wk = Math.floor(days / 7);
  let sw = 0;
  for (let i = 0; i < RQ_PERIOD_WEEKS.length; i++) {
    if (wk < sw + RQ_PERIOD_WEEKS[i]) return i + 1;
    sw += RQ_PERIOD_WEEKS[i];
  }
  return null;
}
function rqWindowStart(iso, cadence) {
  if (cadence === "annual") return RQ_FY_START;
  const period = rqPeriod(iso);
  if (!period) return RQ_FY_START;
  const qStartPeriod = Math.floor((period - 1) / 3) * 3 + 1; // first period of this quarter
  let sw = 0;
  for (let i = 0; i < qStartPeriod - 1; i++) sw += RQ_PERIOD_WEEKS[i];
  return rqAddDays(RQ_FY_START, sw * 7);
}

// Full "My Training" view: every published course with the caller's status
// (not started / in progress / completed) plus whether it's required for their
// role and still outstanding this window. Degrades gracefully pre-0174 (no
// requirement columns) by treating everything as not-required.
async function getMyTraining(supa, user) {
  let res = await supa
    .from("qsr_courses")
    .select("id, title, category, description, est_minutes, points, requirement_cadence, requirement_roles")
    .eq("status", "published").order("title");
  if (res.error) {
    res = await supa
      .from("qsr_courses")
      .select("id, title, category, description, est_minutes, points")
      .eq("status", "published").order("title");
  }
  const list = res.data || [];
  const ids = list.map((c) => c.id);
  const enrByCourse = new Map();
  if (ids.length) {
    const { data: enr } = await supa
      .from("qsr_enrollments")
      .select("course_id, status, completed_at")
      .eq("user_id", user.id).in("course_id", ids);
    for (const e of enr || []) enrByCourse.set(e.course_id, e);
  }
  const role = String(user.role);
  const today = new Date().toISOString().slice(0, 10);
  const courses = list.map((c) => {
    const e = enrByCourse.get(c.id);
    const status = e ? (e.status === "completed" ? "completed" : "in_progress") : "not_started";
    const required = !!(c.requirement_cadence && Array.isArray(c.requirement_roles) && c.requirement_roles.includes(role));
    let outstanding = false;
    if (required) {
      const windowStart = rqWindowStart(today, c.requirement_cadence);
      const doneThisWindow = !!(e && e.status === "completed" && e.completed_at && e.completed_at >= `${windowStart}T00:00:00Z`);
      outstanding = !doneThisWindow;
    }
    return {
      id: c.id, title: c.title, category: c.category, description: c.description,
      est_minutes: c.est_minutes, points: c.points,
      status, completed_at: e?.completed_at ?? null,
      required, cadence: c.requirement_cadence ?? null, outstanding,
    };
  });
  return { courses };
}

async function getRequired(supa, user) {
  const { data: courses } = await supa
    .from("qsr_courses")
    .select("id, title, category, est_minutes, requirement_cadence, requirement_roles")
    .eq("status", "published")
    .not("requirement_cadence", "is", null);
  const role = String(user.role);
  const applicable = (courses || []).filter((c) => Array.isArray(c.requirement_roles) && c.requirement_roles.includes(role));
  if (!applicable.length) return { required: [] };
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const c of applicable) {
    const windowStart = rqWindowStart(today, c.requirement_cadence);
    const { data: done } = await supa
      .from("qsr_enrollments")
      .select("id")
      .eq("user_id", user.id).eq("course_id", c.id).eq("status", "completed")
      .gte("completed_at", `${windowStart}T00:00:00Z`)
      .limit(1);
    if (!done || !done.length) {
      out.push({ id: c.id, title: c.title, category: c.category, est_minutes: c.est_minutes, cadence: c.requirement_cadence });
    }
  }
  return { required: out };
}

// Audit a user's interaction with the required-training popup. Three actions:
//   'shown'     — the popup was rendered for this course
//   'started'   — the user clicked "Start training" → deep-linked to the player
//   'dismissed' — the user X'd / "Later"'d the popup
// 'shown' is dedup'd to once per user+course per 12h so re-renders during the
// same session (route changes, refetches, re-mounts) don't spam the log; the
// terminal actions (started/dismissed) are always recorded.
async function logTrainingEvent(supa, user, body) {
  const courseId = String(body?.course_id || "");
  const act = String(body?.action || "");
  if (!courseId) return { error: "course_id required.", status: 400 };
  if (!["shown", "started", "dismissed"].includes(act)) {
    return { error: "action must be shown|started|dismissed.", status: 400 };
  }
  // Confirm the course exists; cheap and avoids polluting the table with junk
  // ids if a client gets out of sync.
  const { data: course } = await supa
    .from("qsr_courses").select("id").eq("id", courseId).maybeSingle();
  if (!course) return { error: "course not found.", status: 404 };

  if (act === "shown") {
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const { data: recent } = await supa
      .from("qsr_training_events")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("action", "shown")
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length) return { ok: true, deduped: true };
  }

  const { error } = await supa.from("qsr_training_events").insert({
    user_id: user.id,
    course_id: courseId,
    action: act,
    event_data: body?.event_data ?? null,
  });
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
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
    if (action === "lesson") return unwrap(await getLesson(supa, user, params.course_id, params.lang || "en"));
    if (action === "progress") return unwrap(await recordProgress(supa, user, body));
    if (action === "quiz") return unwrap(await answerQuiz(supa, user, body));
    if (action === "poll") return unwrap(await votePoll(supa, user, body));
    if (action === "complete") return unwrap(await completeLesson(supa, user, body));
    if (action === "stats") return unwrap(await getStats(supa, user));
    if (action === "leaderboard") return unwrap(await getLeaderboard(supa, user));
    if (action === "required") return unwrap(await getRequired(supa, user));
    if (action === "mytraining") return unwrap(await getMyTraining(supa, user));
    if (action === "log-training-event") return unwrap(await logTrainingEvent(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
