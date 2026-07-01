// Shared "View As" resolution — admin read-only debugging mode.
// See netlify/functions/admin-view-as.js for session start/end + the audit
// table, and src/lib/viewAs.ts for the client-side half.
//
// Every function that wants its "read as the target user" behavior to
// participate in View As should call resolveViewAs() once, right after it
// resolves the REAL caller's profile, then:
//   - use `effective` (not the real profile) for whatever "my ___" /
//     visibility scoping that function does on reads
//   - keep using the REAL profile for permission checks, write attribution,
//     and activity/audit logging — View As never changes who's ACTUALLY
//     allowed to do what, only whose data a read is scoped to
//   - call rejectWriteWhileViewingAs(event) at the top of the handler so
//     every mutating action is blocked while a session is active,
//     independent of anything the UI does or doesn't disable. Since every
//     write in this codebase's Netlify functions is a POST, this one check
//     covers all of them.
//
// Centralized here (rather than duplicated per-function) specifically
// because this is a security-relevant check: a bug in even one duplicated
// copy could let a non-admin spoof another identity. One implementation,
// reused everywhere, is auditable once.

const VIEW_AS_HEADER = "x-view-as-user-id";

function headerValue(event) {
  return event.headers?.[VIEW_AS_HEADER] || event.headers?.["X-View-As-User-Id"] || null;
}

// Call at the very top of a handler, before doing any work. Every mutating
// action in this codebase's Netlify functions is a POST, so this single
// check makes View As structurally read-only server-side.
export function rejectWriteWhileViewingAs(event) {
  if (headerValue(event) && event.httpMethod === "POST") {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Read-only while viewing as another user — exit View As to make changes.", message: "Read-only while viewing as another user — exit View As to make changes." }),
    };
  }
  return null;
}

// Returns { effective, viewingAs }. `effective` is realProfile unless the
// caller is a real admin AND the request carries a valid, active target's
// id — in which case it's that target's profile. Never trust the header
// alone: role is re-checked from `realProfile` (already resolved from the
// verified JWT by the caller), and the target is re-fetched from the DB
// rather than trusting anything the client claims about it.
export async function resolveViewAs(supabase, realProfile, event) {
  const targetId = headerValue(event);
  if (!targetId || String(realProfile?.role || "").toLowerCase() !== "admin") {
    return { effective: realProfile, viewingAs: false };
  }
  const { data: target } = await supabase
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", targetId)
    .eq("is_active", true)
    .maybeSingle();
  if (!target) return { effective: realProfile, viewingAs: false };
  return { effective: target, viewingAs: true };
}
