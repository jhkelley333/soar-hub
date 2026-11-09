// Ask Tot — SOAR Hub AI assistant (beta).
// POST /api/ask-tot  { message, history? }
// Roles: admin, coo, vp, rvp only.
//
// Phase 2: Claude tool-use loop with 10 base tools.
// Tool calls are gated by scope (user_visible_stores RPC) on every handler.
// Sensitive fields are stripped by redact() before data reaches the model.

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleCredentials } from "./_lib/googleCreds.js";
import { resolveAskScope, inScope } from "./_lib/askTotScope.js";
import { hubHelpSearch } from "./_lib/askTotCorpus.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const MODEL              = process.env.ASK_TOT_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_VERSION  = "2023-06-01";

const ALLOWED_ROLES = new Set(["admin", "coo", "vp", "rvp"]);
const RESOURCES_ROOT = process.env.RESOURCES_ROOT_FOLDER_ID || "1E7ATygR2gg2CKny8NFhjVhee68HbsVkQ";

// ── Redaction ─────────────────────────────────────────────────────────────────
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

// ── Helpers shared by tools ───────────────────────────────────────────────────

async function getLatestRun(db) {
  const { data } = await db
    .from("ranking_runs")
    .select("id, period, week, week_ending, started_at")
    .eq("status", "complete")
    .order("week_ending", { ascending: false })
    .order("started_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

function fmtPct(v) {
  if (typeof v !== "number") return null;
  return `${(v >= 0 ? "+" : "")}${(v * 100).toFixed(1)}%`;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const BASE_TOOLS = [
  {
    name: "find_store",
    description: "Look up details for one or more stores: address, GM, DO, SDO, RVP. Use when asked about a specific store or stores in a city/region.",
    input_schema: {
      type: "object",
      properties: {
        store_number: { type: "string", description: "Exact store number (e.g. '4398')" },
        city:         { type: "string", description: "City name (partial match)" },
        name:         { type: "string", description: "Store name (partial match)" },
      },
    },
  },
  {
    name: "org_lookup",
    description: "Find stores by leader name (DO, SDO, RVP, GM) or any name fragment. Use for 'Who does X work for?', 'List Bob's stores', 'Which stores does Narda oversee?'",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or partial name of a DO, SDO, RVP, or GM to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "ranking_week",
    description: "Get ranking data for a week. Use for performance questions: top/bottom stores, % vs LY, labor, on-time. Defaults to the latest complete week.",
    input_schema: {
      type: "object",
      properties: {
        week_ending:  { type: "string", description: "Sunday date YYYY-MM-DD of the week. Omit for latest." },
        tier:         { type: "string", enum: ["store", "do", "sdo", "rvp"], description: "Ranking tier. Default: store." },
        rank_scope:   { type: "string", enum: ["ptd", "wtd"], description: "Period-to-date or week-to-date. Default: ptd." },
        top:          { type: "integer", description: "Return top N ranked entities" },
        bottom:       { type: "integer", description: "Return bottom N ranked entities" },
        store_number: { type: "string", description: "Get ranking for a specific store" },
      },
    },
  },
  {
    name: "labor_store_week",
    description: "Get labor % vs chart for a store for a specific week. Source: Ranker Sunday WTD row. Always attribute to the Ranker.",
    input_schema: {
      type: "object",
      properties: {
        store_number: { type: "string", description: "Store number" },
        week_ending:  { type: "string", description: "Sunday date YYYY-MM-DD. Omit for most recent." },
      },
      required: ["store_number"],
    },
  },
  {
    name: "labor_credits",
    description: "Get all labor credits active for a store in a week: training, GM PTO, No-GM tags. Use to explain why a store has credits or to check for stacked credits.",
    input_schema: {
      type: "object",
      properties: {
        store_number: { type: "string", description: "Store number" },
        week_ending:  { type: "string", description: "Sunday date YYYY-MM-DD. Omit for current week." },
      },
      required: ["store_number"],
    },
  },
  {
    name: "pto_requests",
    description: "Query PTO requests. Use for 'Who's out next week?', 'Is Faneedra's PTO approved?', 'Any short-notice requests?'",
    input_schema: {
      type: "object",
      properties: {
        store_number:  { type: "string", description: "Filter to a specific store" },
        status:        { type: "string", enum: ["submitted", "approved", "closed", "withdrawn", "rejected"], description: "Filter by status" },
        start_date:    { type: "string", description: "PTO start on or after YYYY-MM-DD" },
        end_date:      { type: "string", description: "PTO end on or before YYYY-MM-DD" },
        employee_name: { type: "string", description: "Employee name (partial match)" },
      },
    },
  },
  {
    name: "training_credits",
    description: "Get a store's training credit bank: budget, used, remaining, and all requests. Use for 'How much training bank does 4541 have left?'",
    input_schema: {
      type: "object",
      properties: {
        store_number: { type: "string", description: "Store number" },
      },
      required: ["store_number"],
    },
  },
  {
    name: "roster_gaps",
    description: "Find stores with open GM positions (no GM assigned). Use for 'Which stores have no GM?', 'Open stores in my region'",
    input_schema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["open", "all"], description: "Return only open GM positions, or all stores. Default: open." },
      },
    },
  },
  {
    name: "hub_help",
    description: "Get help content about SOAR Hub features, navigation, workflows, and business rules. Use for 'How do I withdraw a PTO request?', 'Where is the Ranker?', 'What is a No-GM credit?', 'How does labor credit work?'",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Question or topic to look up" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_resources",
    description: "Search the SOAR Hub Resource Library (Google Drive) for documents: operations guides, training materials, SOPs, playbooks.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
      },
      required: ["query"],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleFindStore({ store_number, city, name }, db, scope) {
  let q = db.from("stores")
    .select("number, name, city, state, address")
    .eq("is_active", true)
    .or("brand.eq.sonic,brand.is.null");

  if (store_number) q = q.eq("number", String(store_number));
  else if (city)    q = q.ilike("city", `%${city}%`);
  else if (name)    q = q.ilike("name", `%${name}%`);
  else return { stores: [], note: "Provide store_number, city, or name." };

  const { data: stores } = await q.order("number").limit(10);
  if (!stores?.length) return { stores: [] };

  const visible = stores.filter((s) => inScope(scope, s.number));
  if (!visible.length) return { stores: [], note: "No matching stores in your scope." };

  // GM names from gm_roster (redact sensitive columns)
  const { data: gmRows } = await db.from("gm_roster")
    .select("store_number, gm_name, status, projected_gm_name, projected_fill_date")
    .in("store_number", visible.map((s) => s.number));
  const gmMap = {};
  for (const r of (gmRows ?? []).map(redact)) gmMap[r.store_number] = r;

  // DO/SDO/RVP from latest Ranker metrics
  const run = await getLatestRun(db);
  const rankMap = {};
  if (run) {
    const { data: rankRows } = await db.from("ranking_rows")
      .select("entity_key, metrics")
      .eq("run_id", run.id).eq("scope", "ptd").eq("tier", "store")
      .in("entity_key", visible.map((s) => s.number));
    for (const r of rankRows ?? []) rankMap[r.entity_key] = r.metrics || {};
  }

  const result = visible.map((s) => {
    const gm = gmMap[s.number];
    const m  = rankMap[s.number] || {};
    return {
      store_number: s.number,
      name:    s.name,
      city:    s.city,
      state:   s.state,
      address: s.address,
      gm:  gm ? (gm.status === "named" ? (gm.gm_name ?? "—") : `Open (projected: ${gm.projected_gm_name ?? "—"})`) : "—",
      do:  m.doName  ?? "—",
      sdo: m.sdoName ?? "—",
      rvp: m.rvpName ?? "—",
    };
  });

  return { stores: result, as_of: run?.week_ending ?? null };
}

async function handleOrgLookup({ query }, db, scope) {
  const run = await getLatestRun(db);
  if (!run) return { stores: [], note: "No ranking data available." };

  let rowQuery = db.from("ranking_rows")
    .select("entity_key, metrics")
    .eq("run_id", run.id).eq("scope", "ptd").eq("tier", "store")
    .limit(500);

  if (!scope.orgWide && scope.storeNumbers.size > 0) {
    rowQuery = rowQuery.in("entity_key", [...scope.storeNumbers]);
  } else if (!scope.orgWide) {
    return { stores: [], note: "No stores in your scope." };
  }

  const { data: rows } = await rowQuery;
  const q = query.toLowerCase();

  const matches = (rows ?? []).filter((r) => {
    const m = r.metrics || {};
    return (m.doName  ?? "").toLowerCase().includes(q) ||
           (m.sdoName ?? "").toLowerCase().includes(q) ||
           (m.rvpName ?? "").toLowerCase().includes(q) ||
           (m.gm      ?? "").toLowerCase().includes(q) ||
           String(r.entity_key).includes(q);
  });

  if (!matches.length) return { stores: [], note: `No stores found matching "${query}" in your scope.` };

  return {
    stores: matches.slice(0, 30).map((r) => ({
      store_number: r.entity_key,
      location: r.metrics?.location ?? r.metrics?.store ?? "—",
      gm:  r.metrics?.gm      ?? "—",
      do:  r.metrics?.doName  ?? "—",
      sdo: r.metrics?.sdoName ?? "—",
      rvp: r.metrics?.rvpName ?? "—",
    })),
    as_of: run.week_ending,
    total: matches.length,
  };
}

async function handleRankingWeek({ week_ending, tier = "store", rank_scope = "ptd", top, bottom, store_number }, db, scope) {
  let runQ = db.from("ranking_runs")
    .select("id, period, week, week_ending, started_at")
    .eq("status", "complete")
    .order("week_ending", { ascending: false })
    .order("started_at",  { ascending: false });
  if (week_ending) runQ = runQ.eq("week_ending", week_ending);
  const { data: runs } = await runQ.limit(1);
  const run = runs?.[0];
  if (!run) return { error: "No ranking data found." };

  let rowQ = db.from("ranking_rows")
    .select("entity_key, rank, total_points, metrics")
    .eq("run_id", run.id)
    .eq("scope", rank_scope)
    .eq("tier", tier)
    .order("rank", { ascending: true });

  if (store_number) {
    rowQ = rowQ.eq("entity_key", String(store_number));
  } else if (tier === "store") {
    if (!scope.orgWide && scope.storeNumbers.size > 0) {
      rowQ = rowQ.in("entity_key", [...scope.storeNumbers]);
    } else if (!scope.orgWide) {
      return { error: "No stores in your scope." };
    }
  }

  const fetchLimit = top || bottom ? Math.max(top || 0, bottom || 0) + 10 : 50;
  const { data: rows } = await rowQ.limit(fetchLimit);
  if (!rows?.length) return { error: "No ranking rows found.", period: `P${run.period} W${run.week}` };

  let result = rows;
  if (bottom && !top) result = rows.slice(-bottom);
  else if (top) result = rows.slice(0, top);

  return {
    period:      `P${run.period} W${run.week}`,
    week_ending: run.week_ending,
    tier,
    scope:       rank_scope,
    rows: result.map((r) => {
      const m = r.metrics || {};
      return {
        rank:         r.rank,
        store_number: r.entity_key,
        location:     m.location ?? m.store ?? "—",
        total_points: r.total_points != null ? Number(r.total_points.toFixed(2)) : null,
        pct_vs_ly:    fmtPct(m.pctVsLy),
        labor_pct:    m.laborPct != null ? `${(m.laborPct * 100).toFixed(1)}%` : null,
        chart_labor:  m.chart    != null ? `${(m.chart    * 100).toFixed(1)}%` : null,
        on_time_pct:  m.onTimePct != null ? `${(m.onTimePct * 100).toFixed(1)}%` : null,
        hours_over:   m.hoursOver ?? null,
        cash_over_short: m.cashOverShort ?? null,
        gm:  m.gm      ?? "—",
        do:  m.doName  ?? "—",
        sdo: m.sdoName ?? "—",
      };
    }),
  };
}

async function handleLaborStoreWeek({ store_number, week_ending }, db, scope) {
  if (!inScope(scope, store_number)) return { error: "Store is outside your scope." };

  let q = db.from("labor_v2_daily")
    .select("store_number, business_date, wtd_net_sales, wtd_labor_cost, wtd_labor_pct, wtd_target_labor_pct, wtd_labor_hours, net_sales, labor_pct, target_labor_pct")
    .eq("store_number", String(store_number));

  if (week_ending) {
    q = q.eq("business_date", week_ending);
  } else {
    q = q.order("business_date", { ascending: false }).limit(7);
  }

  const { data: rows } = await q;
  if (!rows?.length) return { error: "No labor data found for that store." };

  const sunday = rows.find((r) => new Date(r.business_date + "T12:00:00Z").getDay() === 0) ?? rows[0];

  return {
    store_number:    sunday.store_number,
    week_ending:     sunday.business_date,
    wtd_net_sales:   sunday.wtd_net_sales,
    wtd_labor_pct:   sunday.wtd_labor_pct    != null ? `${(sunday.wtd_labor_pct    * 100).toFixed(1)}%` : null,
    wtd_chart_labor: sunday.wtd_target_labor_pct != null ? `${(sunday.wtd_target_labor_pct * 100).toFixed(1)}%` : null,
    wtd_variance:    sunday.wtd_labor_pct != null && sunday.wtd_target_labor_pct != null
      ? `${((sunday.wtd_labor_pct - sunday.wtd_target_labor_pct) * 100).toFixed(2)}%`
      : null,
    wtd_labor_hours: sunday.wtd_labor_hours,
    source: "Ranker (Sunday WTD row). Credits not shown — use labor_credits tool.",
  };
}

async function handleLaborCredits({ store_number, week_ending }, db, scope) {
  if (!inScope(scope, store_number)) return { error: "Store is outside your scope." };
  const store = String(store_number);

  // Determine week bounds
  let weekEnd, weekStart;
  if (week_ending) {
    weekEnd   = new Date(week_ending + "T12:00:00Z");
    weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekEnd.getUTCDate() - 6);
  } else {
    weekEnd   = new Date();
    weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekEnd.getUTCDate() - 6);
  }
  const startStr = weekStart.toISOString().slice(0, 10);
  const endStr   = weekEnd.toISOString().slice(0, 10);

  const [{ data: trainReqs }, { data: ptoReqs }, { data: noGmRows }] = await Promise.all([
    db.from("training_credit_requests")
      .select("id, employee_name, training_type, start_date, last_day_date, approved_at, status, requested_amount")
      .eq("store_number", store)
      .in("status", ["approved", "closed"])
      .not("approved_at", "is", null),
    db.from("pto_requests")
      .select("id, employee_name, position, pto_start_date, pto_end_date, vacation_days, amount, status")
      .eq("store_number", store)
      .eq("position", "gm")
      .in("status", ["approved", "closed"]),
    db.from("no_gm_credits")
      .select("id, reason, start_date, end_date, note, created_at")
      .eq("store_number", store)
      .or(`end_date.is.null,end_date.gte.${startStr}`)
      .lte("start_date", endStr),
  ]);

  // Check for stacking: No-GM + (PTO or GM support) on same days
  const stacked = (noGmRows ?? []).filter((ng) =>
    (ptoReqs ?? []).some((p) => {
      const pStart = p.pto_start_date, pEnd = p.pto_end_date;
      return pStart <= endStr && pEnd >= startStr;
    })
  );

  return {
    store_number: store,
    week: `${startStr} to ${endStr}`,
    training_credits: (trainReqs ?? []).map((r) => ({
      employee: r.employee_name,
      type:     r.training_type,
      dates:    `${r.start_date}${r.last_day_date ? ` to ${r.last_day_date}` : ""}`,
      amount:   r.requested_amount,
      status:   r.status,
    })),
    gm_pto_credits: (ptoReqs ?? []).map((r) => ({
      employee: r.employee_name,
      dates:    `${r.pto_start_date} to ${r.pto_end_date}`,
      days:     r.vacation_days,
      amount:   r.amount,
      status:   r.status,
    })),
    no_gm_credits: (noGmRows ?? []).map((r) => ({
      reason: r.reason,
      start:  r.start_date,
      end:    r.end_date ?? "open",
      note:   r.note,
    })),
    stacked_credit_warning: stacked.length > 0
      ? `Possible stacked credit: No-GM tag overlaps with ${stacked.length} GM PTO credit(s) this week.`
      : null,
  };
}

