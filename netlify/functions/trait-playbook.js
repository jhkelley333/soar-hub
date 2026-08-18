// netlify/functions/trait-playbook.js
//
// DO Playbook — synchronous entrypoint. Fast operations only:
//   GET ?action=team   -> { leader, members:[...], has_playbook }
//   GET ?action=coach  -> { ready, content?, generatedAt? }   (cache read ONLY)
//
// The actual AI generation is slow (> the 10s synchronous timeout) and lives in
// trait-playbook-background.js. The page kicks that off and polls this coach
// read until the cached result appears.
//
// Leader-only (do/sdo/rvp/vp/coo/admin).

import { admin, getSessionUser, resolveTeam, filterTeamByRegion, teamHash, LEADER_ROLES } from "./_lib/traitPlaybook.js";

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

const displayName = (p) => p.full_name || p.preferred_name || p.email || "(unnamed)";

async function getTeam(supa, leader) {
  const team = await resolveTeam(supa, leader);
  const regions = [...new Set(team.map((m) => m.region).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { leader: { id: leader.id, name: displayName(leader), role: leader.role }, members: team, regions };
}

// Cache-only read — never generates. Returns whatever is saved for the leader's
// current team (optionally narrowed to one region).
async function readCoach(supa, leader, region) {
  const team = filterTeamByRegion(await resolveTeam(supa, leader), region);
  if (team.length === 0) return { ready: false, empty: true };
  const { data, error } = await supa
    .from("trait_playbook_cache")
    .select("content, generated_at")
    .eq("leader_id", leader.id)
    .eq("team_hash", teamHash(team))
    .maybeSingle();
  if (error || !data) return { ready: false };
  return { ready: true, content: data.content, generatedAt: data.generated_at };
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
  const region = params.region || null;
  try {
    const supa = admin();
    if (event.httpMethod === "GET" && action === "team") return respond(200, await getTeam(supa, leader));
    if (event.httpMethod === "GET" && action === "coach") return respond(200, await readCoach(supa, leader, region));
    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    console.error("[trait-playbook] error:", e);
    return respond(500, { error: e.message || "server error" });
  }
};
