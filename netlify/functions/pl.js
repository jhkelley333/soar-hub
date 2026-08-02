// netlify/functions/pl.js
//
// Store P&L statements (migration 0209). Actions:
//   GET  ?action=periods                      -> distinct uploaded periods
//   GET  ?action=overview&period=YYYY-MM-DD   -> caller's visible stores with
//                                                headline metrics for a period
//   GET  ?action=statement&store=N&period=…   -> one store's full statement
//   POST ?action=upload                       -> admin-only batch upsert from
//                                                the client-parsed workbook
//
// Visibility mirrors the rest of the app: org-wide roles see everything,
// everyone else flows through user_visible_stores(). Service-role
// gatekeeper — RLS is on with no policies; this function scope-checks.

import { createClient } from "@supabase/supabase-js";
import { fiscalForDate } from "./_lib/fiscal.js";
import { resolveOrg } from "./_lib/kpiOrg.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const ORG_WIDE = new Set(["admin", "vp", "coo", "payroll", "accounting"]);
const READ_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin", "payroll", "accounting", "fbc"]);
const UPLOAD_ROLES = new Set(["admin"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("pl env vars not configured");
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
    .select("id, email, full_name, preferred_name, role, primary_store_id, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// Visible store rows (id + number + name) for the caller — org-wide roles
// get every active store; everyone else via the user_visible_stores RPC.
async function callerVisibleStores(supa, user) {
  if (ORG_WIDE.has(user.role) || user.role === "fbc") {
    const { data } = await supa
      .from("stores")
      .select("id, number, name")
      .eq("is_active", true);
    return data ?? [];
  }
  const { data: visible } = await supa.rpc("user_visible_stores", { uid: user.id });
  const ids = (visible ?? [])
    .map((v) => (typeof v === "string" ? v : v?.user_visible_stores ?? null))
    .filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supa
    .from("stores")
    .select("id, number, name")
    .in("id", ids)
    .eq("is_active", true);
  return data ?? [];
}

async function listPeriods(supa) {
  // Page through every row: PostgREST caps a single response at 1000, and each
  // period is ~272 store rows, so past ~3-4 periods the oldest ones (e.g. Jan)
  // fell off the end and never showed in the dropdown.
  const PAGE = 1000;
  const byEnd = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("pl_statements")
      .select("period_end, period_label, is_final")
      .order("period_end", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message, status: 500 };
    for (const r of data ?? []) {
      const cur = byEnd.get(r.period_end) || {
        period_end: r.period_end,
        period_label: r.period_label,
        has_prelim: false,
        has_final: false,
      };
      if (r.period_label && !cur.period_label) cur.period_label = r.period_label;
      if (r.is_final) cur.has_final = true; else cur.has_prelim = true;
      byEnd.set(r.period_end, cur);
    }
    if (!data || data.length < PAGE) break;
  }
  // is_final kept for back-compat (badge shows "Final" once a Final exists).
  const periods = Array.from(byEnd.values()).map((p) => ({ ...p, is_final: p.has_final }));
  return { periods };
}

async function overview(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const period = String(params.period || "").trim();
  if (!period) return { error: "period is required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  if (!stores.length) return { period, rows: [] };
  const numbers = stores.map((s) => String(s.number));
  const nameByNumber = new Map(stores.map((s) => [String(s.number), s.name]));

  const { data, error } = await supa
    .from("pl_statements")
    .select("store_number, period_label, is_final, total_sales, gross_profit, ci_amount, ci_pct, ebitda")
    .eq("period_end", period)
    .in("store_number", numbers)
    .order("store_number");
  if (error) return { error: error.message, status: 500 };

  // A store may now have both a Prelim and a Final row. Show the Final when it
  // exists (else Prelim), and flag whether both are present so the UI can offer
  // the side-by-side comparison.
  const byStore = new Map();
  for (const r of data ?? []) {
    const key = String(r.store_number);
    const cur = byStore.get(key) || { prelim: null, final: null };
    if (r.is_final) cur.final = r; else cur.prelim = r;
    byStore.set(key, cur);
  }

  // Flag-notes saved for THIS period (system of record), counted per store — so
  // the Notes column reflects the selected period, not the current flags sheet.
  const noteCount = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: nrows, error: nErr } = await supa
      .from("pl_flag_notes")
      .select("store_number")
      .eq("period_end", period)
      .in("store_number", numbers)
      .range(from, from + PAGE - 1);
    if (nErr) break; // notes are a nicety here — don't fail the overview
    for (const n of nrows ?? []) {
      const k = String(n.store_number);
      noteCount.set(k, (noteCount.get(k) || 0) + 1);
    }
    if (!nrows || nrows.length < PAGE) break;
  }

  const rows = [];
  for (const [num, { prelim, final }] of byStore) {
    const chosen = final || prelim;
    if (!chosen) continue;
    rows.push({
      ...chosen,
      store_name: nameByNumber.get(num) ?? null,
      stage: chosen.is_final ? "final" : "prelim",
      compare_available: !!(prelim && final),
      note_count: noteCount.get(num) ?? 0,
    });
  }
  rows.sort((a, b) => String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }));
  return { period, rows };
}

async function statement(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data, error } = await supa
    .from("pl_statements")
    .select("*")
    .eq("store_number", storeNumber)
    .eq("period_end", period);
  if (error) return { error: error.message, status: 500 };
  const prelim = (data ?? []).find((r) => !r.is_final) || null;
  const final = (data ?? []).find((r) => r.is_final) || null;
  if (!prelim && !final) return { error: "No P&L uploaded for this store and period.", status: 404 };

  // Default to Final; ?stage=prelim forces the Prelim view.
  const wantPrelim = String(params.stage || "").toLowerCase() === "prelim";
  const chosen = (wantPrelim ? prelim : final) || final || prelim;
  return {
    statement: { ...chosen, store_name: store.name, stage: chosen.is_final ? "final" : "prelim" },
    available: { prelim: !!prelim, final: !!final },
  };
}

