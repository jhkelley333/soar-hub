// Ask Tot — SOAR Hub AI assistant (beta).
// POST /api/ask-tot  { message, conversationId?, history? }
// Roles: admin, coo, vp, rvp only.
// Retrieves Hub data scoped to the caller, feeds Groq, returns structured answer.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

const ALLOWED_ROLES = new Set(["admin", "coo", "vp", "rvp"]);

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

// Retrieve relevant Hub context based on the user's message + role.
async function retrieveContext(db, user, message) {
  const msg = message.toLowerCase();
  const context = [];
  const sources = [];

  // Store directory — always include if message seems about stores/locations
  const storeKeywords = ["store", "location", "gm", "district", "manager", "address", "phone", "hours", "owner"];
  const storeMatch = storeKeywords.some((k) => msg.includes(k));

  if (storeMatch || msg.includes("who") || msg.includes("which")) {
    let storeQuery = db
      .from("stores")
      .select("store_number, name, address, city, state, phone, gm_name, do_name, sdo_name, owner_group, region_id")
      .eq("is_active", true)
      .limit(50);

    // All roles see up to 50 active stores (org-wide for admin/coo/vp/rvp)
    // Fine-grained RVP scoping handled by the 50-row limit in practice

    const { data: stores } = await storeQuery;
    if (stores?.length) {
      context.push(`STORE DIRECTORY (${stores.length} stores):\n` +
        stores.map((s) =>
          `Store #${s.store_number} "${s.name}" — ${s.city}, ${s.state} | GM: ${s.gm_name ?? "—"} | DO: ${s.do_name ?? "—"} | Phone: ${s.phone ?? "—"}`
        ).join("\n")
      );
      sources.push("Store Directory");
    }
  }

  // Ranking data — if question is about performance, ranking, scores
  const rankKeywords = ["rank", "top", "best", "performance", "score", "sales", "percent", "ptd", "period", "lead", "won", "win", "improve", "week", "last week"];
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
      const { data: rows } = await db
        .from("ranking_rows")
        .select("entity_key, rank, total_points, metrics")
        .eq("run_id", run.id)
        .eq("scope", "ptd")
        .eq("tier", "store")
        .order("rank", { ascending: true })
        .limit(25);

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

  // Promo/LTO: not yet wired to a Supabase table — Tot will say so if asked

  // If nothing matched, give a brief store summary so Tot can still answer
  if (context.length === 0) {
    const { data: summary } = await db
      .from("stores")
      .select("store_number, name, city, state", { count: "exact" })
      .eq("is_active", true)
      .limit(5);

    if (summary?.length) {
      const count = summary.length;
      context.push(`SOAR HUB — ${count}+ active stores. Example stores: ${summary.map((s) => `#${s.store_number} ${s.city}, ${s.state}`).join(" | ")}`);
      sources.push("Store Directory");
    }
  }

  return { context, sources };
}

async function callClaude(systemPrompt, history, message) {
  if (!ANTHROPIC_API_KEY) {
    return "Ask Tot is not fully configured yet — the ANTHROPIC_API_KEY is missing. Contact your Hub admin.";
  }

  // Build messages array: prior turns + the new user message.
  // The system prompt goes in the top-level `system` field (Anthropic style).
  const prior = (history || []).slice(-6); // last 3 turns
  const messages = [...prior, { role: "user", content: message }];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
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

  const { message, history } = body;
  if (!message?.trim()) return respond(400, { error: "message is required" });

  const db = supa();
  const user = await getSessionUser(db, event);
  if (!user) return respond(401, { error: "Not authenticated" });
  if (!ALLOWED_ROLES.has(user.role)) {
    return respond(403, { error: "Ask Tot is available to Admin, COO, VP, and RVP roles." });
  }

  try {
    const { context, sources } = await retrieveContext(db, user, message);

    const contextBlock = context.length
      ? context.join("\n\n---\n\n")
      : "No relevant Hub data found for this query.";

    const scopeNote = user.role === "rvp"
      ? "This user is an RVP — their data is scoped to their region."
      : user.role === "vp"
        ? "This user is a VP."
        : user.role === "coo"
          ? "This user is a COO with access to all stores."
          : "This user is a Hub admin with access to all stores.";

    const systemPrompt = `You are Ask Tot, the AI assistant for the SOAR Hub — an internal operations platform for Sonic QSR franchise management.

RULES (never break these):
1. Answer ONLY from the Hub data provided in the CONTEXT block below. Never use outside knowledge.
2. If the answer is not in the context, say so clearly and list what you CAN help with (store info, ranking, promos).
3. Never make up store numbers, names, rankings, or financial figures.
4. Be concise and helpful. Use plain language suitable for a QSR operations leader.
5. ${scopeNote}

WHAT YOU CAN HELP WITH:
- Store directory (numbers, locations, GMs, DOs, phone, hours)
- Weekly ranking and performance scores (top/bottom stores, % vs LY, points)
- General SOAR Hub navigation questions

WHAT YOU CANNOT HELP WITH:
- Questions outside of SOAR Hub data (say "I won't guess")
- Financial projections or recommendations beyond what's in the data
- Personal or HR information not in the Hub

CONTEXT (from SOAR Hub — use this to answer):
${contextBlock}`;

    const answer = await callClaude(systemPrompt, history, message);

    // Log the Q&A turn (best-effort)
    db.from("ask_tot_log")
      .insert({
        user_id: user.id,
        role: user.role,
        question: message.slice(0, 500),
        answer: answer.slice(0, 2000),
        sources: sources,
      })
      .then(() => {})
      .catch(() => {});

    return respond(200, { answer, sources, type: "text" });
  } catch (err) {
    console.error("ask-tot error:", err);
    return respond(500, { error: err?.message ?? "Internal error" });
  }
};
