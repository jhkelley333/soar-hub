// Shared loader for the Google service-account credentials.
//
// The full service-account JSON is ~2.3KB, which alone nearly exhausts AWS
// Lambda's 4KB env-var limit (Netlify functions run in Lambda-compat mode and
// inject every env var into every function). So instead of carrying it in the
// function env, we keep it in the service-only `app_secrets` table and read it
// here, cached per warm container. Falls back to the legacy
// GOOGLE_SERVICE_ACCOUNT_JSON env var for local dev / transition.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET_KEY = "google_service_account";

let cached = null; // parsed credentials, reused across warm invocations

export async function getGoogleCredentials() {
  if (cached) return cached;

  // Preferred source: the DB-stored secret (keeps it out of the function env).
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await supa
        .from("app_secrets")
        .select("value")
        .eq("key", SECRET_KEY)
        .maybeSingle();
      if (data?.value) {
        cached = JSON.parse(data.value);
        return cached;
      }
    } catch {
      /* fall through to the env fallback */
    }
  }

  // Fallback: legacy env var (local dev, or before the DB secret is seeded).
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    cached = JSON.parse(raw);
    return cached;
  }

  throw new Error(
    "Google credentials not configured (set app_secrets.google_service_account or GOOGLE_SERVICE_ACCOUNT_JSON).",
  );
}
