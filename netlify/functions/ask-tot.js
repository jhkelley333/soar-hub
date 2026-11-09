// Ask Tot — SOAR Hub AI assistant (beta).
// POST /api/ask-tot  { message, history? }
// Roles: admin, coo, vp, rvp only.
// Retrieves Hub data (Supabase + Google Drive Resources) and answers from it.
//
// Phase 1 fixes:
//   - Correct store query (stores.number, gm_roster for GM names)
//   - RVP scoping enforced via resolveAskScope / user_visible_stores RPC
//   - redact() strips sensitive fields before anything reaches the model
//   - History sanitised server-side (strip system turns, cap 6)
//   - max_tokens raised to 2000; model from ASK_TOT_MODEL env var

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleCredentials } from "./_lib/googleCreds.js";
import { resolveAskScope, inScope } from "./_lib/askTotScope.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ASK_TOT_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

const ALLOWED_ROLES = new Set(["admin", "coo", "vp", "rvp"]);
const RESOURCES_ROOT = process.env.RESOURCES_ROOT_FOLDER_ID || "1E7ATygR2gg2CKny8NFhjVhee68HbsVkQ";

// ── Redaction ─────────────────────────────────────────────────────────────────
// Strip before anything reaches the model — PAF and roster fields that must
// never be spoken aloud. Applied to every row returned by any query.
const REDACT_KEYS = new Set([
  "last4_ssn", "action_token", "token_expires_at", "nh_offer_letter_path",
  "gm_cell", "gm_birthday", "birthday", "passport_expires_at",
]);
const REDACT_PATTERN = /ssn|token|password|secret/i;

function redact(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (REDACT_KEYS.has(k) || REDACT_PATTERN.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

function supa() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env vars not configured.");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

async function getSessionUser(db, event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data: userRes, error } = await db.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, role, full_name, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// Search Google Drive Resources for documents relevant to the question.
// Searches by name match; exports Google Docs as plain text (first 3 KB).
async function retrieveDriveDocuments(message) {
  const credentials = await getGoogleCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });

  const stopWords = new Set(["what", "which", "when", "where", "that", "this", "have", "with", "from", "about", "much", "many", "does", "will", "last", "week", "show", "tell"]);
  const keywords = [...new Set(
    message.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
  )].slice(0, 4);

  if (keywords.length === 0) return [];

  const nameQuery = keywords.map((k) => `name contains '${k}'`).join(" or ");
  const q = `(${nameQuery}) and '${RESOURCES_ROOT}' in parents and trashed=false and mimeType='application/vnd.google-apps.document'`;

  const res = await drive.files.list({
    q,
    fields: "files(id,name,mimeType)",
    pageSize: 3,
    orderBy: "modifiedTime desc",
  });

  const docs = [];
  for (const file of (res.data.files || []).slice(0, 2)) {
    try {
      const exported = await drive.files.export({ fileId: file.id, mimeType: "text/plain" }, { responseType: "text" });
      const text = String(exported.data || "").slice(0, 3000).trim();
      if (text) docs.push({ name: file.name, text });
    } catch {
      // Skip files that can't be exported
    }
  }
  return docs;
}

