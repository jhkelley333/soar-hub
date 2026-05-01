import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Initialized once per cold start; reused across warm invocations.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Dummy hash used in the constant-time path when a username is not found,
// preventing timing-based username enumeration.
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuvuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu';

const SESSION_MAX_AGE = 28800; // 8 hours in seconds

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function fail(statusCode, message) {
  return json(statusCode, { ok: false, message });
}

function buildCookie(token) {
  return [
    `soar_session=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${SESSION_MAX_AGE}`,
    'Path=/',
  ].join('; ');
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  // --- Parse body ---
  let username, password;
  try {
    ({ username, password } = JSON.parse(event.body ?? '{}'));
  } catch {
    return fail(400, 'Invalid JSON body');
  }

  if (!username || !password) {
    return fail(400, 'username and password are required');
  }

  // --- Fetch user with related hierarchy rows ---
  const { data: user, error: dbError } = await supabase
    .from('users')
    .select(`
      id,
      full_name,
      email,
      role,
      pin_hash,
      force_password_change,
      is_active,
      store_id,
      district_id,
      market_id,
      region_id,
      stores   ( id, name, number ),
      districts( id, name, code ),
      markets  ( id, name, code ),
      regions  ( id, name, code )
    `)
    .eq('username', username)
    .maybeSingle();

  if (dbError) {
    console.error('login db error:', dbError.message);
    return fail(500, 'An unexpected error occurred');
  }

  // Always run bcrypt to prevent timing-based username enumeration.
  const hashToCompare = user?.pin_hash ?? DUMMY_HASH;
  const passwordValid = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordValid) {
    return fail(401, 'Invalid username or password');
  }

  if (!user.is_active) {
    return fail(403, 'Account is disabled — contact your administrator');
  }

  // --- Force password change: return early before issuing a session ---
  if (user.force_password_change) {
    return json(200, { ok: true, forcePasswordChange: true });
  }

  // --- Update last_login (fire-and-forget; don't block the response) ---
  supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id)
    .then(({ error }) => {
      if (error) console.error('last_login update failed:', error.message);
    });

  // --- Sign JWT ---
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    return fail(500, 'Server configuration error');
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: SESSION_MAX_AGE }
  );

  // --- Build response payload ---
  // assignedStores is an array to support future multi-store assignments.
  const assignedStore = user.stores ?? null;
  const assignedStores = assignedStore ? [assignedStore] : [];

  return json(
    200,
    {
      ok: true,
      user: {
        id:               user.id,
        fullName:         user.full_name,
        email:            user.email,
        role:             user.role,
        assignedStore,
        assignedStores,
        assignedDistrict: user.districts ?? null,
        assignedMarket:   user.markets   ?? null,
        assignedRegion:   user.regions   ?? null,
      },
    },
    { 'Set-Cookie': buildCookie(token) }
  );
};
