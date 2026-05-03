// netlify/functions/auth-resolve.js
//
// Public phone-to-email resolver for dual-identifier login.
//
// Why this exists:
//   Supabase email/password auth keys off auth.users.email — one identifier
//   per row. To let the same user sign in with EITHER their real email OR a
//   phone number on file, the React login form does:
//
//     1. User types into "Phone or email" + password.
//     2. If contains "@", call supabase.auth.signInWithPassword directly.
//     3. If digits, call this function to translate phone -> canonical email.
//     4. Then call supabase.auth.signInWithPassword with that email.
//
// The actual password check happens at step 4 (Supabase). This function only
// answers "is there a profile with this phone, and if so what email do I sign
// in with?" — without ever exposing whether a password is valid.
//
// Security notes:
//   - This endpoint is intentionally PUBLIC (no JWT required) because it has
//     to work pre-login. The information it returns (an email associated
//     with a phone) is roughly equivalent to what an attacker can already
//     learn by typing emails at the login screen and watching error
//     messages.
//   - To keep the disclosure tight, we only respond when the input is a
//     well-formed 10-digit phone, the profile exists, and is_active=true.
//     Otherwise we return 404 with a generic message.
//   - Service role key is server-only. The query is constrained to
//     `select email, is_active from profiles where phone = ?` — nothing
//     else.
//
// Required env vars:
//   VITE_SUPABASE_URL              (or SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const trimmed =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return trimmed.length === 10 ? trimmed : null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (event.httpMethod !== "GET") {
    return respond(405, { error: "method not allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return respond(500, { error: "auth-resolve not configured" });
  }

  const phone = normalizePhone(event.queryStringParameters?.phone);
  if (!phone) return respond(400, { error: "invalid phone" });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supa
    .from("profiles")
    .select("email, is_active")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    return respond(500, { error: "lookup failed" });
  }
  if (!data || !data.is_active) {
    // Don't differentiate "no such phone" from "deactivated profile" — both
    // present the same generic message to the user at the login screen.
    return respond(404, { error: "not found" });
  }
  return respond(200, { email: data.email });
};