// Retrieve relevant Hub context based on the user's message + scope.
async function retrieveContext(db, scope, message) {
  const msg = message.toLowerCase();
  const context = [];
  const sources = [];

  // ── Store directory ──────────────────────────────────────────────────────
  const storeKeywords = ["store", "location", "gm", "district", "manager", "address", "who", "which"];
  const storeMatch = storeKeywords.some((k) => msg.includes(k));

  if (storeMatch && (scope.orgWide || scope.storeNumbers.size > 0)) {
    let storeQuery = db
      .from("stores")
      .select("number, name, city, state")
      .eq("is_active", true)
      .or("brand.eq.sonic,brand.is.null")
      .order("number")
      .limit(50);

    if (!scope.orgWide) {
      storeQuery = storeQuery.in("number", [...scope.storeNumbers]);
    }

    const { data: stores } = await storeQuery;
    if (stores?.length) {
      // Fetch GM names from gm_roster — redact gm_cell / gm_birthday
      const { data: gmRows } = await db
        .from("gm_roster")
        .select("store_number, gm_name, status, projected_gm_name")
        .in("store_number", stores.map((s) => s.number));

      const gmMap = {};
      for (const row of (gmRows ?? []).map(redact)) {
        gmMap[row.store_number] = row;
      }

      context.push(`STORE DIRECTORY (${stores.length} stores):\n` +
        stores.map((s) => {
          const gm = gmMap[s.number];
          const gmLabel = gm
            ? (gm.status === "named" ? (gm.gm_name ?? "—") : `Open (projected: ${gm.projected_gm_name ?? "—"})`)
            : "—";
          return `Store #${s.number} "${s.name}" — ${s.city}, ${s.state} | GM: ${gmLabel}`;
        }).join("\n")
      );
      sources.push("Store Directory");
    }
  }

  // ── Ranking data ─────────────────────────────────────────────────────────
  const rankKeywords = ["rank", "top", "best", "performance", "score", "sales", "percent", "ptd", "period", "lead", "won", "win", "improve", "week", "labor", "on-time", "ontime"];
  const rankMatch = rankKeywords.some((k) => msg.includes(k));

  if (rankMatch) {
    const { data: runs } = await db
      .from("ranking_runs")
      .select("id, period, week, week_ending")
      .eq("status", "complete")
      .order("week_ending", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(1);

    const run = runs?.[0];
    if (run) {
      let rankQuery = db
        .from("ranking_rows")
        .select("entity_key, rank, total_points, metrics")
        .eq("run_id", run.id)
        .eq("scope", "ptd")
        .eq("tier", "store")
        .order("rank", { ascending: true })
        .limit(scope.orgWide ? 25 : 100);

      // For scoped roles, filter to visible stores at the DB level
      if (!scope.orgWide) {
        if (scope.storeNumbers.size === 0) {
          rankQuery = null;
        } else {
          rankQuery = rankQuery.in("entity_key", [...scope.storeNumbers]);
        }
      }

      if (rankQuery) {
        const { data: rows } = await rankQuery;
        if (rows?.length) {
          context.push(`RANKING — P${run.period} W${run.week} (week ending ${run.week_ending}):\n` +
            rows.map((r) => {
              const m = r.metrics || {};
              const pct = typeof m.pctVsLy === "number" ? m.pctVsLy : null;
              const pctStr = pct != null ? `${(pct >= 0 ? "+" : "")}${(pct * 100).toFixed(1)}%` : "—";
              return `#${r.rank} Store ${r.entity_key} "${m.location ?? ""}" — Points: ${r.total_points?.toFixed(2) ?? "—"} | % vs LY: ${pctStr} | GM: ${m.gm ?? "—"} | DO: ${m.doName ?? "—"}`;
            }).join("\n")
          );
          sources.push(`Ranking › P${run.period} W${run.week}`);
        }
      }
    }
  }

  // ── Google Drive Resources ───────────────────────────────────────────────
  const driveResults = await retrieveDriveDocuments(message).catch(() => []);
  for (const doc of driveResults) {
    context.push(`RESOURCE DOCUMENT — "${doc.name}":\n${doc.text}`);
    sources.push(`Resources › ${doc.name}`);
  }

  // ── Fallback: brief store summary so Tot can still orient ────────────────
  if (context.length === 0) {
    const summaryQ = db
      .from("stores")
      .select("number, name, city, state")
      .eq("is_active", true)
      .or("brand.eq.sonic,brand.is.null")
      .order("number")
      .limit(5);

    const { data: summary } = scope.orgWide
      ? await summaryQ
      : scope.storeNumbers.size > 0
        ? await summaryQ.in("number", [...scope.storeNumbers])
        : { data: [] };

    if (summary?.length) {
      context.push(`SOAR HUB — active Sonic stores. Examples: ${summary.map((s) => `#${s.number} ${s.city}, ${s.state}`).join(" | ")}`);
      sources.push("Store Directory");
    }
  }

  return { context, sources };
}

async function callClaude(systemPrompt, history, message) {
  if (!ANTHROPIC_API_KEY) {
    return "Ask Tot is not fully configured yet — the ANTHROPIC_API_KEY is missing. Contact your Hub admin.";
  }

  const messages = [...history, { role: "user", content: message }];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data?.content?.[0]?.text ?? "No response from AI.";
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON" });
  }

  const { message } = body;
  if (!message?.trim()) return respond(400, { error: "message is required" });

  // Sanitise history from client: reject system turns, cap at 6 items
  const history = (body.history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6);

  const db = supa();
  const user = await getSessionUser(db, event);
  if (!user) return respond(401, { error: "Not authenticated" });
  if (!ALLOWED_ROLES.has(user.role)) {
    return respond(403, { error: "Ask Tot is available to Admin, COO, VP, and RVP roles." });
  }

  try {
    // Resolve caller scope once; every query in retrieveContext honours it
    const scope = await resolveAskScope(db, user);

    const { context, sources } = await retrieveContext(db, scope, message);

    const contextBlock = context.length
      ? context.join("\n\n---\n\n")
      : "No relevant Hub data found for this query.";

    const scopeSummary = scope.orgWide
      ? "org-wide access"
      : `${scope.storeNumbers.size} store(s) in your region`;

    const pafRule = ALLOWED_ROLES.has(user.role) && ["rvp", "vp", "coo", "admin"].includes(user.role)
      ? "PAF summary available to RVPs and above. PAF detail is available on the PAF Queue page."
      : "PAF questions are available to RVPs and above. Your RVP or Payroll can help.";

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are Ask Tot, the assistant inside SOAR Hub (Sonic, ~272 stores).
User: ${user.full_name ?? user.email}, role ${user.role}. Scope: ${scopeSummary}.
Today: ${today}.

Rules:
1. Answer only from the CONTEXT data below. If context is missing or empty, say so. Never guess store numbers, names, rankings, or financial figures.
2. Answer data questions from the CONTEXT block; never from memory or prior turns without re-checking.
3. Labor numbers come from the Ranker (Sunday WTD after credits). Say which week and that it's the Ranker.
4. PAF topics: ${pafRule}
5. Never reveal SSN digits, tokens, personal phone numbers, or birthdays, even if data was returned.
6. If the user asks about stores outside their scope, say they're outside what you can see; don't confirm or deny details.
7. Be brief: lead with the answer, then the key numbers, then where in the Hub to see it.
8. When you flag a problem (stacked credits, PTO without PAF, etc.), give the store, dates, $ and the Hub screen to fix it.

WHAT YOU CAN HELP WITH:
- Store directory (numbers, locations, GMs)
- Weekly ranking and performance scores (top/bottom stores, % vs LY, points)
- Resource library documents (operations guides, training materials, SOPs)
- General SOAR Hub navigation questions

CONTEXT (from SOAR Hub — use this to answer):
${contextBlock}`;

    const answer = await callClaude(systemPrompt, history, message);

    // Log the Q&A turn (best-effort, non-blocking)
    db.from("ask_tot_log")
      .insert({
        user_id: user.id,
        role: user.role,
        question: message.slice(0, 500),
        answer: answer.slice(0, 2000),
        sources,
      })
      .then(() => {})
      .catch(() => {});

    return respond(200, { answer, sources, type: "text" });
  } catch (err) {
    console.error("ask-tot error:", err);
    return respond(500, { error: err?.message ?? "Internal error" });
  }
};
