// netlify/functions/_lib/traitPlaybook.js
//
// Shared core for the DO Playbook, used by both the synchronous entrypoint
// (trait-playbook.js — team map + cache reads) and the background generator
// (trait-playbook-background.js — the Anthropic call, which can exceed the 10s
// synchronous timeout). Keeping the auth, team resolution, hashing, and
// prompt/parse logic here means the two functions can't drift.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ciPatternForTrait } from "./ciPatterns.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

// Cap how many people go into one generation. A DO's team is small; an
// admin/VP downline can be hundreds, which would blow the prompt and the
// response budget. Coach the first N (leaders-first ordering) and flag the rest.
const MAX_COACHED = 40;

export const LEADER_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

export function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("trait-playbook env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getSessionUser(event) {
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

// The caller's coachable team: manageable downline that carries a CI trait,
// leaders-first then by name. Store labels attached (chunked to stay under the
// API gateway's URL limit for large downlines).
async function fetchByIds(supa, table, cols, ids) {
  const arr = [...new Set(ids)].filter(Boolean);
  const out = [];
  for (let i = 0; i < arr.length; i += 150) {
    const { data } = await supa.from(table).select(cols).in("id", arr.slice(i, i + 150));
    if (data) out.push(...data);
  }
  return out;
}

// Each leader's region name, resolved from their scope (district → area →
// region, or area → region, or region directly). Used to coach one region at a
// time — a VP's whole downline is too big for one generation.
async function regionByMember(supa, memberIds) {
  const out = new Map();
  if (!memberIds.length) return out;
  const scopes = [];
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data } = await supa.from("user_scopes")
      .select("user_id, scope_type, scope_id")
      .in("user_id", memberIds.slice(i, i + 150));
    if (data) scopes.push(...data);
  }
  const districts = await fetchByIds(supa, "districts", "id, area_id",
    scopes.filter((s) => s.scope_type === "district").map((s) => s.scope_id));
  const dMap = new Map(districts.map((d) => [d.id, d]));
  const areaIds = [
    ...scopes.filter((s) => s.scope_type === "area").map((s) => s.scope_id),
    ...districts.map((d) => d.area_id),
  ];
  const areas = await fetchByIds(supa, "areas", "id, region_id", areaIds);
  const aMap = new Map(areas.map((a) => [a.id, a]));
  const regionIds = [
    ...scopes.filter((s) => s.scope_type === "region").map((s) => s.scope_id),
    ...areas.map((a) => a.region_id),
  ];
  const regions = await fetchByIds(supa, "regions", "id, name", regionIds);
  const rMap = new Map(regions.map((r) => [r.id, r]));

  const regionOfScope = (s) => {
    if (s.scope_type === "region") return rMap.get(s.scope_id)?.name || null;
    if (s.scope_type === "area") { const a = aMap.get(s.scope_id); return a ? rMap.get(a.region_id)?.name || null : null; }
    if (s.scope_type === "district") { const d = dMap.get(s.scope_id); const a = d ? aMap.get(d.area_id) : null; return a ? rMap.get(a.region_id)?.name || null : null; }
    return null;
  };
  for (const s of scopes) {
    if (out.get(s.user_id)) continue; // first resolvable scope wins
    const reg = regionOfScope(s);
    if (reg) out.set(s.user_id, reg);
  }
  return out;
}

export async function resolveTeam(supa, leader) {
  const { data: members, error } = await supa.rpc("manageable_users", { manager_id: leader.id });
  if (error) throw new Error(`manageable_users failed: ${error.message}`);
  const withTrait = (members || []).filter((m) => m.id !== leader.id && m.is_active && m.cultural_index_trait);

  const storeIds = [...new Set(withTrait.map((m) => m.primary_store_id).filter(Boolean))];
  const storeById = new Map();
  for (let i = 0; i < storeIds.length; i += 150) {
    const { data: stores } = await supa.from("stores").select("id, number, name").in("id", storeIds.slice(i, i + 150));
    for (const s of stores || []) storeById.set(s.id, s);
  }
  const regByMember = await regionByMember(supa, withTrait.map((m) => m.id));

  const roleRank = { rvp: 5, sdo: 4, do: 3, gm: 2 };
  return withTrait
    .map((m) => {
      const store = m.primary_store_id ? storeById.get(m.primary_store_id) : null;
      return {
        id: m.id,
        name: displayName(m),
        role: m.role,
        trait: m.cultural_index_trait,
        region: regByMember.get(m.id) || null,
        store_number: store ? String(store.number) : null,
        store_name: store ? store.name : null,
      };
    })
    .sort((a, b) => (roleRank[b.role] ?? 0) - (roleRank[a.role] ?? 0) || a.name.localeCompare(b.name));
}

