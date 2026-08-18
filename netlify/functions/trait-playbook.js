// netlify/functions/trait-playbook.js
//
// DO Playbook — "how to lead your team" coaching, grounded in Culture Index.
//
// Resolves the caller's manageable downline (manageable_users RPC), keeps only
// people who carry a CI trait, and — on request — generates AI coaching that is
// grounded in the server-side CI pattern definitions (never client-supplied
// text). Results are cached per (leader, team-composition hash) so repeat views
// don't re-bill Anthropic. Mirrors ranker-summary.js.
//
// Actions:
//   GET  ?action=team           -> { leader, members:[...], has_playbook }
//   POST ?action=coach {force?} -> { ok, content, cached, generatedAt, model }
//
// Leader-only (do/sdo/rvp/vp/coo/admin). Env: VITE_SUPABASE_URL (or
// SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ciPatternForTrait } from "./_lib/ciPatterns.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

const LEADER_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("trait-playbook env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, full_name, preferred_name, email, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

const displayName = (p) => p.full_name || p.preferred_name || p.email || "(unnamed)";

// The caller's coachable team: manageable downline that carries a CI trait.
// Ordered leaders-first then by name. Store label attached where we can.
async function resolveTeam(supa, leader) {
  const { data: members, error } = await supa.rpc("manageable_users", { manager_id: leader.id });
  if (error) throw new Error(`manageable_users failed: ${error.message}`);
  const withTrait = (members || []).filter(
    (m) => m.id !== leader.id && m.is_active && m.cultural_index_trait,
  );

  // Store labels for the GMs (primary_store_id → "#num name").
  const storeIds = [...new Set(withTrait.map((m) => m.primary_store_id).filter(Boolean))];
  let storeById = new Map();
  if (storeIds.length) {
    const { data: stores } = await supa
      .from("stores")
      .select("id, number, name")
      .in("id", storeIds);
    storeById = new Map((stores || []).map((s) => [s.id, s]));
  }

  const roleRank = { rvp: 5, sdo: 4, do: 3, gm: 2 };
  return withTrait
    .map((m) => {
      const store = m.primary_store_id ? storeById.get(m.primary_store_id) : null;
      return {
        id: m.id,
        name: displayName(m),
        role: m.role,
        trait: m.cultural_index_trait,
        store_number: store ? String(store.number) : null,
        store_name: store ? store.name : null,
      };
    })
    .sort(
      (a, b) =>
        (roleRank[b.role] ?? 0) - (roleRank[a.role] ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

// Stable hash of the team composition — members + their traits. Changes when a
// trait changes or someone joins/leaves, which auto-invalidates the cache.
function teamHash(team) {
  const basis = team
    .map((t) => `${t.id}:${String(t.trait).toLowerCase()}`)
    .sort()
    .join("|");
  return createHash("sha1").update(basis).digest("hex");
}

async function getTeam(supa, leader) {
  const team = await resolveTeam(supa, leader);
  let hasPlaybook = false;
  if (team.length) {
    // Tolerate the cache table not existing yet (migration 0294 unapplied) —
    // the team map still renders; there's just no saved playbook to auto-load.
    const { data, error } = await supa
      .from("trait_playbook_cache")
      .select("id")
      .eq("leader_id", leader.id)
      .eq("team_hash", teamHash(team))
      .maybeSingle();
    hasPlaybook = !error && !!data;
  }
  return { leader: { id: leader.id, name: displayName(leader), role: leader.role }, members: team, has_playbook: hasPlaybook };
}

function buildPrompt(leader, team) {
  // Only the definitions for traits actually on this team — keeps the prompt
  // tight and the grounding relevant.
  const seen = new Map();
  for (const m of team) {
    const p = ciPatternForTrait(m.trait);
    if (p && !seen.has(p.id)) seen.set(p.id, p);
  }
  const defs = [...seen.values()]
    .map(
      (p) =>
        `### ${p.name}\n- Essence: ${p.essence}\n- Strengths: ${p.strengths}\n- Watch-outs: ${p.watchouts}\n- Motivators: ${p.motivators}\n- Working style: ${p.style}`,
    )
    .join("\n\n");

  const roster = team
    .map(
      (m) =>
        `- ${m.name} — ${String(m.role).toUpperCase()}${m.store_number ? ` — #${m.store_number}${m.store_name ? ` ${m.store_name}` : ""}` : ""} — Culture Index: ${ciPatternForTrait(m.trait)?.name || m.trait}`,
    )
    .join("\n");

  return (
    `You are a seasoned multi-unit operations coach for Sonic Drive-In, advising ${displayName(leader)} (a ${String(leader.role).toUpperCase()}) on how to lead their team, using each person's Culture Index profile.\n\n` +
    `THE TEAM:\n${roster}\n\n` +
    `CULTURE INDEX DEFINITIONS (ground everything you say in these — do not invent traits):\n${defs}\n\n` +
    `Write practical, specific coaching for a store-operations context. Return ONLY valid minified JSON (no markdown fence, no prose outside the JSON) in exactly this shape:\n` +
    `{"overview": string, "members": [{"id": string, "name": string, "coaching": string}], "dynamics": string, "actions": [string, string, string]}\n\n` +
    `Rules:\n` +
    `- "overview": 2-3 sentences reading the team's overall Culture Index composition and what it means for how to lead THIS group.\n` +
    `- "members": one entry per person, in the same order given. Use the exact id and name provided. "coaching" is 2-3 sentences: how to communicate with, motivate, delegate to, and give feedback to this person given their pattern — concrete and store-ops specific.\n` +
    `- "dynamics": 2-3 sentences on friction and complementarity across the team (e.g. two thin-skinned perfectionists, or a visionary who needs a detail-strong executor).\n` +
    `- "actions": exactly 3 concrete things this leader can do THIS WEEK.\n` +
    `- Never present a trait as a verdict on ability. Frame gaps as coaching paths; traits are defaults, not ceilings.\n` +
    `- Keep the total response under 500 words.`
  );
}

function parseModelJson(text) {
  if (!text) return null;
  // Be forgiving: strip an accidental ```json fence, then take the outermost {...}.
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

async function coach(supa, leader, body) {
  const force = body?.force === true && leader.role === "admin";
  const team = await resolveTeam(supa, leader);
  if (team.length === 0) {
    return { error: "No one on your team has a Culture Index trait yet.", status: 400 };
  }
  const hash = teamHash(team);

  if (!force) {
    const { data: cached } = await supa
      .from("trait_playbook_cache")
      .select("content, model, generated_at")
      .eq("leader_id", leader.id)
      .eq("team_hash", hash)
      .maybeSingle();
    if (cached) {
      return { ok: true, content: cached.content, cached: true, generatedAt: cached.generated_at, model: cached.model || null };
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "ANTHROPIC_API_KEY missing on server.", status: 500 };
  }

  const prompt = buildPrompt(leader, team);
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error("[trait-playbook] anthropic error:", apiRes.status, errText);
    return { error: `Anthropic returned ${apiRes.status}.`, status: 502 };
  }
  const apiJson = await apiRes.json();
  const raw = apiJson?.content?.[0]?.text;
  const parsed = parseModelJson(raw);
  if (!parsed || !Array.isArray(parsed.members)) {
    console.error("[trait-playbook] unparseable model output:", raw);
    return { error: "The model returned an unexpected format. Try regenerating.", status: 502 };
  }

  // Re-attach role + store to each member from OUR data (don't trust the model
  // to echo them) so the UI can render them reliably.
  const byId = new Map(team.map((t) => [t.id, t]));
  const members = (parsed.members || [])
    .map((m) => {
      const t = byId.get(m.id) || team.find((x) => x.name === m.name);
      if (!t) return null;
      return { id: t.id, name: t.name, role: t.role, trait: t.trait, store_number: t.store_number, store_name: t.store_name, coaching: String(m.coaching || "") };
    })
    .filter(Boolean);

  const content = {
    overview: String(parsed.overview || ""),
    dynamics: String(parsed.dynamics || ""),
    actions: Array.isArray(parsed.actions) ? parsed.actions.map(String).slice(0, 5) : [],
    members,
  };

  const generatedAt = new Date().toISOString();
  const { error: upErr } = await supa
    .from("trait_playbook_cache")
    .upsert(
      { leader_id: leader.id, team_hash: hash, content, model: MODEL, generated_by: leader.id, generated_at: generatedAt },
      { onConflict: "leader_id,team_hash" },
    );
  if (upErr) console.warn("[trait-playbook] cache write failed:", upErr.message);

  return { ok: true, content, cached: false, generatedAt, model: MODEL };
}

function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let leader;
  try {
    leader = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!leader) return respond(401, { error: "unauthorized" });
  if (!LEADER_ROLES.has(String(leader.role).toLowerCase())) {
    return respond(403, { error: "The Team Playbook is for DO and above." });
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "team";

  try {
    const supa = admin();
    if (event.httpMethod === "GET" && action === "team") {
      return unwrap(await getTeam(supa, leader));
    }
    if (event.httpMethod === "POST" && action === "coach") {
      const body = event.body ? JSON.parse(event.body) : {};
      return unwrap(await coach(supa, leader, body));
    }
    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    console.error("[trait-playbook] error:", e);
    return respond(500, { error: e.message || "server error" });
  }
};
