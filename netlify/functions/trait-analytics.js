// netlify/functions/trait-analytics.js
//
// Executive Overview — trait × performance × store-stability analytics.
//
// Joins the latest ranking run (per-store performance) to each store's GM
// trait and a computed Stability Index (GM tenure + GM turnover + an active-
// transition flag), then aggregates HONESTLY:
//   - a leaderboard that flags thin samples instead of ranking them,
//   - a decomposition of how much of performance variance stability vs. trait
//     explains (the headline: is trait even the lever?),
//   - a trait × stability-tier heatmap (the interaction),
//   - roster coverage.
//
// Conservative by design: cells/traits below a minimum sample are marked
// "not enough signal yet" rather than crowned.
//
// GET ?action=overview -> { ... }
// VP / COO / admin only. Env: VITE_SUPABASE_URL (or SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { ciPatternForTrait } from "./_lib/ciPatterns.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXEC_ROLES = new Set(["vp", "coo", "admin"]);

// Conservative thresholds — below these, we show "not enough signal" instead
// of a ranked verdict.
const MIN_N_TRAIT = 10; // to appear in the ranked leaderboard
const MIN_N_CELL = 4; // to show a heatmap cell value

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("trait-analytics env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
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
  const { data: profile } = await supa.from("profiles").select("id, role, is_active").eq("id", userRes.user.id).single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// Page through a query whose result scales past PostgREST's 1000-row cap.
async function selectAll(supa, table, cols, refine) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supa.from(table).select(cols).range(from, from + 999);
    if (refine) q = refine(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ── stability helpers ────────────────────────────────────────────────────────

// Tolerant parse of the free-text roster dates ('3/16/26', '12/14/2021', etc.).
function parseLooseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    let year = parseInt(yy, 10);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(str);
  return isNaN(t) ? null : new Date(t);
}

function monthsSince(date, now) {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

// 0..1 sub-scores → composite 0..100 stability + a tier label.
function stabilityFor({ placementDate, turnover, activeTransition, rosterStatus }, now) {
  // Open / in-training stores, or a transition in progress, are turnarounds by
  // definition regardless of the numeric score.
  const forcedTurnaround =
    rosterStatus === "open" || rosterStatus === "in_training" || activeTransition;

  // Tenure: 2+ years at the store = full marks. Unknown date → neutral 0.5.
  let tenureScore = 0.5;
  if (placementDate) tenureScore = Math.max(0, Math.min(1, monthsSince(placementDate, now) / 24));

  // Turnover in the last 18 months: fewer GM swaps = more stable.
  const turnoverScore = turnover <= 0 ? 1 : turnover === 1 ? 0.55 : turnover === 2 ? 0.3 : 0.1;

  // Weights: tenure 0.55, turnover 0.35, active-transition 0.10 (as a clean/1 vs 0).
  const raw = 0.55 * tenureScore + 0.35 * turnoverScore + 0.1 * (activeTransition ? 0 : 1);
  let score = Math.round(raw * 100);
  if (forcedTurnaround) score = Math.min(score, 20);

  let tier;
  if (forcedTurnaround || score < 25) tier = "Turnaround";
  else if (score < 50) tier = "Volatile";
  else if (score < 75) tier = "Steady";
  else tier = "Stable";
  return { score, tier };
}

// ── stats ────────────────────────────────────────────────────────────────────

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(xs) {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1));
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}
// Share of variance in `values` explained by group membership (eta²).
function etaSquared(groups) {
  const all = [].concat(...groups.map((g) => g.values));
  if (all.length < 3) return 0;
  const grand = mean(all);
  const ssTotal = all.reduce((a, x) => a + (x - grand) ** 2, 0);
  if (ssTotal === 0) return 0;
  const ssBetween = groups.reduce((a, g) => a + g.values.length * (mean(g.values) - grand) ** 2, 0);
  return ssBetween / ssTotal;
}

// ── main ─────────────────────────────────────────────────────────────────────

const TIERS = ["Stable", "Steady", "Volatile", "Turnaround"];

