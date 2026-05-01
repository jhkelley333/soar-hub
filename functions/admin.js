import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULT_PASSWORD = 'Soar1234!';
const BCRYPT_ROUNDS = 10;

// Role sets mapped to the app's terminology:
//   ADMIN = admin, super_admin
//   SDO   = regional_director  (Senior District Operator / area level)
//   DO    = market_director, district_manager  (District Operator)
const ADMIN_ROLES  = new Set(['admin', 'super_admin']);
const SDO_ROLES    = new Set(['regional_director']);
const DO_ROLES     = new Set(['market_director', 'district_manager']);

const CAN_READ_USERS   = new Set([...ADMIN_ROLES, ...SDO_ROLES, ...DO_ROLES]);
const CAN_MANAGE_USERS = new Set([...ADMIN_ROLES, ...SDO_ROLES]);

// Mirrors enum order in supabase-schema.sql for escalation checks.
const ROLE_RANK = {
  employee:          0,
  store_manager:     1,
  district_manager:  2,
  market_director:   3,
  regional_director: 4,
  admin:             5,
  super_admin:       6,
};

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

// Resolves and validates the soar_session cookie → user row.
// Returns { user } on success or { error } response on failure.
async function resolveSession(cookieHeader, requiredRoles) {
  const token = parseCookie(cookieHeader, 'soar_session');
  if (!token) return { error: fail(401, 'Not authenticated') };

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { error: fail(401, 'Invalid or expired session') };
  }

  const { data: user, error: dbError } = await supabase
    .from('users')
    .select('id, role, is_active, district_id, market_id, region_id')
    .eq('id', payload.id)
    .maybeSingle();

  if (dbError) {
    console.error('resolveSession db error:', dbError.message);
    return { error: fail(500, 'An unexpected error occurred') };
  }
  if (!user || !user.is_active) {
    return { error: fail(401, 'Not authenticated') };
  }
  if (requiredRoles && !requiredRoles.has(user.role)) {
    return { error: fail(403, 'Insufficient permissions') };
  }

  return { user };
}

// Full select used by both getUsers and createUser.
const USER_SELECT = `
  id, email, username, full_name, role, phone,
  is_active, force_password_change, last_login,
  created_at, updated_at,
  store_id, district_id, market_id, region_id,
  stores   ( id, name, number ),
  districts( id, name, code ),
  markets  ( id, name, code ),
  regions  ( id, name, code )
`;

function formatRow(u) {
  const assignedStore = u.stores ?? null;
  return {
    id:                   u.id,
    email:                u.email,
    username:             u.username,
    fullName:             u.full_name,
    role:                 u.role,
    phone:                u.phone ?? null,
    isActive:             u.is_active,
    forcePasswordChange:  u.force_password_change,
    lastLogin:            u.last_login ?? null,
    createdAt:            u.created_at,
    updatedAt:            u.updated_at,
    assignedStore,
    assignedStores:       assignedStore ? [assignedStore] : [],
    assignedDistrict:     u.districts ?? null,
    assignedMarket:       u.markets   ?? null,
    assignedRegion:       u.regions   ?? null,
  };
}

// =============================================================================
// Action: getUsers
// =============================================================================

async function handleGetUsers(cookieHeader) {
  const { user, error } = await resolveSession(cookieHeader, CAN_READ_USERS);
  if (error) return error;

  const { data: users, error: dbError } = await supabase
    .from('users')
    .select(USER_SELECT)
    .order('full_name');

  if (dbError) {
    console.error('getUsers db error:', dbError.message);
    return fail(500, 'Failed to fetch users');
  }

  return json(200, { ok: true, users: users.map(formatRow) });
}

// =============================================================================
// Action: createUser
// =============================================================================

async function handleCreateUser(cookieHeader, body) {
  const { user: actor, error } = await resolveSession(cookieHeader, CAN_MANAGE_USERS);
  if (error) return error;

  const { email, fullName, username, role, phone,
          assignedStore, assignedStores, assignedMarket,
          assignedDistrict, assignedRegion } = body ?? {};

  if (!email || !fullName || !username || !role) {
    return fail(400, 'email, fullName, username, and role are required');
  }

  // Prevent promoting a user to a role higher than the actor's own role.
  if ((ROLE_RANK[role] ?? -1) > (ROLE_RANK[actor.role] ?? -1)) {
    return fail(403, 'Cannot assign a role higher than your own');
  }

  const pinHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  // Create the Supabase Auth record first; the handle_new_auth_user trigger
  // provisions the basic users row so the FK is satisfied.
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { username, full_name: fullName, pin_hash: pinHash },
  });

  if (authError) {
    const msg = authError.message ?? '';
    if (msg.toLowerCase().includes('already registered') ||
        msg.toLowerCase().includes('already exists')) {
      return fail(409, 'A user with that email already exists');
    }
    console.error('createUser auth error:', msg);
    return fail(500, 'Failed to create user account');
  }

  const newId = authData.user.id;

  // Resolve assignment IDs — accepts either an object { id, ... } or a plain UUID string.
  const resolveId = (v) => (typeof v === 'string' ? v : v?.id ?? null);
  const storeId = resolveId(assignedStore) ?? resolveId(assignedStores?.[0]) ?? null;

  const { data: created, error: updateError } = await supabase
    .from('users')
    .update({
      email,
      username,
      full_name:             fullName,
      role,
      phone:                 phone ?? null,
      pin_hash:              pinHash,
      force_password_change: true,
      is_active:             true,
      store_id:              storeId,
      district_id:           resolveId(assignedDistrict),
      market_id:             resolveId(assignedMarket),
      region_id:             resolveId(assignedRegion),
    })
    .eq('id', newId)
    .select(USER_SELECT)
    .single();

  if (updateError) {
    // Roll back the auth user to avoid orphaned auth records.
    await supabase.auth.admin.deleteUser(newId);
    const msg = updateError.message ?? '';
    if (msg.includes('users_username_key')) {
      return fail(409, 'That username is already taken');
    }
    console.error('createUser update error:', msg);
    return fail(500, 'Failed to configure user record');
  }

  return json(201, { ok: true, user: formatRow(created) });
}