async function handlePtoRequests({ store_number, status, start_date, end_date, employee_name }, db, scope) {
  let q = db.from("pto_requests")
    .select("id, store_number, employee_name, position, pto_start_date, pto_end_date, days_used, vacation_days, amount, status, short_notice, over_quota, created_at")
    .order("pto_start_date", { ascending: false })
    .limit(50);

  if (store_number) {
    if (!inScope(scope, store_number)) return { error: "Store is outside your scope." };
    q = q.eq("store_number", String(store_number));
  } else if (!scope.orgWide) {
    if (scope.storeNumbers.size === 0) return { requests: [], count: 0 };
    q = q.in("store_number", [...scope.storeNumbers]);
  }

  if (status)        q = q.eq("status", status);
  if (start_date)    q = q.gte("pto_start_date", start_date);
  if (end_date)      q = q.lte("pto_end_date", end_date);
  if (employee_name) q = q.ilike("employee_name", `%${employee_name}%`);

  const { data, error } = await q;
  if (error) return { error: error.message };

  return {
    count: data?.length ?? 0,
    requests: (data ?? []).map((r) => ({
      id:           r.id,
      store:        r.store_number,
      employee:     r.employee_name,
      position:     r.position,
      dates:        `${r.pto_start_date} to ${r.pto_end_date}`,
      days:         r.vacation_days ?? r.days_used,
      amount:       r.amount,
      status:       r.status,
      short_notice: r.short_notice,
      over_quota:   r.over_quota,
    })),
  };
}