// Filter a resolved team to one region (null/empty = whole team).
export function filterTeamByRegion(team, region) {
  if (!region) return team;
  return team.filter((m) => m.region === region);
}

// Stable hash of the team composition (members + traits) — the cache key.
export function teamHash(team) {
  const basis = team.map((t) => `${t.id}:${String(t.trait).toLowerCase()}`).sort().join("|");
  return createHash("sha1").update(basis).digest("hex");
}

function buildPrompt(leader, team, coached) {
  const seen = new Map();
  for (const m of coached) {
    const p = ciPatternForTrait(m.trait);
    if (p && !seen.has(p.id)) seen.set(p.id, p);
  }
  const defs = [...seen.values()]
    .map((p) => `### ${p.name}\n- Essence: ${p.essence}\n- Strengths: ${p.strengths}\n- Watch-outs: ${p.watchouts}\n- Motivators: ${p.motivators}\n- Working style: ${p.style}`)
    .join("\n\n");
  const roster = coached
    .map((m) => `- ${m.name} — ${String(m.role).toUpperCase()}${m.store_number ? ` — #${m.store_number}${m.store_name ? ` ${m.store_name}` : ""}` : ""} — Culture Index: ${ciPatternForTrait(m.trait)?.name || m.trait}`)
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
    `- "dynamics": 2-3 sentences on friction and complementarity across the team.\n` +
    `- "actions": exactly 3 concrete things this leader can do THIS WEEK.\n` +
    `- Never present a trait as a verdict on ability. Frame gaps as coaching paths; traits are defaults, not ceilings.\n` +
    `- Keep the total response under 600 words.`
  );
}

function parseModelJson(text) {
  if (!text) return null;
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

// Generate coaching for the leader's current team and upsert it into the cache.
// Runs the (slow) Anthropic call — call this only from a background function.
// Returns { ok, content } or { error }.
export async function generateAndCache(supa, leader, { force, region } = {}) {
  const team = filterTeamByRegion(await resolveTeam(supa, leader), region);
  if (team.length === 0) {
    return { error: region ? `No one in ${region} has a Culture Index trait yet.` : "No one on your team has a Culture Index trait yet." };
  }
  const hash = teamHash(team);

  if (!process.env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY missing on server." };

  const coached = team.slice(0, MAX_COACHED);
  const prompt = buildPrompt(leader, team, coached);

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error("[trait-playbook] anthropic error:", apiRes.status, errText);
    return { error: `Anthropic returned ${apiRes.status}.` };
  }
  const apiJson = await apiRes.json();
  const parsed = parseModelJson(apiJson?.content?.[0]?.text);
  if (!parsed || !Array.isArray(parsed.members)) return { error: "The model returned an unexpected format." };

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
    coached_count: coached.length,
    team_count: team.length,
    truncated: team.length > coached.length,
  };

  const generatedAt = new Date().toISOString();
  const { error: upErr } = await supa
    .from("trait_playbook_cache")
    .upsert({ leader_id: leader.id, team_hash: hash, content, model: MODEL, generated_by: leader.id, generated_at: generatedAt }, { onConflict: "leader_id,team_hash" });
  if (upErr) {
    console.error("[trait-playbook] cache write failed:", upErr.message);
    return { error: `Couldn't save the playbook: ${upErr.message}` };
  }
  void force; // force only affects whether the caller bypassed the cache read
  return { ok: true, content, generatedAt };
}