// One line item's value across every uploaded period for a store — powers the
// click-through trend on a flagged / statement line. Matches the line by label
// (normalized: exact first, then contains either way), Final preferred over
// Prelim per period. Returns points oldest -> newest.
async function lineTrend(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const rawLabel = String(params.label || "").trim();
  if (!storeNumber || !rawLabel) return { error: "store and label are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const want = norm(rawLabel);

  const PAGE = 1000;
  const rowsAll = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("pl_statements")
      .select("period_end, period_label, is_final, lines")
      .eq("store_number", storeNumber)
      .order("period_end", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message, status: 500 };
    rowsAll.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  // Collapse to one statement per period (Final wins over Prelim).
  const byEnd = new Map();
  for (const r of rowsAll) {
    const cur = byEnd.get(r.period_end);
    if (!cur || (r.is_final && !cur.is_final)) byEnd.set(r.period_end, r);
  }
  const ordered = [...byEnd.values()].sort((a, b) => String(a.period_end).localeCompare(String(b.period_end)));

  const points = [];
  let matchedLabel = null;
  for (const r of ordered) {
    const lines = Array.isArray(r.lines) ? r.lines : [];
    let line = lines.find((l) => norm(l.label) === want);
    if (!line) line = lines.find((l) => norm(l.label).includes(want) || (want && want.includes(norm(l.label))));
    if (!line) continue;
    matchedLabel = line.label;
    points.push({ period_end: r.period_end, period_label: r.period_label, amount: line.amount ?? null, pct: line.pct ?? null });
  }
  return { store: storeNumber, label: matchedLabel || rawLabel, points };
}

// Side-by-side Prelim vs Final for one store/period: both statements plus a
// line-by-line delta and headline movers, for the "what changed" report.
async function compare(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };

  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data, error } = await supa
    .from("pl_statements")
    .select("*")
    .eq("store_number", storeNumber)
    .eq("period_end", period);
  if (error) return { error: error.message, status: 500 };
  const prelim = (data ?? []).find((r) => !r.is_final) || null;
  const final = (data ?? []).find((r) => r.is_final) || null;
  if (!prelim || !final) {
    return { error: "Both a Preliminary and a Final P&L are required to compare.", status: 409 };
  }

  const delta = (a, b) => (a == null || b == null ? null : round2(b - a));
  const headlineKeys = ["total_sales", "gross_profit", "ci_amount", "ci_pct", "ebitda"];
  const headline = {};
  for (const k of headlineKeys) {
    headline[k] = { prelim: prelim[k] ?? null, final: final[k] ?? null, delta: delta(prelim[k], final[k]) };
  }

  // Line-by-line: match Prelim and Final rows by label (statements come from the
  // same workbook layout, so labels align). Preserve Final's order, then append
  // any Prelim-only lines that dropped out.
  const prelimByLabel = new Map((prelim.lines || []).map((l) => [l.label, l]));
  const finalLabels = new Set((final.lines || []).map((l) => l.label));
  const lines = [];
  for (const fl of final.lines || []) {
    const pl = prelimByLabel.get(fl.label) || null;
    const d = delta(pl?.amount, fl.amount);
    lines.push({
      label: fl.label,
      total: !!fl.total,
      prelim_amount: pl?.amount ?? null,
      final_amount: fl.amount ?? null,
      delta: d,
      prelim_pct: pl?.pct ?? null,
      final_pct: fl.pct ?? null,
      changed: d != null && Math.abs(d) >= 0.005,
    });
  }
  for (const pl of prelim.lines || []) {
    if (finalLabels.has(pl.label)) continue;
    lines.push({
      label: pl.label,
      total: !!pl.total,
      prelim_amount: pl.amount ?? null,
      final_amount: null,
      delta: delta(pl.amount, 0),
      prelim_pct: pl.pct ?? null,
      final_pct: null,
      changed: true,
    });
  }

  return {
    store_number: storeNumber,
    store_name: store.name,
    period_end: period,
    period_label: final.period_label || prelim.period_label || null,
    headline,
    lines,
    changed_count: lines.filter((l) => l.changed).length,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Batch upsert from the client-parsed workbook. Re-uploading the same
// period overwrites (Prelim -> Final), keyed on (store_number, period_end).
async function upload(supa, user, body) {
  if (!UPLOAD_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const periodEnd = String(body?.period_end || "").trim();
  const periodLabel = String(body?.period_label || "").trim() || null;
  const isFinal = !!body?.is_final;
  const statements = Array.isArray(body?.statements) ? body.statements : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return { error: "period_end (YYYY-MM-DD) required", status: 400 };
  if (!statements.length) return { error: "no statements to upload", status: 400 };
  if (statements.length > 600) return { error: "too many statements in one upload", status: 400 };

  const numbers = statements.map((s) => String(s.store_number || "").trim()).filter(Boolean);
  const { data: storeRows } = await supa.from("stores").select("id, number").in("number", numbers);
  const idByNumber = new Map((storeRows ?? []).map((s) => [String(s.number), s.id]));

  const now = new Date().toISOString();
  const name = user.preferred_name || user.full_name || user.email;
  const ready = [];
  const unmatched = [];
  for (const s of statements) {
    const num = String(s.store_number || "").trim();
    if (!num || !Array.isArray(s.lines) || !s.lines.length) continue;
    const storeId = idByNumber.get(num) ?? null;
    if (!storeId) unmatched.push(num);
    ready.push({
      store_number: num,
      store_id: storeId,
      period_end: periodEnd,
      period_label: periodLabel,
      is_final: isFinal,
      lines: s.lines.slice(0, 200),
      total_sales: numOrNull(s.total_sales),
      gross_profit: numOrNull(s.gross_profit),
      ci_amount: numOrNull(s.ci_amount),
      ci_pct: numOrNull(s.ci_pct),
      ebitda: numOrNull(s.ebitda),
      uploaded_by: user.id,
      uploaded_by_name: name,
      updated_at: now,
    });
  }
  if (!ready.length) return { error: "nothing parseable in the upload", status: 400 };

  // Some workbooks list a store in two columns (a store rolled up under two
  // groups). Those become two rows with the SAME (store_number, period_end,
  // is_final) — and a single upsert can't touch one conflict key twice
  // ("ON CONFLICT ... cannot affect row a second time"). Collapse to the last
  // occurrence per store and report which were duplicated.
  const byKey = new Map();
  const dupSet = new Set();
  for (const r of ready) {
    if (byKey.has(r.store_number)) dupSet.add(r.store_number);
    byKey.set(r.store_number, r);
  }
  const deduped = [...byKey.values()];
  const duplicates = [...dupSet];

  // Keyed on the stage too (is_final), so a Final upload no longer clobbers the
  // Prelim — both are retained for side-by-side comparison. Re-uploading the
  // same stage overwrites just that stage.
  const { error } = await supa
    .from("pl_statements")
    .upsert(deduped, { onConflict: "store_number,period_end,is_final" });
  if (error) return { error: error.message, status: 500 };

  return { ok: true, upserted: deduped.length, unmatched, duplicates };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Budget & Targets (store-controllable % of sales) ────────────────
async function getBudget(supa, user) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const { data, error } = await supa
    .from("pl_budget_targets")
    .select("line_key, label, group_key, is_group, target_pct, verify_on_zero, enabled, sort_order, updated_at")
    .order("sort_order");
  if (error) {
    if (/pl_budget_targets/.test(error.message)) {
      return { error: "Run migration 0265 first (pl_budget_targets is missing).", status: 500 };
    }
    if (/enabled/.test(error.message)) {
      return { error: "Run migration 0267 first (adds the enabled column).", status: 500 };
    }
    return { error: error.message, status: 500 };
  }
  return {
    targets: (data || []).map((t) => ({ ...t, enabled: t.enabled !== false, target_pct: t.target_pct == null ? null : Number(t.target_pct) })),
  };
}

const BUDGET_EDIT_ROLES = new Set(["admin", "coo", "vp"]);
const NOTE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
// DO sign-off: the store's DO or anyone above may attest the notes are reviewed.
const SIGN_ROLES = new Set(["do", "sdo", "rvp", "vp", "coo", "admin"]);

async function setBudget(supa, user, body) {
  if (!BUDGET_EDIT_ROLES.has(user.role)) return { error: "Only Admin / COO / VP can edit P&L budget targets.", status: 403 };
  const updates = Array.isArray(body?.updates) ? body.updates : body?.line_key ? [body] : [];
  if (!updates.length) return { error: "Nothing to update.", status: 400 };
  for (const u of updates) {
    const key = String(u?.line_key || "").trim();
    if (!key) continue;
    const raw = u.target_pct;
    const pct = raw === null || raw === "" || raw === undefined ? null : Number(raw);
    if (pct !== null && (!isFinite(pct) || pct < 0 || pct > 100)) {
      return { error: `Target for ${key} must be a percent between 0 and 100 (or blank).`, status: 400 };
    }
    const patch = { target_pct: pct, updated_by: user.id, updated_at: new Date().toISOString() };
    if (typeof u.verify_on_zero === "boolean") patch.verify_on_zero = u.verify_on_zero;
    if (typeof u.enabled === "boolean") patch.enabled = u.enabled;
    const { error } = await supa.from("pl_budget_targets").update(patch).eq("line_key", key);
    if (error) return { error: error.message, status: 500 };
  }
  return await getBudget(supa, user);
}

// ── P&L preliminary review: flag engine + per-flag notes ────────────
// Statement label -> budget line_key, by keyword (priority order within a key).
const LINE_KEYWORDS = {
  food_cost: ["total cost of goods", "cost of goods sold", "cost of goods", "cogs", "food cost"],
  paper_cost: ["paper cost", "paper"],
  salaried_managers: ["salaried", "management labor", "manager labor", "mgmt labor", "salary"],
  hourly_wages: ["hourly", "crew labor", "team labor"],
  overtime: ["overtime"],
  rm: ["repair", "r&m", "r & m", "maintenance"],
  smallwares: ["smallware"],
  uniforms: ["uniform"],
  cleaning_solutions: ["cleaning"],
  trash_removal: ["trash", "waste removal"],
  landscaping_snow: ["landscap", "snow"],
  supplies_other: ["supplies"],
  grease_trap: ["grease"],
  professional_services: ["professional"],
  travel_expense: ["travel"],
  pest_control: ["pest"],
  cost_of_sales: ["total cost of sales", "cost of sales"],
  total_labor: ["total labor", "total payroll"],
  total_controllable: ["total controllable"],
};
const MAJORS = new Set(["food_cost", "paper_cost", "salaried_managers", "hourly_wages", "total_labor", "cost_of_sales"]);
// Terms that must NOT appear in a matched line for a given key — keeps a cost
// line from grabbing a revenue line (e.g. "Food Sales" is not Food Cost).
const LINE_EXCLUDE = {
  food_cost: ["sales", "revenue"],
  paper_cost: ["sales", "revenue"],
};
const normLabel = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function matchLine(lines, key) {
  const exclude = LINE_EXCLUDE[key] || [];
  for (const kw of LINE_KEYWORDS[key] || []) {
    const hit = (lines || []).find((l) => {
      const label = normLabel(l.label);
      return label.includes(kw) && !exclude.some((x) => label.includes(x));
    });
    if (hit) return hit;
  }
  return null;
}
function linePct(line, sales) {
  if (!line) return null;
  if (typeof line.pct === "number" && isFinite(line.pct)) return line.pct;
  if (typeof line.amount === "number" && sales) return (line.amount / sales) * 100;
  return null;
}

// Flags for one statement's lines vs the budget + the store's trailing history.
function computeFlags(lines, sales, targets, history) {
  const flags = [];
  const priorSeries = (key) => history.map((h) => h.pctByKey[key]).filter((v) => typeof v === "number");
  const priorAmt = (key) => history.map((h) => h.amtByKey[key]).filter((v) => typeof v === "number");
  const stmtLabelByKey = {};

  for (const t of targets) {
    if (t.is_group || t.enabled === false) continue; // disabled lines aren't flagged
    const line = matchLine(lines, t.line_key);
    if (line) stmtLabelByKey[t.line_key] = line.label;
    const actualAmt = line && typeof line.amount === "number" ? line.amount : null;
    const actualPct = linePct(line, sales);

    // ONE flag per line, priority-ordered — a line is never called out twice.
    const isZero = actualAmt == null || Math.abs(actualAmt) < 1;

    // 1. Verify-on-zero (Pest Control): nothing posted -> confirm a visit.
    if (t.verify_on_zero && isZero) {
      flags.push({ line_key: t.line_key, label: t.label, type: "verify_zero", severity: "med",
        actual_pct: actualPct, actual_amount: actualAmt, target_pct: t.target_pct, variance_pts: null, dollars_over: null, context: [],
        message: `No ${t.label} expense posted this period — verify a visit actually occurred.` });
      continue;
    }

    // 2. Missing invoice — $0 now but usually nonzero. A $0 line is never "over
    // budget" and a drop to $0 is not an anomaly to chase, so stop here.
    if (isZero) {
      const amts = priorAmt(t.line_key);
      const meanAmt = amts.length ? amts.reduce((a, b) => a + b, 0) / amts.length : 0;
      if (amts.length >= 2 && meanAmt > 50) {
        flags.push({ line_key: t.line_key, label: t.label, type: "missing", severity: "low",
          actual_pct: actualPct, actual_amount: actualAmt, target_pct: t.target_pct, variance_pts: null, dollars_over: null, context: [],
          message: `${t.label} is $0 this period but usually ~$${Math.round(meanAmt).toLocaleString()} — missing invoice? Verify.` });
      }
      continue;
    }
    if (actualPct == null) continue;

    // Trailing-history stats — a SPIKE only (a cost dropping is good news, and
    // a $0 drop is already the "missing" case above).
    const series = priorSeries(t.line_key);
    let mean = null, spike = false;
    if (series.length >= 3) {
      mean = series.reduce((a, b) => a + b, 0) / series.length;
      const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
      spike = sd > 0.03 && actualPct > mean + 2 * sd;
    }

    // 3. Over budget — the primary flag. If it's ALSO spiking / chronic, that
    // rides along as context rather than a second flag.
    if (t.target_pct != null) {
      const variance = actualPct - t.target_pct;
      const threshold = t.line_key === "overtime" ? 0.001 : MAJORS.has(t.line_key) ? 0.3 : Math.max(0.05, t.target_pct * 0.15);
      if (variance >= threshold) {
        // Run-rate: over budget but FLAT across the last 3 periods (current + 2
        // prior all over target, within ~5% of each other). That's the market
        // price we pay (Landscaping, Trash, …), not a store-execution miss — so
        // suggest re-baselining the target instead of demanding an action plan.
        const recent = [actualPct, ...series].slice(0, 3);
        if (recent.length >= 3 && recent.every((p) => p > t.target_pct)) {
          const rMean = recent.reduce((a, b) => a + b, 0) / recent.length;
          const rSd = Math.sqrt(recent.reduce((a, b) => a + (b - rMean) ** 2, 0) / recent.length);
          if (rMean > 0 && rSd / rMean < 0.05) {
            flags.push({ line_key: t.line_key, label: t.label, type: "run_rate", severity: "low",
              actual_pct: actualPct, actual_amount: actualAmt, target_pct: t.target_pct,
              variance_pts: Math.round(variance * 100) / 100, dollars_over: sales ? Math.round((variance / 100) * sales) : null, context: [],
              message: `${t.label} steady at ~${rMean.toFixed(2)}% for 3 periods (budget ${t.target_pct.toFixed(2)}%) — likely your run-rate price, not a store issue. Consider re-baselining the target to ~${rMean.toFixed(2)}%.` });
            continue;
          }
        }
        const dollarsOver = sales ? (variance / 100) * sales : null;
        let severity = "low";
        if ((MAJORS.has(t.line_key) && variance >= 1.0) || (dollarsOver != null && dollarsOver >= 1000)) severity = "high";
        else if (variance >= threshold * 2 || (dollarsOver != null && dollarsOver >= 300)) severity = "med";
        const priorOver = series.filter((p) => p > t.target_pct).length;
        const context = [];
        if (priorOver >= 2) {
          context.push(`Chronic — over budget ${priorOver} of the last ${series.length} periods (not a one-off).`);
          if (severity === "low") severity = "med";
        }
        if (spike && mean != null) context.push(`Accelerating — spiking vs its trailing avg (${mean.toFixed(2)}%), not steady-state.`);
        flags.push({ line_key: t.line_key, label: t.label, type: "over_budget", severity,
          actual_pct: actualPct, actual_amount: actualAmt, target_pct: t.target_pct,
          variance_pts: Math.round(variance * 100) / 100, dollars_over: dollarsOver == null ? null : Math.round(dollarsOver), context,
          message: `${t.label} at ${actualPct.toFixed(2)}% vs ${t.target_pct.toFixed(2)}% budget — ${variance.toFixed(2)} pts over${dollarsOver ? ` (~$${Math.round(dollarsOver).toLocaleString()})` : ""}.` });
        continue;
      }
    }

    // 4. Anomaly — ONLY when within budget: an early warning that a good line
    // jumped and could breach next period.
    if (spike && mean != null) {
      flags.push({ line_key: t.line_key, label: t.label, type: "anomaly", severity: "med",
        actual_pct: actualPct, actual_amount: actualAmt, target_pct: t.target_pct, variance_pts: null, dollars_over: null, context: [],
        message: `${t.label} spiked to ${actualPct.toFixed(2)}% vs its trailing avg ${mean.toFixed(2)}% — still within budget, but trending up fast.` });
    }
  }
  for (const f of flags) f.stmt_label = stmtLabelByKey[f.line_key] || f.label;
  const rank = { high: 0, med: 1, low: 2 };
  flags.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((b.dollars_over ?? 0) - (a.dollars_over ?? 0)));
  return flags;
}

async function review(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const { data: cur } = await supa.from("pl_statements").select("*").eq("store_number", storeNumber).eq("period_end", period);
  const prelim = (cur ?? []).find((r) => !r.is_final) || null;
  const finalRow = (cur ?? []).find((r) => r.is_final) || null;
  const chosen = prelim || finalRow;
  if (!chosen) return { error: "No P&L uploaded for this store and period.", status: 404 };

  const { data: targetsRaw, error: tErr } = await supa
    .from("pl_budget_targets").select("line_key, label, is_group, target_pct, verify_on_zero, enabled, sort_order").order("sort_order");
  if (tErr && /pl_budget_targets/.test(tErr.message)) return { error: "Run migration 0265 first (pl_budget_targets is missing).", status: 500 };
  const targets = (targetsRaw || []).map((t) => ({ ...t, target_pct: t.target_pct == null ? null : Number(t.target_pct) }));

  // Trailing history (prior periods), collapsed to one per period (Final wins).
  const { data: hist } = await supa.from("pl_statements")
    .select("period_end, is_final, lines, total_sales").eq("store_number", storeNumber)
    .lt("period_end", period).order("period_end", { ascending: false }).limit(8);
  const byPeriod = new Map();
  for (const r of hist || []) { const ex = byPeriod.get(r.period_end); if (!ex || (r.is_final && !ex.is_final)) byPeriod.set(r.period_end, r); }
  const history = [...byPeriod.values()].slice(0, 4).map((r) => {
    const pctByKey = {}, amtByKey = {};
    for (const key of Object.keys(LINE_KEYWORDS)) {
      const line = matchLine(r.lines, key);
      const p = linePct(line, r.total_sales);
      if (typeof p === "number") pctByKey[key] = p;
      if (line && typeof line.amount === "number") amtByKey[key] = line.amount;
    }
    return { pctByKey, amtByKey };
  });

  const flags = computeFlags(chosen.lines, chosen.total_sales, targets, history);

  // Cross-reference the ranker for the SAME fiscal period as this P&L (a P6 P&L
  // reads the P6 ranker, not whatever ran most recently). Adds context to the
  // food + labor flags: food cost efficiency / FC score; whether they made their
  // labor chart; training credit already applied to labor.
  try {
    const fi = fiscalForDate(period);
    const targetPeriod = fi?.period ?? null;
    const { data: runs } = targetPeriod == null ? { data: [] } : await supa
      .from("ranking_runs").select("id").eq("status", "complete").eq("period", targetPeriod)
      .order("started_at", { ascending: false }).limit(1);
    const runId = runs?.[0]?.id;
    const rTag = targetPeriod == null ? "Ranker" : `Ranker P${targetPeriod}`;
    if (runId) {
      const { data: rr } = await supa
        .from("ranking_rows").select("metrics")
        .eq("run_id", runId).eq("scope", "ptd").eq("tier", "store").eq("entity_key", storeNumber).maybeSingle();
      const m = rr?.metrics || null;
      if (m) {
        const n = (v) => (typeof v === "number" && isFinite(v) ? v : null);
        const cogsEff = n(m.cogsEff), fcScore = n(m.fcScore);
        const laborPct = n(m.laborPct), varToChart = n(m.varianceToChart), laborScore = n(m.laborScore);
        const tcPct = n(m.trainingCreditPct), rSales = n(m.sales);
        const foodKeys = new Set(["food_cost", "cost_of_sales"]);
        const laborKeys = new Set(["total_labor", "hourly_wages", "salaried_managers", "overtime"]);
        for (const f of flags) {
          if (foodKeys.has(f.line_key) && cogsEff != null) {
            f.context.push(`${rTag}: food cost efficiency ${(cogsEff * 100).toFixed(1)}%${fcScore != null ? ` · FC score ${fcScore}/5` : ""}.`);
          }
          if (laborKeys.has(f.line_key)) {
            if (varToChart != null) {
              f.context.push(`${rTag} labor chart: ${varToChart <= 0 ? "MADE chart" : "MISSED chart"} — ${laborPct != null ? `labor ${(laborPct * 100).toFixed(2)}%, ` : ""}variance ${(varToChart * 100).toFixed(2)} pts${laborScore != null ? ` · score ${laborScore}/5` : ""}.`);
            }
            if (tcPct != null && tcPct > 0) {
              const tcDollars = rSales ? tcPct * rSales : null;
              f.context.push(`Training credit applied: ${(tcPct * 100).toFixed(2)}% of sales${tcDollars ? ` (~$${Math.round(tcDollars).toLocaleString()})` : ""} — already offsetting labor.`);
            }
          }
        }
      }
    }
  } catch { /* ranker context is a nicety — never fail the review */ }

  // Append-only log — oldest first so each flag reads top-to-bottom in order.
  const { data: notes } = await supa.from("pl_review_notes")
    .select("id, line_key, root_cause, action_steps, author_id, author_name, author_role, created_at, updated_at")
    .eq("store_number", storeNumber).eq("period_end", period)
    .order("created_at", { ascending: true });

  // DO sign-off for this store/period, plus whether it's stale (any note added
  // or edited after it was signed) so the UI can prompt a re-sign.
  const { data: signRow } = await supa.from("pl_review_signoffs")
    .select("signed_by_id, signed_by_name, signed_by_role, signed_at")
    .eq("store_number", storeNumber).eq("period_end", period).maybeSingle();
  let signoff = null;
  if (signRow) {
    const signedMs = new Date(signRow.signed_at).getTime();
    const stale = (notes || []).some((n) => new Date(n.updated_at).getTime() > signedMs);
    signoff = { ...signRow, stale };
  }

  return {
    store: { number: storeNumber, name: store.name },
    stage: chosen.is_final ? "final" : "prelim",
    total_sales: chosen.total_sales,
    flags,
    notes: notes || [],
    my_author_id: user.id,
    signoff,
    can_sign: SIGN_ROLES.has(user.role),
  };
}

// Per-store review status for a whole period — which stores still owe notes.
// Uses budget-variance + verify-on-$0 flags only (skips the per-store history
// checks) so it stays a couple of queries instead of N. The full engine still
// runs when a store is opened.
async function reviewSummary(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const period = String(params.period || "").trim();
  if (!period) return { error: "period is required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const visibleNums = new Set(stores.map((s) => String(s.number)));

  const { data: targetsRaw } = await supa
    .from("pl_budget_targets").select("line_key, label, is_group, target_pct, verify_on_zero, enabled, sort_order").order("sort_order");
  const targets = (targetsRaw || []).map((t) => ({ ...t, target_pct: t.target_pct == null ? null : Number(t.target_pct) }));

  const { data: sts } = await supa
    .from("pl_statements").select("store_number, is_final, lines, total_sales").eq("period_end", period);
  const byStore = new Map();
  for (const r of sts || []) {
    if (!visibleNums.has(String(r.store_number))) continue;
    const keep = byStore.get(r.store_number);
    if (!keep || (!r.is_final && keep.is_final)) byStore.set(r.store_number, r); // prefer prelim
  }

  const { data: notes } = await supa.from("pl_review_notes").select("store_number, line_key").eq("period_end", period);
  const addressed = new Set((notes || []).map((n) => `${n.store_number}|${n.line_key}`));

  const rows = [];
  for (const [num, r] of byStore) {
    const flags = computeFlags(r.lines, r.total_sales, targets, []);
    const noted = flags.filter((f) => addressed.has(`${num}|${f.line_key}`)).length;
    rows.push({ store_number: String(num), flags: flags.length, noted, owed: flags.length - noted });
  }
  return { period, rows };
}

// Roll-up: the caller's stores aggregated by DO / SDO / RVP — store count,
// sales, CI, flag/owed counts and total $ over budget per leader. Powers the
// DO/SDO/RVP/VP roll-ups (pick the tier to group by). Budget + pest flags only
// (no per-store history), like the summary.
async function reviewRollup(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const period = String(params.period || "").trim();
  const groupBy = ["do", "sdo", "rvp"].includes(params.group_by) ? params.group_by : "do";
  if (!period) return { error: "period is required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const visibleNums = stores.map((s) => String(s.number));
  if (!visibleNums.length) return { period, group_by: groupBy, groups: [] };
  const nameByNumber = new Map(stores.map((s) => [String(s.number), s.name]));

  const { data: targetsRaw } = await supa
    .from("pl_budget_targets").select("line_key, label, is_group, target_pct, verify_on_zero, enabled, sort_order").order("sort_order");
  const targets = (targetsRaw || []).map((t) => ({ ...t, target_pct: t.target_pct == null ? null : Number(t.target_pct) }));

  const { data: sts } = await supa
    .from("pl_statements").select("store_number, is_final, lines, total_sales, ci_amount")
    .eq("period_end", period).in("store_number", visibleNums);
  const byStore = new Map();
  for (const r of sts || []) { const keep = byStore.get(r.store_number); if (!keep || (!r.is_final && keep.is_final)) byStore.set(r.store_number, r); }

  // Notes carry updated_at so we can tell if a sign-off went stale (a note
  // changed after it was signed), matching the per-store review view.
  const { data: notes } = await supa.from("pl_review_notes")
    .select("store_number, line_key, updated_at").eq("period_end", period);
  const addressed = new Set((notes || []).map((n) => `${n.store_number}|${n.line_key}`));
  const maxNoteMs = new Map();
  for (const n of notes || []) {
    const ms = new Date(n.updated_at).getTime();
    const key = String(n.store_number);
    if (ms > (maxNoteMs.get(key) ?? 0)) maxNoteMs.set(key, ms);
  }

  const { data: signs } = await supa.from("pl_review_signoffs")
    .select("store_number, signed_at").eq("period_end", period).in("store_number", visibleNums);
  const signedAtByStore = new Map((signs || []).map((s) => [String(s.store_number), new Date(s.signed_at).getTime()]));

  const org = await resolveOrg(supa, [...byStore.keys()]);
  const nameFor = (num) => {
    const o = org.get(String(num)) || {};
    return (groupBy === "do" ? o.doName : groupBy === "sdo" ? o.sdoName : o.rvpName) || "Unassigned";
  };

  const groups = new Map();
  for (const [num, r] of byStore) {
    const numKey = String(num);
    const flags = computeFlags(r.lines, r.total_sales, targets, []);
    const owed = flags.filter((f) => !addressed.has(`${num}|${f.line_key}`)).length;
    const dollarsOver = flags.reduce((a, f) => a + (f.dollars_over || 0), 0);
    const signedAt = signedAtByStore.get(numKey) ?? null;
    const signed = signedAt != null;
    const signedStale = signed && (maxNoteMs.get(numKey) ?? 0) > signedAt;
    const totalSales = Number(r.total_sales) || 0;
    const ciAmount = Number(r.ci_amount) || 0;
    const key = nameFor(num);
    const g = groups.get(key) || { name: key, stores: 0, total_sales: 0, ci_amount: 0, flags: 0, owed: 0, dollars_over: 0, signed_count: 0, store_rows: [] };
    g.stores += 1;
    g.total_sales += totalSales;
    g.ci_amount += ciAmount;
    g.flags += flags.length;
    g.owed += owed;
    g.dollars_over += dollarsOver;
    if (signed && !signedStale) g.signed_count += 1;
    g.store_rows.push({
      store_number: numKey,
      store_name: nameByNumber.get(numKey) ?? null,
      total_sales: totalSales,
      ci_amount: ciAmount,
      ci_pct: totalSales ? (ciAmount / totalSales) * 100 : null,
      flags: flags.length,
      owed,
      dollars_over: Math.round(dollarsOver),
      signed,
      signed_stale: signedStale,
    });
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => {
    const { store_rows, ...rest } = g;
    store_rows.sort((a, b) => b.owed - a.owed || b.dollars_over - a.dollars_over || a.store_number.localeCompare(b.store_number, undefined, { numeric: true }));
    return { ...rest, ci_pct: g.total_sales ? (g.ci_amount / g.total_sales) * 100 : null, dollars_over: Math.round(g.dollars_over), stores_detail: store_rows };
  });
  out.sort((a, b) => b.owed - a.owed || b.dollars_over - a.dollars_over);
  return { period, group_by: groupBy, groups: out };
}

async function saveReviewNote(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(body?.store || "").trim();
  const period = String(body?.period || "").trim();
  const lineKey = String(body?.line_key || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };

  const rootCause = String(body?.root_cause ?? "").slice(0, 4000).trim();
  const actionSteps = String(body?.action_steps ?? "").slice(0, 4000).trim();
  if (!rootCause && !actionSteps) return { error: "Add a root cause or an action step before saving.", status: 400 };
  const now = new Date().toISOString();
  // Append-only: every save is its own timestamped entry (migration 0268 drops
  // the per-author unique constraint), so the flag keeps the full note history.
  const row = {
    period_end: period, store_number: storeNumber, store_id: store.id ?? null, line_key: lineKey,
    root_cause: rootCause || null, action_steps: actionSteps || null,
    author_id: user.id, author_name: user.preferred_name || user.full_name || user.email || null, author_role: user.role,
    created_at: now, updated_at: now,
  };
  const { data, error } = await supa.from("pl_review_notes")
    .insert(row)
    .select("id, line_key, root_cause, action_steps, author_id, author_name, author_role, created_at, updated_at").single();
  if (error) {
    if (/pl_review_notes/.test(error.message)) return { error: "Run migration 0266 first (pl_review_notes is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { note: data };
}

// Edit one of the caller's own note entries. Authors edit only their own rows.
async function updateReviewNote(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required", status: 400 };
  const { data: existing } = await supa.from("pl_review_notes").select("id, author_id").eq("id", id).maybeSingle();
  if (!existing) return { error: "Note not found.", status: 404 };
  if (existing.author_id !== user.id) return { error: "You can only edit your own notes.", status: 403 };
  const rootCause = String(body?.root_cause ?? "").slice(0, 4000).trim();
  const actionSteps = String(body?.action_steps ?? "").slice(0, 4000).trim();
  if (!rootCause && !actionSteps) return { error: "A note can't be emptied — delete it instead.", status: 400 };
  const { data, error } = await supa.from("pl_review_notes")
    .update({ root_cause: rootCause || null, action_steps: actionSteps || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, line_key, root_cause, action_steps, author_id, author_name, author_role, created_at, updated_at").single();
  if (error) return { error: error.message, status: 500 };
  return { note: data };
}

// Delete one of the caller's own note entries.
async function deleteReviewNote(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required", status: 400 };
  const { data: existing } = await supa.from("pl_review_notes").select("id, author_id").eq("id", id).maybeSingle();
  if (!existing) return { error: "Note not found.", status: 404 };
  if (existing.author_id !== user.id) return { error: "You can only delete your own notes.", status: 403 };
  const { error } = await supa.from("pl_review_notes").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// DO sign-off: attest the store's notes for a period are reviewed. Re-signing
// upserts (updates who/when), which also clears any "stale" state since the new
// signed_at moves past every existing note's updated_at.
async function saveSignoff(supa, user, body) {
  if (!SIGN_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(body?.store || "").trim();
  const period = String(body?.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  const row = {
    period_end: period, store_number: storeNumber, store_id: store.id ?? null,
    signed_by_id: user.id, signed_by_name: user.preferred_name || user.full_name || user.email || null,
    signed_by_role: user.role, signed_at: new Date().toISOString(),
  };
  const { data, error } = await supa.from("pl_review_signoffs")
    .upsert(row, { onConflict: "period_end,store_number" })
    .select("signed_by_id, signed_by_name, signed_by_role, signed_at").single();
  if (error) {
    if (/pl_review_signoffs/.test(error.message)) return { error: "Run migration 0269 first (pl_review_signoffs is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { signoff: { ...data, stale: false } };
}

// A stable slug for a statement line label, so re-flagging the same line
// upserts instead of stacking duplicates.
function lineSlug(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

// Team-created flags on any statement line for a store/period.
async function listManualFlags(supa, user, params) {
  if (!READ_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(params.store || "").trim();
  const period = String(params.period || "").trim();
  if (!storeNumber || !period) return { error: "store and period are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  if (!stores.some((s) => String(s.number) === storeNumber)) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  const { data, error } = await supa.from("pl_manual_flags")
    .select("id, line_key, line_label, reason, flagged_by_id, flagged_by_name, flagged_by_role, created_at, updated_at")
    .eq("store_number", storeNumber).eq("period_end", period)
    .order("created_at", { ascending: true });
  if (error) {
    if (/pl_manual_flags/.test(error.message)) return { error: "Run migration 0271 first (pl_manual_flags is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { flags: data || [], my_id: user.id, can_flag: NOTE_ROLES.has(user.role) };
}

// Flag a line (or edit an existing flag's reason). One flag per line — upsert.
async function saveManualFlag(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const storeNumber = String(body?.store || "").trim();
  const period = String(body?.period || "").trim();
  const lineLabel = String(body?.line_label || "").trim();
  if (!storeNumber || !period || !lineLabel) return { error: "store, period and line_label are required", status: 400 };
  const stores = await callerVisibleStores(supa, user);
  const store = stores.find((s) => String(s.number) === storeNumber);
  if (!store) return { error: `Store ${storeNumber} is outside your scope.`, status: 403 };
  const reason = String(body?.reason ?? "").slice(0, 2000).trim();
  const now = new Date().toISOString();
  const row = {
    period_end: period, store_number: storeNumber, store_id: store.id ?? null,
    line_key: lineSlug(lineLabel), line_label: lineLabel, reason: reason || null,
    flagged_by_id: user.id, flagged_by_name: user.preferred_name || user.full_name || user.email || null,
    flagged_by_role: user.role, updated_at: now,
  };
  const { data, error } = await supa.from("pl_manual_flags")
    .upsert(row, { onConflict: "period_end,store_number,line_key" })
    .select("id, line_key, line_label, reason, flagged_by_id, flagged_by_name, flagged_by_role, created_at, updated_at").single();
  if (error) {
    if (/pl_manual_flags/.test(error.message)) return { error: "Run migration 0271 first (pl_manual_flags is missing).", status: 500 };
    return { error: error.message, status: 500 };
  }
  return { flag: data };
}

// Remove a manual flag — the person who raised it, or a DO/above.
async function deleteManualFlag(supa, user, body) {
  if (!NOTE_ROLES.has(user.role)) return { error: "not authorized", status: 403 };
  const id = String(body?.id || "").trim();
  if (!id) return { error: "id is required", status: 400 };
  const { data: existing } = await supa.from("pl_manual_flags").select("id, flagged_by_id").eq("id", id).maybeSingle();
  if (!existing) return { error: "Flag not found.", status: 404 };
  if (existing.flagged_by_id !== user.id && !SIGN_ROLES.has(user.role)) {
    return { error: "Only the person who raised it, or a DO, can clear this flag.", status: 403 };
  }
  const { error } = await supa.from("pl_manual_flags").delete().eq("id", id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
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

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  const unwrap = (result) => {
    if (result && typeof result === "object" && "status" in result && "error" in result) {
      return respond(result.status, { error: result.error });
    }
    return respond(200, result);
  };

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "periods") return unwrap(await listPeriods(supa));
      if (action === "overview") return unwrap(await overview(supa, user, params));
      if (action === "statement") return unwrap(await statement(supa, user, params));
      if (action === "compare") return unwrap(await compare(supa, user, params));
      if (action === "line-trend") return unwrap(await lineTrend(supa, user, params));
      if (action === "budget") return unwrap(await getBudget(supa, user));
      if (action === "review") return unwrap(await review(supa, user, params));
      if (action === "review-summary") return unwrap(await reviewSummary(supa, user, params));
      if (action === "review-rollup") return unwrap(await reviewRollup(supa, user, params));
      if (action === "manual-flags") return unwrap(await listManualFlags(supa, user, params));
      return respond(400, { error: `unknown GET action: ${action}` });
    }
    if (event.httpMethod === "POST") {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return respond(400, { error: "invalid JSON body" });
      }
      if (action === "upload") return unwrap(await upload(supa, user, body));
      if (action === "budget-set") return unwrap(await setBudget(supa, user, body));
      if (action === "review-note") return unwrap(await saveReviewNote(supa, user, body));
      if (action === "review-note-update") return unwrap(await updateReviewNote(supa, user, body));
      if (action === "review-note-delete") return unwrap(await deleteReviewNote(supa, user, body));
      if (action === "review-signoff") return unwrap(await saveSignoff(supa, user, body));
      if (action === "manual-flag") return unwrap(await saveManualFlag(supa, user, body));
      if (action === "manual-flag-delete") return unwrap(await deleteManualFlag(supa, user, body));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    console.error("[pl]", action, e?.message || e);
    return respond(500, { error: e?.message || "server error" });
  }
};