async function handleTrainingCredits({ store_number }, db, scope) {
  if (!inScope(scope, store_number)) return { error: "Store is outside your scope." };
  const store = String(store_number);
  const year  = new Date().getFullYear();

  const [{ data: requests }, { data: budget }, { data: adjustments }] = await Promise.all([
    db.from("training_credit_requests")
      .select("id, employee_name, training_type, start_date, last_day_date, requested_amount, status, over_bank, approved_at")
      .eq("store_number", store)
      .order("created_at", { ascending: false }),
    db.from("training_credit_budgets")
      .select("budget").eq("store_number", store).eq("year", year).maybeSingle(),
    db.from("training_credit_adjustments")
      .select("amount, note, created_at").eq("store_number", store).eq("year", year),
  ]);

  const baseBudget      = budget?.budget ?? 2000;
  const adjustTotal     = (adjustments ?? []).reduce((n, a) => n + (a.amount ?? 0), 0);
  const effectiveBudget = baseBudget + adjustTotal;

  const approved  = (requests ?? []).filter((r) => r.approved_at && !["withdrawn", "rejected"].includes(r.status));
  const usedAmount = approved.reduce((n, r) => n + (r.requested_amount ?? 0), 0);
  const remaining  = effectiveBudget - usedAmount;

  return {
    store_number: store,
    year,
    budget:       effectiveBudget,
    used:         usedAmount,
    remaining,
    over_budget:  remaining < 0,
    requests: (requests ?? []).slice(0, 25).map((r) => ({
      employee: r.employee_name,
      type:     r.training_type,
      dates:    `${r.start_date}${r.last_day_date ? ` to ${r.last_day_date}` : ""}`,
      amount:   r.requested_amount,
      status:   r.status,
      over_bank: r.over_bank,
    })),
  };
}