// =============================================================================
// Action: updateUser
// =============================================================================

// Fields the caller is allowed to supply; anything else is silently ignored.
const UPDATABLE_FIELDS = new Set([
  'email', 'username', 'fullName', 'role', 'phone',
  'assignedStore', 'assignedStores', 'assignedMarket', 'assignedDistrict', 'assignedRegion',
]);

async function handleUpdateUser(cookieHeader, body) {
  const { user: actor, error } = await resolveSession(cookieHeader, CAN_MANAGE_USERS);
  if (error) return error;

  const { id, ...fields } = body ?? {};
  if (!id) return fail(400, 'id is required');

  const resolveId = (v) => (typeof v === 'string' ? v : v?.id ?? null);

  const patch = {};

  if ('email'            in fields) patch.email       = fields.email;
  if ('username'         in fields) patch.username    = fields.username;
  if ('fullName'         in fields) patch.full_name   = fields.fullName;
  if ('phone'            in fields) patch.phone       = fields.phone ?? null;

  if ('role' in fields) {
    if ((ROLE_RANK[fields.role] ?? -1) > (ROLE_RANK[actor.role] ?? -1)) {
      return fail(403, 'Cannot assign a role higher than your own');
    }
    patch.role = fields.role;
  }

  if ('assignedStore' in fields || 'assignedStores' in fields) {
    patch.store_id = resolveId(fields.assignedStore)
      ?? resolveId(fields.assignedStores?.[0])
      ?? null;
  }
  if ('assignedDistrict' in fields) patch.district_id = resolveId(fields.assignedDistrict);
  if ('assignedMarket'   in fields) patch.market_id   = resolveId(fields.assignedMarket);
  if ('assignedRegion'   in fields) patch.region_id   = resolveId(fields.assignedRegion);

  if (Object.keys(patch).length === 0) {
    return fail(400, 'No updatable fields provided');
  }

  const { error: dbError } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id);

  if (dbError) {
    const msg = dbError.message ?? '';
    if (msg.includes('users_email_key'))    return fail(409, 'That email is already in use');
    if (msg.includes('users_username_key')) return fail(409, 'That username is already taken');
    console.error('updateUser db error:', msg);
    return fail(500, 'Failed to update user');
  }

  return json(200, { ok: true });
}

// =============================================================================
// Action: updateStatus
// =============================================================================

async function handleUpdateStatus(cookieHeader, body) {
  const { user: actor, error } = await resolveSession(cookieHeader, CAN_MANAGE_USERS);
  if (error) return error;

  const { id, status } = body ?? {};
  if (!id)     return fail(400, 'id is required');
  if (!status) return fail(400, 'status is required');

  const normalized = status.toUpperCase();
  if (normalized !== 'ACTIVE' && normalized !== 'INACTIVE') {
    return fail(400, 'status must be ACTIVE or INACTIVE');
  }

  // Prevent actors from deactivating their own account.
  if (id === actor.id && normalized === 'INACTIVE') {
    return fail(400, 'Cannot deactivate your own account');
  }

  const { error: dbError } = await supabase
    .from('users')
    .update({ is_active: normalized === 'ACTIVE' })
    .eq('id', id);

  if (dbError) {
    console.error('updateStatus db error:', dbError.message);
    return fail(500, 'Failed to update user status');
  }

  return json(200, { ok: true });
}

// =============================================================================
// Action: resetPassword
// =============================================================================

async function handleResetPassword(cookieHeader, body) {
  const { error } = await resolveSession(cookieHeader, CAN_MANAGE_USERS);
  if (error) return error;

  const { id } = body ?? {};
  if (!id) return fail(400, 'id is required');

  const pinHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  const { error: dbError } = await supabase
    .from('users')
    .update({ pin_hash: pinHash, force_password_change: true })
    .eq('id', id);

  if (dbError) {
    console.error('resetPassword db error:', dbError.message);
    return fail(500, 'Failed to reset password');
  }

  return json(200, { ok: true });
}

// =============================================================================
// Main handler
// =============================================================================

export const handler = async (event) => {
  const action      = event.queryStringParameters?.action;
  const cookieHeader = event.headers?.cookie ?? '';
  const method      = event.httpMethod;

  // Parse body once for POST routes.
  let body = null;
  if (method === 'POST') {
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return fail(400, 'Invalid JSON body');
    }
  }

  if (method === 'GET'  && action === 'getUsers')       return handleGetUsers(cookieHeader);
  if (method === 'POST' && action === 'createUser')     return handleCreateUser(cookieHeader, body);
  if (method === 'POST' && action === 'updateUser')     return handleUpdateUser(cookieHeader, body);
  if (method === 'POST' && action === 'updateStatus')   return handleUpdateStatus(cookieHeader, body);
  if (method === 'POST' && action === 'resetPassword')  return handleResetPassword(cookieHeader, body);

  return fail(400, `Unknown action or method: ${method} ${action ?? ''}`);
};
