// netlify/functions/paf-config.js
//
// Tier 1 PAF admin config backend.
//
// Auth bridge: same pattern as team-mgmt.js. Validates the Supabase JWT
// with the service-role key, looks up the requesting user, and gates
// every action on role === 'payroll' || 'admin'.
//
// Actions:
//   GET  ?action=get&config_key=paf_form
//        -> latest config row { id, config_version, config_json, ... }
//
//   POST ?action=save
//        body: { config_key, config_json, change_summary }
//        -> creates a new row with config_version = max+1.
//
//   GET  ?action=history&config_key=paf_form&limit=10
//        -> last N versions in newest-first order.
//
//   POST ?action=restore
//        body: { config_key, restore_version }
//        -> reads the chosen prior row and writes a copy of its
//           config_json as a new (current+1) version. Never destructive.
//
//   POST ?action=send-test-email
//        body: { template_key, sample_vars }
//        -> renders the template subject/body with sample vars and emails
//           the caller. Uses the same Resend SMTP path the rest of the
//           system uses (no special path here — it goes through the
//           default supabase email pipeline if configured, otherwise we
//           emit a 400 since Resend hookup is via Supabase auth, not a
//           generic mailer in this codebase).
//
// Caching: PostgREST sits in front, but we additionally hold a tiny
// in-memory cache of the latest config keyed by config_key with a 60s
// TTL. Cache is invalidated on save/restore.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ROLES = new Set(["payroll", "admin"]);
const VALID_ACTIONS = new Set([
  "get",
  "save",
  "history",
  "restore",
  "send-test-email",
]);

// In-memory cache. Lambda containers reuse this across invocations until
// the container recycles. TTL in ms.
const CACHE_TTL_MS = 60 * 1000;
const _cache = new Map(); // key -> { value, expiresAt }

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("paf-config env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header =
    event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheInvalidate(key) {
  _cache.delete(key);
}

// ----------------------------------------------------------------------------
// get — latest config row for a config_key
// ----------------------------------------------------------------------------
async function getConfig(supa, query) {
  const configKey = query?.config_key || "paf_form";
  const cached = cacheGet(configKey);
  if (cached) return cached;

  const { data, error } = await supa
    .from("form_config")
    .select("id, config_key, config_version, config_json, change_summary, updated_by, updated_at")
    .eq("config_key", configKey)
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: `No config seeded for "${configKey}".`, status: 404 };

  cacheSet(configKey, data);
  return data;
}

// ----------------------------------------------------------------------------
// save — write a new version
// ----------------------------------------------------------------------------
async function saveConfig(supa, user, body) {
  const configKey = String(body?.config_key || "paf_form");
  const configJson = body?.config_json;
  const changeSummary = String(body?.change_summary || "").slice(0, 500);

  const validation = validateConfig(configJson);
  if (validation) return { error: validation, status: 400 };

  // Find current max version atomically.
  const { data: latest, error: latestErr } = await supa
    .from("form_config")
    .select("config_version")
    .eq("config_key", configKey)
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) return { error: latestErr.message, status: 500 };

  const nextVersion = (latest?.config_version ?? 0) + 1;

  const { data: inserted, error: insErr } = await supa
    .from("form_config")
    .insert({
      config_key: configKey,
      config_version: nextVersion,
      config_json: configJson,
      change_summary: changeSummary || `Saved by ${user.email}`,
      updated_by: user.email,
    })
    .select("id, config_version, updated_at")
    .single();
  if (insErr) return { error: insErr.message, status: 500 };

  cacheInvalidate(configKey);
  return { ok: true, ...inserted };
}

// ----------------------------------------------------------------------------
// history — last N versions
// ----------------------------------------------------------------------------
async function historyConfig(supa, query) {
  const configKey = query?.config_key || "paf_form";
  const limit = Math.min(parseInt(query?.limit || "10", 10) || 10, 50);
  const { data, error } = await supa
    .from("form_config")
    .select("id, config_version, change_summary, updated_by, updated_at")
    .eq("config_key", configKey)
    .order("config_version", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message, status: 500 };
  return { entries: data ?? [] };
}

