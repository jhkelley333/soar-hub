// netlify/functions/trait-playbook-background.js
//
// Background generator for the DO Playbook. Netlify runs any function whose
// filename ends in "-background" asynchronously: the client gets a 202
// immediately and this keeps running (up to 15 min), well clear of the 10s
// synchronous timeout that was 504-ing the coaching call.
//
// It authenticates the caller, generates the coaching, and writes it to
// trait_playbook_cache. The page polls trait-playbook?action=coach until the
// result appears.
//
//   POST /.netlify/functions/trait-playbook-background   { force? }

import { admin, getSessionUser, generateAndCache, LEADER_ROLES } from "./_lib/traitPlaybook.js";

export const handler = async (event) => {
  // Background invocations are POST-only; anything else is a no-op.
  if (event.httpMethod !== "POST") return { statusCode: 202, body: "" };

  let leader;
  try {
    leader = await getSessionUser(event);
  } catch (e) {
    console.error("[trait-playbook-bg] auth error:", e?.message || e);
    return { statusCode: 202, body: "" };
  }
  if (!leader || !LEADER_ROLES.has(String(leader.role).toLowerCase())) {
    console.warn("[trait-playbook-bg] unauthorized or non-leader caller");
    return { statusCode: 202, body: "" };
  }

  let force = false;
  let region = null;
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    force = body.force === true && leader.role === "admin";
    region = body.region || null;
  } catch {
    /* ignore malformed body */
  }

  try {
    const supa = admin();
    const result = await generateAndCache(supa, leader, { force, region });
    if (result.error) console.error("[trait-playbook-bg] generation failed:", result.error);
    else console.log("[trait-playbook-bg] generated playbook for", leader.id);
  } catch (e) {
    console.error("[trait-playbook-bg] error:", e?.message || e);
  }
  // Client already received 202 at invocation; return value is ignored.
  return { statusCode: 202, body: "" };
};
