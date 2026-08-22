// roller-leaderboard — public (no-auth) leaderboard for the RollerBuddy
// landing-page game (migration 0311). Same-origin from the public landing page.
//   GET  ?action=top          -> { ok, top: [{ name, score, character }] }  (best per name, top 10)
//   POST { name, score, character } -> { ok, top }  (records a run)
// Service-role only; the roller_scores table has RLS on with no public policies.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const CHARACTERS = new Set(["buddy", "tot"]);

// Clean, safe display name: drop angle brackets + collapse whitespace, cap 20.
function cleanName(v) {
  const s = String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
  return s || "Anonymous";
}

// Best score per (case-insensitive) name, highest first, top 10.
async function topScores(supa) {
  const { data } = await supa
    .from("roller_scores")
    .select("name, score, character")
    .order("score", { ascending: false })
    .limit(300);
  const best = new Map();
  for (const r of data || []) {
    const key = r.name.toLowerCase();
    if (!best.has(key)) best.set(key, r); // first = highest (already sorted)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

export const handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return respond(500, { error: "Server not configured." });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (event.httpMethod === "GET") {
      return respond(200, { ok: true, top: await topScores(supa) });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { error: "Bad JSON." }); }
      const name = cleanName(body.name);
      const score = Math.floor(Number(body.score));
      if (!Number.isFinite(score) || score < 0 || score > 100000) return respond(400, { error: "Invalid score." });
      const character = CHARACTERS.has(body.character) ? body.character : "buddy";
      const { error } = await supa.from("roller_scores").insert({ name, score, character });
      if (error) {
        if (/roller_scores/.test(error.message)) return respond(500, { error: "Run migration 0311 first." });
        return respond(500, { error: error.message });
      }
      return respond(200, { ok: true, top: await topScores(supa) });
    }
    return respond(405, { error: "Method not allowed." });
  } catch (e) {
    return respond(500, { error: e?.message || "server error" });
  }
};