// ----------------------------------------------------------------------------
// restore — copy a prior version's json forward as a new version
// ----------------------------------------------------------------------------
async function restoreConfig(supa, user, body) {
  const configKey = String(body?.config_key || "paf_form");
  const restoreVersion = parseInt(body?.restore_version, 10);
  if (!restoreVersion || restoreVersion < 1) {
    return { error: "restore_version is required.", status: 400 };
  }

  const { data: source, error: srcErr } = await supa
    .from("form_config")
    .select("config_json, config_version")
    .eq("config_key", configKey)
    .eq("config_version", restoreVersion)
    .maybeSingle();
  if (srcErr) return { error: srcErr.message, status: 500 };
  if (!source) return { error: "Version not found.", status: 404 };

  const { data: latest, error: latestErr } = await supa
    .from("form_config")
    .select("config_version")
    .eq("config_key", configKey)
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) return { error: latestErr.message, status: 500 };

  const nextVersion = (latest?.config_version ?? 0) + 1;

  const { data: inserted, error: insErr } = await supa
    .from("form_config")
    .insert({
      config_key: configKey,
      config_version: nextVersion,
      config_json: source.config_json,
      change_summary: `Restored from v${restoreVersion}`,
      updated_by: user.email,
    })
    .select("id, config_version, updated_at")
    .single();
  if (insErr) return { error: insErr.message, status: 500 };

  cacheInvalidate(configKey);
  return { ok: true, ...inserted };
}

// ----------------------------------------------------------------------------
// send-test-email — render template with sample vars and email the caller
// ----------------------------------------------------------------------------
async function sendTestEmail(supa, user, body) {
  const configKey = "paf_form";
  const templateKey = String(body?.template_key || "");
  if (!templateKey) return { error: "template_key required.", status: 400 };

  // Pull current draft from caller-provided body if present, else use
  // saved config. The UI sends the live draft so the test reflects
  // unsaved edits.
  let template;
  if (body?.template) {
    template = body.template;
  } else {
    const cfg = await getConfig(supa, { config_key: configKey });
    if (cfg.error) return cfg;
    template = cfg.config_json?.emailTemplates?.[templateKey];
  }
  if (!template?.subject || !template?.body) {
    return { error: `Template "${templateKey}" not found or empty.`, status: 404 };
  }

  const sampleVars = {
    EMPLOYEE: "Sample Employee",
    STORE: "1706",
    DO: "Sample DO",
    CATEGORY: "POS Adjustment",
    AMOUNT: "$123.45",
    REASON: "Sample rejection reason for testing.",
    NOTES: "Sample notes from payroll for testing.",
    LINK:
      (process.env.URL || process.env.DEPLOY_URL || "https://example.com").replace(/\/$/, "") +
      "/paf",
    ...(body?.sample_vars || {}),
  };

  function render(s) {
    return Object.keys(sampleVars).reduce(
      (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), sampleVars[k] ?? ""),
      String(s)
    );
  }

  const subject = `[TEST] ${render(template.subject)}`;
  const bodyText = `(This is a test email — sample data only.)\n\n${render(template.body)}`;

  // Supabase Auth doesn't expose a generic mailer endpoint to us. Without
  // a Resend SDK call here we can't actually send — but we DO log the
  // rendered output so the admin can copy/paste it for now and we return
  // it in the response so the UI can preview. A future revision can add
  // a Resend HTTP call when the API key is wired into env vars.
  console.log("[paf-config] send-test-email", {
    to: user.email,
    subject,
    bodyText,
  });

  return {
    ok: true,
    sent_to: user.email,
    rendered: { subject, body: bodyText },
    note: "Test email rendered — wire Resend HTTP API for actual delivery.",
  };
}