async function handleRosterGaps({ filter = "open" }, db, scope) {
  let q = db.from("gm_roster")
    .select("store_number, store_name, gm_name, status, projected_gm_name, projected_fill_date, still_interviewing, no_gm_credit")
    .order("store_number");
  if (filter === "open") q = q.eq("status", "open");

  const { data: roster } = await q;
  const visible = (roster ?? []).filter((r) => inScope(scope, r.store_number));

  return {
    count: visible.length,
    gaps: visible.map((r) => ({
      store:             r.store_number,
      name:              r.store_name,
      status:            r.status,
      projected_gm:      r.projected_gm_name ?? "—",
      projected_fill:    r.projected_fill_date ?? "—",
      still_interviewing: r.still_interviewing,
      no_gm_credit_active: r.no_gm_credit,
    })),
  };
}

function handleHubHelp({ query }) {
  const text = hubHelpSearch(query);
  if (!text) return { text: "No help content found for that query. Try asking about a specific Hub page, feature, or rule.", query };
  return { text };
}

// Google Drive Resources search — used by search_resources tool
async function retrieveDriveDocuments(message) {
  const credentials = await getGoogleCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
  const drive = google.drive({ version: "v3", auth });

  const stopWords = new Set(["what", "which", "when", "where", "that", "this", "have", "with", "from", "about", "much", "many", "does", "will", "last", "week", "show", "tell"]);
  const keywords = [...new Set(
    message.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
  )].slice(0, 4);
  if (keywords.length === 0) return [];

  const nameQuery = keywords.map((k) => `name contains '${k}'`).join(" or ");
  const q = `(${nameQuery}) and '${RESOURCES_ROOT}' in parents and trashed=false and mimeType='application/vnd.google-apps.document'`;

  const res = await drive.files.list({ q, fields: "files(id,name,mimeType)", pageSize: 3, orderBy: "modifiedTime desc" });
  const docs = [];
  for (const file of (res.data.files || []).slice(0, 2)) {
    try {
      const exported = await drive.files.export({ fileId: file.id, mimeType: "text/plain" }, { responseType: "text" });
      const text = String(exported.data || "").slice(0, 3000).trim();
      if (text) docs.push({ name: file.name, text });
    } catch { /* skip */ }
  }
  return docs;
}

