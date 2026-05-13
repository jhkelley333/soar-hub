// docs/v2/facilities-v2-prototype.js
//
// REFERENCE ONLY — verbatim copy of the original Facilities V2 netlify
// function from before the port. Auth uses the legacy soar_session
// cookie. The live ported version is `netlify/functions/facilities-v2.js`
// which switches to Supabase Bearer JWT and the `wo2_*` table prefix.
//
// Kept here so we can diff during the port + grab any handler logic
// that didn't make it across.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

function getSessionUser(event) {
  try {
    const cookie  = event.headers.cookie || '';
    const match   = cookie.match(/soar_session=([^;]+)/);
    if (!match) return null;
    const session = JSON.parse(Buffer.from(match[1], 'base64').toString());
    if (!session || Date.now() > session.expiresAt) return null;
    return session.user;
  } catch(e) { return null; }
}

function respond(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function getRoleLevel(role) {
  const levels = { ADMIN:1, SDO:2, DO:3, GM:4, SHIFT_MGR:5, VENDOR:6 };
  return levels[String(role||'').toUpperCase()] || 99;
}

function getStoresForUser(user) {
  const role   = String(user.role||'').toUpperCase();
  const stores = Array.isArray(user.assignedStores) ? user.assignedStores.filter(Boolean) : [];
  const single = String(user.assignedStore||'').trim();
  if (['ADMIN','SDO'].includes(role)) return { all: true, stores: [] };
  if (role === 'DO') return { all: false, stores: stores.length ? stores : (single ? [single] : []) };
  return { all: false, stores: single ? [single] : [] };
}

// ── GENERATE WO NUMBER ──
async function generateWONumber(supabase, storeNumber) {
  const { data, error } = await supabase.rpc('next_wo_sequence', { p_store: String(storeNumber) });
  if (error) {
    const { data: seq } = await supabase
      .from('wo_sequences')
      .select('last_sequence')
      .eq('store_number', String(storeNumber))
      .single();
    const next = ((seq && seq.last_sequence) || 0) + 1;
    await supabase.from('wo_sequences').upsert({ store_number: String(storeNumber), last_sequence: next });
    return `WO-${storeNumber}-${String(next).padStart(3,'0')}`;
  }
  return `WO-${storeNumber}-${String(data).padStart(3,'0')}`;
}

// ... full handler body preserved upstream in the live function.
// See netlify/functions/facilities-v2.js for the ported version with
// Bearer JWT auth and wo2_* table prefix.
