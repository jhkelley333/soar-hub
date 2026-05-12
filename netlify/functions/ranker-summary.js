// netlify/functions/ranker-summary.js
//
// Server-side AI weekly summary for a single (store, week). Caches
// results in public.ranker_ai_summaries so repeated views never re-bill
// the Anthropic API. Admins can pass force=true to regenerate.
//
//   POST /.netlify/functions/ranker-summary
//   body: { store: "1234", week: 19, force?: false }
//   -> { ok, summary, cached, generatedAt, model }

import {
  corsOptions, respond,
  supabaseAdmin, getCallerProfile, getCallerStoreNumbers,
  getSheetsClient, batchGetWeeks, findRowByStore, buildStoreMetricObject,
} from "./_lib/ranker-sheets.js";

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsOptions();
  if (event.httpMethod !== "POST") {
    return respond(405, { ok: false, message: "method not allowed" });
  }

  const profile = await getCallerProfile(event);
  if (!profile) return respond(401, { ok: false, message: "unauthorized" });

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return respond(400, { ok: false, message: "invalid JSON body" });
  }
  const store = String(body.store || "").trim();
  const week  = parseInt(body.week, 10);
  // force=true only honored for admins. Everyone else is locked to the
  // cached result once generated — protects the API key from accidental
  // cost-stacking via repeat clicks.
  const force = body.force === true && profile.role === "admin";

  if (!store || !Number.isInteger(week) || week < 1 || week > 53) {
    return respond(400, { ok: false, message: "store + week (1..53) required." });
  }

  try {
    const supa = supabaseAdmin();

    // Scope check.
    const visible = await getCallerStoreNumbers(supa, profile);
    if (!visible.includes(store)) {
      return respond(403, { ok: false, message: "store outside your scope" });
    }

    // Cache lookup.
    if (!force) {
      const { data: cached } = await supa
        .from("ranker_ai_summaries")
        .select("summary, model, generated_at")
        .eq("store_number", store)
        .eq("week", week)
        .maybeSingle();
      if (cached) {
        return respond(200, {
          ok: true,
          summary: cached.summary,
          cached: true,
          generatedAt: cached.generated_at,
          model: cached.model || null,
        });
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return respond(500, { ok: false, message: "ANTHROPIC_API_KEY missing on server." });
    }

    // Cache miss → fetch sheet data server-side. We don't trust client-
    // supplied metric blobs because they could be spoofed and we'd
    // happily generate a hallucinated summary for fake numbers.
    const sheets   = await getSheetsClient();
    const weekStr  = String(week);
    const priorStr = String(week - 1);
    const wkMap    = await batchGetWeeks(sheets, week > 1 ? [weekStr, priorStr] : [weekStr]);
    const wk       = wkMap.get(weekStr) || { headers: [], idx: {}, rows: [] };
    const row      = findRowByStore(wk.rows, store);
    if (!row) {
      return respond(404, { ok: false, message: `no data for store ${store} in week ${week}.` });
    }
    const metrics = buildStoreMetricObject(row, wk.idx);
    let prior = null;
    if (week > 1) {
      const pw   = wkMap.get(priorStr) || { headers: [], idx: {}, rows: [] };
      const prow = findRowByStore(pw.rows, store);
      if (prow) prior = buildStoreMetricObject(prow, pw.idx);
    }

    const prompt = buildPrompt(metrics, prior, store, week);

    // Anthropic call.
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("[ranker-summary] anthropic error:", apiRes.status, errText);
      return respond(502, {
        ok: false,
        message: `Anthropic returned ${apiRes.status}.`,
      });
    }
    const apiJson = await apiRes.json();
    const summary = apiJson?.content?.[0]?.text;
    if (!summary) {
      console.error("[ranker-summary] empty response:", apiJson);
      return respond(502, { ok: false, message: "Empty summary from model." });
    }

    // Cache UPSERT.
    const generatedAt = new Date().toISOString();
    const { error: upErr } = await supa
      .from("ranker_ai_summaries")
      .upsert({
        store_number: store,
        week,
        summary,
        model: MODEL,
        generated_by: profile.id,
        generated_at: generatedAt,
      }, { onConflict: "store_number,week" });
    if (upErr) {
      // Don't strand the caller — they paid for the generation, return
      // the text even if the cache write failed. Surface the failure
      // in logs so we can investigate.
      console.warn("[ranker-summary] cache write failed:", upErr);
    }

    return respond(200, {
      ok: true,
      summary,
      cached: false,
      generatedAt,
      model: MODEL,
    });
  } catch (e) {
    console.error("[ranker-summary] error:", e);
    return respond(500, { ok: false, message: e.message || "server error" });
  }
};

function fmt(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).trim();
}

function buildPrompt(m, prior, store, week) {
  const lines = [
    `Store: ${fmt(m.storeName)} (#${store})`,
    `GM: ${fmt(m.gmName)}`,
    `Week: ${week}`,
    `Rank: ${fmt(m.storeRank)}${prior ? ` (prior: ${fmt(prior.storeRank)})` : ""}`,
    `Weekly Sales: ${fmt(m.weeklySales)}${prior ? ` (prior: ${fmt(prior.weeklySales)})` : ""}`,
    `% vs LY: ${fmt(m.vsLastYear)}`,
    `COGS Eff %: ${fmt(m.cogsEff)}`,
    `Annualized FC Miss: ${fmt(m.annualizedFcMiss)}`,
    `Labor %: ${fmt(m.laborPct)}${prior ? ` (prior: ${fmt(prior.laborPct)})` : ""}`,
    `Variance to Chart: ${fmt(m.varToChart)}`,
    `BSC Training %: ${fmt(m.bscTraining)}`,
    `On Time Tickets: ${fmt(m.onTimeTickets)}`,
    `VOG Week: ${fmt(m.vogWeek)}`,
    `VOG Count: ${fmt(m.vogCount)} (target: 21)`,
    `Complaints: ${fmt(m.complaints)}`,
    `Calls /10k: ${fmt(m.callsPer10k)}`,
  ];
  return (
    "You are an operations coach for Sonic Drive-In. Write a concise, direct " +
    "weekly performance summary for the GM of this store. The tone should be " +
    "professional but human — like a respected senior operator writing directly " +
    "to a GM.\n\n" +
    "Structure it as:\n" +
    "1) One-sentence overall performance read.\n" +
    "2) Top 2 wins this week (be specific with numbers).\n" +
    "3) Top 2-3 focus areas (be direct about what needs attention and why).\n" +
    "4) One closing sentence of encouragement or challenge.\n\n" +
    "Do NOT use bullet points. Write in flowing paragraphs. Keep it under 200 words.\n\n" +
    "Store data:\n" + lines.join("\n")
  );
}