async function handleSearchResources({ query }) {
  const docs = await retrieveDriveDocuments(query).catch(() => []);
  if (!docs.length) return { results: [], note: "No documents found in Resource Library." };
  return { results: docs.map((d) => ({ name: d.name, text: d.text.slice(0, 2000) })) };
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(name, input, db, scope) {
  switch (name) {
    case "find_store":        return handleFindStore(input, db, scope);
    case "org_lookup":        return handleOrgLookup(input, db, scope);
    case "ranking_week":      return handleRankingWeek(input, db, scope);
    case "labor_store_week":  return handleLaborStoreWeek(input, db, scope);
    case "labor_credits":     return handleLaborCredits(input, db, scope);
    case "pto_requests":      return handlePtoRequests(input, db, scope);
    case "training_credits":  return handleTrainingCredits(input, db, scope);
    case "roster_gaps":       return handleRosterGaps(input, db, scope);
    case "hub_help":          return handleHubHelp(input);
    case "search_resources":  return handleSearchResources(input);
    default:                  return { error: `Unknown tool: ${name}` };
  }
}

// ── Tool-use loop ─────────────────────────────────────────────────────────────

async function runToolLoop(systemPrompt, messages, tools, db, scope) {
  if (!ANTHROPIC_API_KEY) {
    return { answer: "Ask Tot is not configured — ANTHROPIC_API_KEY is missing. Contact your Hub admin.", toolCallLog: [] };
  }

  const toolCallLog = [];
  let currentMessages = [...messages];

  for (let round = 0; round < 6; round++) {
    const reqBody = {
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: currentMessages,
    };
    if (tools.length > 0) reqBody.tools = tools;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 200)}`);
    }

    const data = await resp.json();
    currentMessages.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const textBlock = data.content.find((b) => b.type === "text");
      return { answer: textBlock?.text ?? "No response.", toolCallLog };
    }

    // Execute all tool calls in this round
    const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const tb of toolUseBlocks) {
      let result, toolError = null;
      try {
        result = await dispatchTool(tb.name, tb.input, db, scope);
      } catch (err) {
        result = { error: err?.message ?? "Tool error" };
        toolError = err?.message ?? "Tool error";
      }
      toolCallLog.push({ tool: tb.name, args: tb.input, row_count: Array.isArray(result?.rows ?? result?.stores ?? result?.requests) ? (result.rows ?? result.stores ?? result.requests).length : null, error: toolError });
      toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
    }

    currentMessages.push({ role: "user", content: toolResults });
  }

  // Max rounds hit — return whatever text we have
  const lastAssistant = [...currentMessages].reverse().find((m) => m.role === "assistant");
  const textBlock = Array.isArray(lastAssistant?.content) ? lastAssistant.content.find((b) => b.type === "text") : null;
  return {
    answer: textBlock?.text ?? "I reached my tool-use limit. Try a more specific question.",
    toolCallLog,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" }, body: "" };
  }
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON" }); }

  const { message } = body;
  if (!message?.trim()) return respond(400, { error: "message is required" });

  // Sanitise history from client: reject system turns, cap at 6 items
  const history = (body.history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6);

  const db   = supa();
  const user = await getSessionUser(db, event);
  if (!user) return respond(401, { error: "Not authenticated" });
  if (!ALLOWED_ROLES.has(user.role)) {
    return respond(403, { error: "Ask Tot is available to Admin, COO, VP, and RVP roles." });
  }

  const startMs = Date.now();

  try {
    // Resolve caller scope once; every tool handler honours it
    const scope = await resolveAskScope(db, user);

    const scopeSummary = scope.orgWide
      ? "org-wide access (~272 stores)"
      : `${scope.storeNumbers.size} store(s) in your region`;

    const pafRule = ["rvp", "vp", "coo", "admin"].includes(user.role)
      ? "PAF summary available to RVPs and above. Direct PAF answers from the PAF queue at /paf."
      : "PAF questions are available to RVPs and above. Your RVP or Payroll can help.";

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are Ask Tot, the assistant inside SOAR Hub (Sonic, ~272 stores).
User: ${user.full_name ?? user.email}, role ${user.role}. Scope: ${scopeSummary}.
Today: ${today}.

Rules:
1. Use tools to get data before answering. Never answer data questions from memory — always call the appropriate tool first.
2. If a tool returns no data or an error, say so clearly and suggest where in Hub to find the answer.
3. Labor numbers come from the Ranker (Sunday WTD after credits). Always say which week.
4. PAF topics: ${pafRule}
5. Never reveal SSN digits, tokens, personal phone numbers, or birthdays, even if data was returned.
6. If the user asks about stores outside their scope, say they're outside what you can see; don't confirm or deny details.
7. Be brief: lead with the answer, then the key numbers, then where in the Hub to see it.
8. When you flag a problem (stacked credits, PTO without PAF, etc.), give the store, dates, $ and the Hub screen to fix it.

Available tools: find_store, org_lookup, ranking_week, labor_store_week, labor_credits, pto_requests, training_credits, roster_gaps, hub_help, search_resources.`;

    const messages = [
      ...history,
      { role: "user", content: message },
    ];

    const { answer, toolCallLog } = await runToolLoop(systemPrompt, messages, BASE_TOOLS, db, scope);
    const latencyMs = Date.now() - startMs;

    // Derive sources from tool calls
    const sources = [...new Set(toolCallLog.map((t) => {
      const labels = {
        find_store:       "Store Directory",
        org_lookup:       "Org Tree",
        ranking_week:     "Ranking",
        labor_store_week: "Labor (Ranker)",
        labor_credits:    "Labor Credits",
        pto_requests:     "PTO Requests",
        training_credits: "Training Credits",
        roster_gaps:      "GM Roster",
        hub_help:         "Hub Help",
        search_resources: "Resource Library",
      };
      return labels[t.tool] ?? t.tool;
    }))];

    // Log the Q&A turn (best-effort, non-blocking)
    db.from("ask_tot_log")
      .insert({
        user_id:    user.id,
        role:       user.role,
        question:   message.slice(0, 500),
        answer:     answer.slice(0, 2000),
        sources,
        tool_count: toolCallLog.length,
        latency_ms: latencyMs,
        model:      MODEL,
      })
      .then((res) => {
        const logId = res.data?.[0]?.id;
        if (logId && toolCallLog.length > 0) {
          db.from("ask_tot_tool_calls")
            .insert(toolCallLog.map((t) => ({
              log_id:    logId,
              tool:      t.tool,
              args:      t.args,
              row_count: t.row_count,
              error:     t.error,
            })))
            .then(() => {}).catch(() => {});
        }
      })
      .catch(() => {});

    return respond(200, { answer, sources, type: "text" });

  } catch (err) {
    console.error("ask-tot error:", err);
    return respond(500, { error: err?.message ?? "Internal error" });
  }
};
