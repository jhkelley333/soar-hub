import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mirrors the enum order in supabase-schema.sql — must stay in sync.
const ROLE_RANK = {
  employee:          0,
  store_manager:     1,
  district_manager:  2,
  market_director:   3,
  regional_director: 4,
  admin:             5,
  super_admin:       6,
};

const CLEAR_COOKIE =
  'soar_session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/';

// =============================================================================
// Shared utilities
// =============================================================================

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

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchUser(id) {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id,
      full_name,
      email,
      role,
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
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('fetchUser db error:', error.message);
    return null;
  }
  if (!data || !data.is_active) return null;
  return data;
}

function formatUser(user) {
  const assignedStore = user.stores ?? null;
  return {
    id:               user.id,
    fullName:         user.full_name,
    email:            user.email,
    role:             user.role,
    assignedStore,
    assignedStores:   assignedStore ? [assignedStore] : [],
    assignedDistrict: user.districts ?? null,
    assignedMarket:   user.markets   ?? null,
    assignedRegion:   user.regions   ?? null,
  };
}

// Resolves the soar_session cookie → verified JWT → live user row.
// Returns null on any failure (missing cookie, bad JWT, inactive/missing user).
async function resolveSession(cookieHeader) {
  const token = parseCookie(cookieHeader, 'soar_session');
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload?.id) return null;

  return fetchUser(payload.id);
}

// =============================================================================
// Action: validate
// =============================================================================

async function handleValidate(cookieHeader) {
  const user = await resolveSession(cookieHeader);
  if (!user) return json(401, { ok: false });
  return json(200, { ok: true, user: formatUser(user) });
}

// =============================================================================
// Action: getModules
// =============================================================================

async function handleGetModules(cookieHeader) {
  const user = await resolveSession(cookieHeader);
  if (!user) return json(401, { ok: false });

  // Fetch all active modules and any per-role overrides for this user in parallel.
  const [modulesResult, accessResult] = await Promise.all([
    supabase
      .from('modules')
      .select('id, key, name, description, icon, min_role, sort_order, group_name')
      .eq('status', 'active')
      .order('group_name')
      .order('sort_order'),
    supabase
      .from('module_access')
      .select('module_id, is_enabled')
      .eq('role', user.role),
  ]);

  if (modulesResult.error) {
    console.error('getModules query error:', modulesResult.error.message);
    return fail(500, 'Failed to load modules');
  }

  const userRank = ROLE_RANK[user.role] ?? -1;

  // moduleId → is_enabled (explicit overrides only; absence means "use min_role")
  const overrides = Object.fromEntries(
    (accessResult.data ?? []).map(({ module_id, is_enabled }) => [module_id, is_enabled])
  );

  const accessible = (modulesResult.data ?? []).filter((mod) => {
    // User's role doesn't meet the module's minimum threshold.
    if (userRank < (ROLE_RANK[mod.min_role] ?? 999)) return false;
    // An explicit override for this role disables the module.
    if (overrides[mod.id] === false) return false;
    return true;
  });

  return json(200, { ok: true, modules: accessible });
}

// =============================================================================
// Action: logout
// =============================================================================

function handleLogout() {
  return json(200, { ok: true }, { 'Set-Cookie': CLEAR_COOKIE });
}

// =============================================================================
// Main handler
// =============================================================================

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return fail(405, 'Method not allowed');
  }

  const action = event.queryStringParameters?.action;
  const cookieHeader = event.headers?.cookie ?? '';

  switch (action) {
    case 'validate':   return handleValidate(cookieHeader);
    case 'getModules': return handleGetModules(cookieHeader);
    case 'logout':     return handleLogout();
    default:           return fail(400, `Unknown action: "${action ?? ''}"`);
  }
};
