// qsr-ai.js — SOAR QSR AI course authoring (Milestone: AI authoring).
//
// Admin/author-only. Takes a topic (and optional pasted source text), asks
// Claude to draft a microlearning course as a card deck, then writes it to the
// DB as a DRAFT for the author to review/edit/publish in the builder.
//
// Requires ANTHROPIC_API_KEY in the environment.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("qsr-ai supabase env not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
async function getUser(supa, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa.from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

const SYSTEM = `You are an instructional designer for SONIC Drive-In frontline crew training (the "SOAR QSR" platform). You write short, punchy, mobile microlearning — a swipeable deck of cards a crew member finishes in a couple of minutes. Voice: upbeat, plain-spoken, concrete, second-person ("you"). No corporate fluff.

Return ONE course as STRICT JSON ONLY — no markdown, no prose, no code fences. Shape:
{
  "title": string,                       // short, energetic
  "category": string,                    // e.g. "Carhop Service", "Food Safety"
  "description": string,                 // one sentence
  "est_minutes": number,                 // realistic, usually 2-5
  "points": number,                      // course completion points, 20-60
  "lessons": [
    {
      "title": string,
      "module": string|null,
      "cards": [ Card, ... ]             // 5-9 cards per lesson
    }
  ]
}
Card is one of:
  { "type":"intro",  "kicker":string, "title":string, "body":string }
  { "type":"steps",  "kicker":string, "title":string, "steps":[{"t":string,"d":string}, ...] }   // 3-5 steps
  { "type":"reveal", "kicker":string, "title":string, "reveal":string }                          // tap-to-reveal pro tip
  { "type":"quiz",   "kicker":string, "question":string, "options":[string,string,string], "answer":number, "explain":string, "points":number }  // answer = 0-based index; points 10-15
  { "type":"done",   "title":string, "body":string }

Rules:
- First card is always "intro". Last card is always "done".
- Include at least one "quiz" and at least one "reveal".
- Keep every string tight — titles under ~60 chars, bodies under ~280.
- Exactly one correct quiz answer; "answer" is its 0-based index; make distractors plausible.
- Output valid JSON and nothing else.`;

function extractJson(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error("Model did not return JSON.");
  return JSON.parse(text.slice(a, b + 1));
}

// Map the model's card → the QSR card data contract, dropping anything invalid.
function toCard(c, ord) {
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const t = c?.type;
  if (t === "intro") {
    if (!s(c.title)) return null;
    return { ord, type: "intro", data: { kicker: s(c.kicker), title: s(c.title), body: s(c.body) } };
  }
  if (t === "steps") {
    const steps = Array.isArray(c.steps) ? c.steps.map((x) => ({ t: s(x?.t), d: s(x?.d) })).filter((x) => x.t) : [];
    if (!s(c.title) || !steps.length) return null;
    return { ord, type: "steps", data: { kicker: s(c.kicker), title: s(c.title), steps } };
  }
  if (t === "reveal") {
    if (!s(c.title) || !s(c.reveal)) return null;
    return { ord, type: "reveal", data: { kicker: s(c.kicker), title: s(c.title), reveal: s(c.reveal) } };
  }
  if (t === "quiz") {
    const options = Array.isArray(c.options) ? c.options.map(s).filter(Boolean) : [];
    const answer = Number(c.answer);
    if (!s(c.question) || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    return { ord, type: "quiz", data: { kicker: s(c.kicker), q: s(c.question), options, answer, explain: s(c.explain), points: Number(c.points) || 10 } };
  }
  if (t === "done") {
    return { ord, type: "done", data: { title: s(c.title) || "Nice work!", body: s(c.body) } };
  }
  return null;
}

async function generate(supa, user, body) {
  const topic = String(body?.topic || "").trim();
  const sourceText = String(body?.sourceText || "").trim();
  if (!topic && !sourceText) return respond(400, { error: "Give a topic or paste some source material." });
  const lessons = Math.min(3, Math.max(1, Number(body?.lessons) || 1));

  if (!process.env.ANTHROPIC_API_KEY) return respond(500, { error: "ANTHROPIC_API_KEY is not set on the server." });
  const anthropic = new Anthropic();

  const ask = [
    topic ? `Topic: ${topic}` : null,
    `Build ${lessons} lesson${lessons > 1 ? "s" : ""}.`,
    sourceText ? `Base it on this source material (summarize and adapt — don't copy verbatim):\n"""\n${sourceText.slice(0, 12000)}\n"""` : null,
  ].filter(Boolean).join("\n\n");

  let draft;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: `${ask}\n\nOutput only the JSON course.` }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    draft = extractJson(text);
  } catch (e) {
    return respond(502, { error: `AI generation failed: ${e.message || e}` });
  }

  const lessonsIn = Array.isArray(draft?.lessons) ? draft.lessons : [];
  if (!lessonsIn.length) return respond(502, { error: "The AI returned no lessons — try a more specific topic." });

  // Persist as a draft course.
  const { data: course, error: cErr } = await supa.from("qsr_courses").insert({
    title: String(draft.title || topic || "Untitled course").slice(0, 160),
    category: draft.category ? String(draft.category).slice(0, 80) : null,
    description: draft.description ? String(draft.description).slice(0, 500) : null,
    est_minutes: Number.isFinite(Number(draft.est_minutes)) ? Math.round(Number(draft.est_minutes)) : null,
    points: Number.isFinite(Number(draft.points)) ? Math.round(Number(draft.points)) : 0,
    status: "draft",
    created_by: user.id,
  }).select("id, title").single();
  if (cErr) return respond(500, { error: cErr.message });

  let li = 0;
  for (const lesson of lessonsIn) {
    const { data: lrow, error: lErr } = await supa.from("qsr_lessons").insert({
      course_id: course.id,
      title: String(lesson?.title || `Lesson ${li + 1}`).slice(0, 160),
      module: lesson?.module ? String(lesson.module).slice(0, 80) : null,
      ord: li,
    }).select("id").single();
    if (lErr) continue;
    const cardsIn = Array.isArray(lesson?.cards) ? lesson.cards : [];
    const rows = [];
    let ord = 0;
    for (const c of cardsIn) {
      const mapped = toCard(c, ord);
      if (mapped) { rows.push({ lesson_id: lrow.id, ...mapped }); ord++; }
    }
    if (rows.length) await supa.from("qsr_cards").insert(rows);
    li++;
  }

  return respond(200, { course_id: course.id, title: course.title });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let supa;
  try { supa = admin(); } catch (e) { return respond(500, { error: e.message }); }
  const user = await getUser(supa, event).catch(() => null);
  if (!user) return respond(401, { error: "unauthorized" });
  if (String(user.role) !== "admin") return respond(403, { error: "forbidden" });

  const action = (event.queryStringParameters || {}).action || "generate";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    if (action === "generate") return await generate(supa, user, body);
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