async function overview(supa) {
  const now = new Date();

  // 1. Every ranker week (v1 sheet + v2 db) from the backfilled history.
  const weekRows = await selectAll(supa, "ranker_week_history", "store_number, week_key, rank");
  const rankedRows = weekRows.filter((r) => r.rank != null && r.store_number);
  if (rankedRows.length < 3) {
    return { error: "No ranker history yet — run the Ranker History Backfill (System Settings → Data & Imports) first.", status: 400 };
  }

  // 2. Percentile per store per week (rank 1 → 100, worst → 0, using THAT week's
  //    store count), then average per store across every week it appears in —
  //    the season-average that turns a noisy one-week snapshot into real signal.
  const byWeek = new Map();
  for (const r of rankedRows) {
    if (!byWeek.has(r.week_key)) byWeek.set(r.week_key, []);
    byWeek.get(r.week_key).push(r);
  }
  const weeksAnalyzed = byWeek.size;
  const acc = new Map(); // store_number -> { sum, n }
  for (const [, wr] of byWeek) {
    const n = wr.length;
    if (n < 2) continue;
    for (const r of wr) {
      const p = (100 * (n - r.rank)) / (n - 1);
      const a = acc.get(String(r.store_number)) || { sum: 0, n: 0 };
      a.sum += p; a.n += 1;
      acc.set(String(r.store_number), a);
    }
  }
  const seasonPct = new Map();
  for (const [num, a] of acc) if (a.n > 0) seasonPct.set(num, Math.round(a.sum / a.n));
  const storeNumbers = [...seasonPct.keys()];
  if (storeNumbers.length < 3) return { error: "Not enough ranked stores to analyze.", status: 400 };

  // 3. Trait per store_number: stores(number → id) → the GM's profile(id → trait).
  const storesMeta = [];
  for (let i = 0; i < storeNumbers.length; i += 150) {
    const part = await selectAll(supa, "stores", "id, number", (q) => q.in("number", storeNumbers.slice(i, i + 150)));
    storesMeta.push(...part);
  }
  const numById = new Map(storesMeta.map((s) => [s.id, String(s.number)]));
  // Every active GM's trait, indexed two ways so a store still resolves when one
  // link is stale: by the profile's primary_store_id, and by email (to match the
  // gm_roster below). We fetch ALL active GMs — not just those whose
  // primary_store_id already points at a ranked store — so a GM with an unset or
  // out-of-date primary_store_id isn't silently dropped from the analysis.
  const gmProfiles = await selectAll(supa, "profiles", "primary_store_id, email, cultural_index_trait", (q) =>
    q.eq("role", "gm").eq("is_active", true),
  );
  const traitByNum = new Map();   // store_number -> trait, resolved via primary_store_id
  const traitByEmail = new Map(); // lower(email)  -> trait, for the roster fallback
  for (const p of gmProfiles) {
    if (!p.cultural_index_trait) continue;
    const num = p.primary_store_id ? numById.get(p.primary_store_id) : null;
    if (num) traitByNum.set(num, p.cultural_index_trait);
    const email = (p.email || "").trim().toLowerCase();
    if (email && !traitByEmail.has(email)) traitByEmail.set(email, p.cultural_index_trait);
  }

  // 4. Stability inputs, keyed by store_number (= entity_key on store rows).
  const roster = await selectAll(supa, "gm_roster", "store_number, gm_email, placement_date, status");
  const rosterByNum = new Map(roster.map((r) => [String(r.store_number), r]));

  // Recover stores whose trait didn't resolve via primary_store_id by falling
  // back to the authoritative GM roster: store_number -> roster gm_email ->
  // active GM's trait. This is what pulls in active GMs who run a store per the
  // roster but whose profile primary_store_id is unset or stale. primary_store_id
  // wins where present; the roster only fills the gaps.
  let recoveredViaRoster = 0;
  for (const num of storeNumbers) {
    if (traitByNum.has(num)) continue;
    const email = (rosterByNum.get(num)?.gm_email || "").trim().toLowerCase();
    const trait = email ? traitByEmail.get(email) : null;
    if (trait) { traitByNum.set(num, trait); recoveredViaRoster += 1; }
  }

  const cutoff = new Date(now.getTime() - 18 * 30.44 * 24 * 60 * 60 * 1000).toISOString();
  const history = await selectAll(supa, "gm_roster_history", "store_number, old_gm_name, new_gm_name, changed_at", (q) =>
    q.gte("changed_at", cutoff),
  );
  const turnoverByNum = new Map();
  for (const h of history) {
    // Count only real GM swaps (a name actually changed hands).
    const a = (h.old_gm_name || "").trim().toLowerCase();
    const b = (h.new_gm_name || "").trim().toLowerCase();
    if (a && b && a !== b) turnoverByNum.set(String(h.store_number), (turnoverByNum.get(String(h.store_number)) || 0) + 1);
  }

  const transitions = await selectAll(supa, "changeover_checklists", "store_number, status", (q) =>
    q.in("status", ["open", "in_progress"]),
  );
  const activeByNum = new Set(transitions.map((t) => String(t.store_number)).filter(Boolean));

  // 5. Per-store assembled records (season-average percentile, keyed by number).
  const records = [];
  for (const num of storeNumbers) {
    const trait = traitByNum.get(num) || null;
    const rosterRow = rosterByNum.get(num);
    const stab = stabilityFor(
      {
        placementDate: parseLooseDate(rosterRow?.placement_date),
        turnover: turnoverByNum.get(num) || 0,
        activeTransition: activeByNum.has(num),
        rosterStatus: rosterRow?.status,
      },
      now,
    );
    records.push({
      store_number: num,
      percentile: seasonPct.get(num),
      pattern: trait ? ciPatternForTrait(trait)?.name || trait : null,
      stability_score: stab.score,
      stability_tier: stab.tier,
    });
  }

  const withTrait = records.filter((r) => r.pattern);

  // 6. Decomposition — stability vs. trait, on stores that have BOTH.
  const both = withTrait; // all have stability; percentile always present
  const stabR = pearson(both.map((r) => r.stability_score), both.map((r) => r.percentile));
  const traitGroups = groupBy(withTrait, (r) => r.pattern).map(([, vs]) => ({ values: vs.map((r) => r.percentile) }));
  const traitEta = etaSquared(traitGroups);
  const stabilityR2 = Math.round(stabR * stabR * 100);
  const traitVar = Math.round(traitEta * 100);
  let verdict;
  if (both.length < MIN_N_TRAIT) verdict = "thin";
  else if (stabilityR2 >= traitVar + 8) verdict = "stability";
  else if (traitVar >= stabilityR2 + 8) verdict = "trait";
  else verdict = "mixed";

  // 7. Leaderboard — ranked only when the sample supports it.
  const leaderboard = [];
  const thinTraits = [];
  for (const [pattern, vs] of groupBy(withTrait, (r) => r.pattern)) {
    const pcts = vs.map((r) => r.percentile);
    const entry = {
      trait: pattern,
      n: vs.length,
      mean: Math.round(mean(pcts)),
      median: Math.round(median(pcts)),
      spread: Math.round(stdev(pcts)),
      confident: vs.length >= MIN_N_TRAIT,
    };
    if (entry.confident) leaderboard.push(entry);
    else thinTraits.push({ trait: pattern, n: vs.length, mean: entry.mean });
  }
  leaderboard.sort((a, b) => b.mean - a.mean);
  thinTraits.sort((a, b) => b.n - a.n);

  // 8. Trait × stability heatmap (only traits that clear the leaderboard bar).
  const heatTraits = leaderboard.map((l) => l.trait);
  const heatmap = heatTraits.map((trait) => {
    const cells = TIERS.map((tier) => {
      const cell = withTrait.filter((r) => r.pattern === trait && r.stability_tier === tier);
      const confident = cell.length >= MIN_N_CELL;
      return {
        tier,
        n: cell.length,
        mean: confident ? Math.round(mean(cell.map((r) => r.percentile))) : null,
        confident,
      };
    });
    return { trait, cells };
  });

  // 9. Stability tier distribution.
  const tierDist = TIERS.map((tier) => {
    const inTier = records.filter((r) => r.stability_tier === tier);
    return {
      tier,
      n: inTier.length,
      mean_percentile: inTier.length ? Math.round(mean(inTier.map((r) => r.percentile))) : null,
    };
  });

  return {
    run: { weeks_analyzed: weeksAnalyzed },
    coverage: {
      ranked_stores: storeNumbers.length,
      with_trait: withTrait.length,
      trait_pct: Math.round((100 * withTrait.length) / storeNumbers.length),
      recovered_via_roster: recoveredViaRoster,
    },
    decomposition: { stability_r2: stabilityR2, trait_var: traitVar, n: both.length, verdict },
    leaderboard,
    thin_traits: thinTraits,
    heatmap,
    tier_distribution: tierDist,
    thresholds: { min_n_trait: MIN_N_TRAIT, min_n_cell: MIN_N_CELL },
  };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.entries()];
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
  if (!EXEC_ROLES.has(String(user.role).toLowerCase())) {
    return respond(403, { error: "The Executive Overview is for VP, COO, and admin." });
  }
  const action = (event.queryStringParameters || {}).action || "overview";
  try {
    const supa = admin();
    if (event.httpMethod === "GET" && action === "overview") {
      const result = await overview(supa);
      if (result?.status && result?.error) return respond(result.status, { error: result.error });
      return respond(200, result);
    }
    return respond(400, { error: `unknown action: ${action}` });
  } catch (e) {
    console.error("[trait-analytics] error:", e);
    return respond(500, { error: e.message || "server error" });
  }
};