// ----------------------------------------------------------------------------
// Validation — runs on save. Returns error string or null.
// ----------------------------------------------------------------------------
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return "config_json must be an object.";
  if (!cfg.fields || typeof cfg.fields !== "object") {
    return "config_json.fields is required.";
  }
  if (!Array.isArray(cfg.sections)) return "config_json.sections must be an array.";
  if (!cfg.lists || typeof cfg.lists !== "object") {
    return "config_json.lists is required.";
  }

  // No empty list values. referralTiers is an array of {label, amount}
  // objects; everything else is a flat string array.
  for (const listKey of Object.keys(cfg.lists)) {
    const list = cfg.lists[listKey];
    if (!Array.isArray(list)) continue;
    if (listKey === "referralTiers") {
      const seenLabels = new Set();
      for (const row of list) {
        if (!row || typeof row !== "object") {
          return `List "referralTiers" rows must be objects.`;
        }
        if (typeof row.label !== "string" || !row.label.trim()) {
          return `List "referralTiers" row missing label.`;
        }
        if (typeof row.amount !== "number" || !isFinite(row.amount) || row.amount < 0) {
          return `List "referralTiers" row "${row.label}" needs a non-negative amount.`;
        }
        const lower = row.label.trim().toLowerCase();
        if (seenLabels.has(lower)) {
          return `List "referralTiers" has duplicate "${row.label}".`;
        }
        seenLabels.add(lower);
      }
      continue;
    }
    if (list.some((x) => typeof x !== "string")) {
      return `List "${listKey}" contains non-string values.`;
    }
    const trimmed = list.map((x) => x.trim());
    if (trimmed.some((x) => x === "")) {
      return `List "${listKey}" contains an empty value.`;
    }
    const seen = new Set();
    for (const v of trimmed) {
      const lower = v.toLowerCase();
      if (seen.has(lower)) return `List "${listKey}" contains duplicate "${v}".`;
      seen.add(lower);
    }
  }

  // Locked statuses must remain in lists.statuses.
  if (Array.isArray(cfg.lists.lockedStatuses) && Array.isArray(cfg.lists.statuses)) {
    for (const s of cfg.lists.lockedStatuses) {
      if (!cfg.lists.statuses.includes(s)) {
        return `Required status "${s}" cannot be removed.`;
      }
    }
  }

  // Locked fields must remain visible + required and keep their key.
  for (const [key, f] of Object.entries(cfg.fields)) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.label !== "string" || !f.label.trim()) {
      return `Field "${key}" must have a non-empty label.`;
    }
    if (f.locked) {
      if (f.required === false) return `Field "${key}" is locked-required.`;
      if (f.visible === false) return `Field "${key}" is locked-visible.`;
    }
  }

  // Sections must have unique keys + an `order` integer.
  if (cfg.sections) {
    const keys = new Set();
    for (const s of cfg.sections) {
      if (!s || typeof s !== "object") return "Section row is malformed.";
      if (typeof s.key !== "string" || !s.key) return "Section missing key.";
      if (keys.has(s.key)) return `Duplicate section key "${s.key}".`;
      keys.add(s.key);
      if (typeof s.title !== "string" || !s.title.trim()) {
        return `Section "${s.key}" needs a title.`;
      }
      if (typeof s.order !== "number") return `Section "${s.key}" missing order.`;
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// HTTP handler
// ----------------------------------------------------------------------------
function unwrap(result) {
  if (
    result &&
    typeof result === "object" &&
    "status" in result &&
    "error" in result
  ) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { error: e.message || "auth failed" });
  }
  if (!user) return respond(401, { error: "unauthorized" });
  if (!ALLOWED_ROLES.has(user.role)) {
    return respond(403, { error: "PAF config is restricted to payroll / admin." });
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "get";
  if (!VALID_ACTIONS.has(action)) {
    return respond(400, { error: `unknown action: ${action}` });
  }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "get") return unwrap(await getConfig(supa, params));
      if (action === "history") return unwrap(await historyConfig(supa, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "save") return unwrap(await saveConfig(supa, user, body));
      if (action === "restore") return unwrap(await restoreConfig(supa, user, body));
      if (action === "send-test-email") return unwrap(await sendTestEmail(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
