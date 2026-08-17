// netlify/functions/cultural-index.js
//
// Cultural Index results importer. Admins upload the Culture Index survey
// export (CSV) and this ties each person's Trait Pattern to their Hub profile
// (profiles.cultural_index_trait), which then surfaces on the GM Roster and the
// person's My Account page.
//
// Matching, in confidence order:
//   1. email    — CSV email == a profile email (case-insensitive). Trusted.
//   2. name     — normalized "First Last" uniquely equals one profile's name.
//   3. fuzzy    — a close name (same last name + first initial / small edit
//                 distance, or same first + last initial). NOT auto-applied:
//                 returned as candidate(s) for the admin to confirm
//                 ("is this the same person?"), preferring profiles that don't
//                 already carry a trait.
//   4. none     — no plausible profile.
//
// Actions:
//   POST ?action=preview  { rows:[{first_name,last_name,email,trait,job_title}] }
//        -> { rows:[annotated], summary }
//   POST ?action=commit   { assignments:[{profile_id, trait}] }
//        -> { updated, results:[{profile_id, trait, status, message?}] }
//
// Admin-only. Env: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("cultural-index env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

// PostgREST caps a response at 1000 rows — page through so a company-wide
// profile list comes back whole.
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

// ----------------------------------------------------------------------------
// Name normalization + fuzzy scoring
// ----------------------------------------------------------------------------

// Lowercase, strip accents + punctuation, collapse whitespace.
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLastOf(fullNorm) {
  const t = fullNorm.split(" ").filter(Boolean);
  if (t.length === 0) return { first: "", last: "" };
  if (t.length === 1) return { first: t[0], last: "" };
  return { first: t[0], last: t[t.length - 1] };
}

// Levenshtein distance, capped small — we only care about tiny edits.
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Score how likely a CSV (first,last) is the same person as a profile name.
// Returns 0..1; 1.0 is an exact first+last. Below ~0.6 = not a candidate.
function nameScore(cFirst, cLast, pFull) {
  if (!pFull) return 0;
  const { first: pFirst, last: pLast } = firstLastOf(pFull);
  if (!cFirst && !cLast) return 0;

  // Exact first + last.
  if (cFirst === pFirst && cLast === pLast && cLast) return 1;

  // Same last name — with a first-name signal (initial or a tiny typo). A
  // shared surname ALONE (every "Smith") is intentionally not a candidate;
  // that's just noise for the admin to wade through.
  if (cLast && cLast === pLast && cFirst && pFirst) {
    if (cFirst[0] === pFirst[0]) return 0.85; // Mike/Michael
    if (lev(cFirst, pFirst) <= 2) return 0.75; // Jon/John
  }

  // Same first name — last name slightly off (typo / maiden vs married initial).
  if (cFirst && cFirst === pFirst && cLast && pLast) {
    if (cLast[0] === pLast[0]) return 0.65;
    if (lev(cLast, pLast) <= 2) return 0.6;
  }

  // Whole-string near match (transposition, hyphen drift, etc.).
  const whole = `${cFirst} ${cLast}`.trim();
  if (whole && pFull && lev(whole, pFull) <= 2) return 0.7;

  return 0;
}

// ----------------------------------------------------------------------------
// preview
// ----------------------------------------------------------------------------

const MAX_ROWS = 2000;

async function preview(supa, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No rows to preview.", status: 400 };
  }
  if (rows.length > MAX_ROWS) {
    return { error: `Too many rows (${rows.length}). Max ${MAX_ROWS}.`, status: 400 };
  }

  const profiles = await selectAll(
    supa,
    "profiles",
    "id, full_name, preferred_name, email, role, cultural_index_trait, is_active",
    (q) => q.eq("is_active", true),
  );

  const byEmail = new Map();
  for (const p of profiles) {
    if (p.email) byEmail.set(String(p.email).toLowerCase().trim(), p);
  }
  // Pre-normalize each profile's candidate names once.
  const idx = profiles.map((p) => {
    const names = [norm(p.full_name), norm(p.preferred_name)].filter(Boolean);
    return { p, names };
  });

  const display = (p) =>
    p.full_name || p.preferred_name || p.email || "(unnamed)";
  const cand = (p, score) => ({
    id: p.id,
    name: display(p),
    role: p.role,
    email: p.email ?? null,
    current_trait: p.cultural_index_trait ?? null,
    has_trait: !!p.cultural_index_trait,
    score: Math.round(score * 100) / 100,
  });

  const out = rows.map((r, i) => {
    const first = String(r.first_name || "").trim();
    const last = String(r.last_name || "").trim();
    const email = String(r.email || "").trim();
    const trait = String(r.trait || "").trim();
    const jobTitle = String(r.job_title || "").trim();
    const base = {
      row: i + 1,
      first_name: first,
      last_name: last,
      email,
      trait,
      job_title: jobTitle,
    };

    if (!trait) {
      return { ...base, match_type: "no_trait", needs_confirm: false, profile: null, candidates: [] };
    }

    // 1. Email — trusted.
    const em = byEmail.get(email.toLowerCase());
    if (email && em) {
      return {
        ...base,
        match_type: "email",
        needs_confirm: false,
        profile: cand(em, 1),
        candidates: [],
      };
    }

    // 2. Exact normalized name — unique match only.
    const cFirst = norm(first);
    const cLast = norm(last);
    const cWhole = `${cFirst} ${cLast}`.trim();
    const exact = idx.filter(({ names }) =>
      names.some((n) => {
        const fl = firstLastOf(n);
        return n === cWhole || (fl.first === cFirst && fl.last === cLast && cLast);
      }),
    );
    if (exact.length === 1) {
      return {
        ...base,
        match_type: "name",
        needs_confirm: false,
        profile: cand(exact[0].p, 1),
        candidates: [],
      };
    }
    if (exact.length > 1) {
      // Same name twice in the org — make the admin choose.
      return {
        ...base,
        match_type: "ambiguous",
        needs_confirm: true,
        profile: null,
        candidates: exact
          .map(({ p }) => cand(p, 1))
          .sort((a, b) => Number(a.has_trait) - Number(b.has_trait)),
      };
    }

    // 3. Fuzzy — best-scoring profiles, trait-less first (per the ask).
    const scored = [];
    for (const { p, names } of idx) {
      let best = 0;
      for (const n of names) best = Math.max(best, nameScore(cFirst, cLast, n));
      if (best >= 0.6) scored.push(cand(p, best));
    }
    scored.sort(
      (a, b) => Number(a.has_trait) - Number(b.has_trait) || b.score - a.score,
    );
    if (scored.length) {
      return {
        ...base,
        match_type: "fuzzy",
        needs_confirm: true,
        profile: null,
        candidates: scored.slice(0, 5),
      };
    }

    // 4. Nothing.
    return { ...base, match_type: "none", needs_confirm: false, profile: null, candidates: [] };
  });

  const summary = {
    total: out.length,
    email: out.filter((r) => r.match_type === "email").length,
    name: out.filter((r) => r.match_type === "name").length,
    fuzzy: out.filter((r) => r.match_type === "fuzzy").length,
    ambiguous: out.filter((r) => r.match_type === "ambiguous").length,
    none: out.filter((r) => r.match_type === "none").length,
    no_trait: out.filter((r) => r.match_type === "no_trait").length,
  };
  return { rows: out, summary };
}

// ----------------------------------------------------------------------------
// commit
// ----------------------------------------------------------------------------

async function commit(supa, assignments) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { error: "No assignments to apply.", status: 400 };
  }
  // Collapse to one write per profile (last trait wins) so two CSV rows aimed
  // at the same person don't fight.
  const byProfile = new Map();
  for (const a of assignments) {
    const id = String(a?.profile_id || "").trim();
    const trait = String(a?.trait || "").trim();
    if (!id || !trait) continue;
    byProfile.set(id, trait);
  }
  if (byProfile.size === 0) {
    return { error: "No valid assignments (need profile_id + trait).", status: 400 };
  }

  const results = [];
  let updated = 0;
  for (const [profileId, trait] of byProfile) {
    const { error } = await supa
      .from("profiles")
      .update({ cultural_index_trait: trait })
      .eq("id", profileId);
    if (error) {
      results.push({ profile_id: profileId, trait, status: "error", message: error.message });
    } else {
      updated += 1;
      results.push({ profile_id: profileId, trait, status: "updated" });
    }
  }
  return { updated, results };
}

// ----------------------------------------------------------------------------
// handler
// ----------------------------------------------------------------------------

function unwrap(result) {
  if (result && typeof result === "object" && "status" in result && "error" in result) {
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
  if (String(user.role).toLowerCase() !== "admin") {
    return respond(403, { error: "Cultural Index import is admin-only." });
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "";

  try {
    const supa = admin();
    if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      if (action === "preview") return unwrap(await preview(supa, body.rows));
      if (action === "commit") return unwrap(await commit(supa, body.assignments));
      return respond(400, { error: `unknown POST action: ${action}` });
    }
    return respond(405, { error: "method not allowed" });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};
