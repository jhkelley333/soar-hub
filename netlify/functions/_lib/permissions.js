// Centralized capability check for Work Orders v2 (and reusable for
// any other v2 module). Single source of truth for "who can do what."
//
// The flat permission model (locked in design doc §1):
//   - Status lifecycle is operated by anyone scoped to the store —
//     store user, DO, or admin all use the same matrix.
//   - The approval lifecycle is the real gate (DO+ for decisions).
//   - A handful of admin-only knobs remain: email templates, issue
//     library, troubleshooting tips, feature flags.
//
// TODO(v3): sdo / rvp / vp / coo may want an intermediate "escalation"
// tier with reduced powers vs admin (e.g. cannot write off >$10k).
// Adding it = split those role names out of the 'admin' tier mapping
// and add a CAPS entry. One file change.

const TIER = {
  shift_manager: "store",
  gm:            "store",
  do:            "do",
  sdo:           "admin",
  rvp:           "admin",
  vp:            "admin",
  coo:           "admin",
  admin:         "admin",
  // payroll is excluded from v2 entirely.
};

export function tierFor(role) {
  if (!role) return null;
  return TIER[String(role).toLowerCase()] || null;
}

// CAPS: capability → list of tiers allowed. Anything not listed is
// implicitly forbidden. Capabilities not in this map throw — fails
// closed.
const CAPS = {
  // ── Tickets — flat ──
  view_ticket:        ["store", "do", "admin"],
  edit_ticket:        ["store", "do", "admin"],
  transition_status:  ["store", "do", "admin"],
  set_pause_state:    ["store", "do", "admin"],
  assign_vendor:      ["store", "do", "admin"],
  set_eta:            ["store", "do", "admin"],
  set_cost:           ["store", "do", "admin"],
  close_ticket:       ["store", "do", "admin"],
  reopen_ticket:      ["store", "do", "admin"],
  upload_photo:       ["store", "do", "admin"],
  comment:            ["store", "do", "admin"],

  // ── Approval — DO+ only for decisions ──
  request_approval:   ["store", "do", "admin"],
  decide_approval:    ["do", "admin"],

  // ── Admin-only ──
  edit_email_template:["admin"],
  edit_issue_library: ["admin"],
  edit_feature_flag:  ["admin"],
};

export function can(profile, capability) {
  if (!CAPS[capability]) {
    // Unknown capability — fail closed. Surface as 500 server-side
    // (developer error) rather than 403.
    throw new Error(`Unknown capability: ${capability}`);
  }
  const tier = tierFor(profile?.role);
  return !!tier && CAPS[capability].includes(tier);
}

// Convenience for handler entrances: returns a response object if
// the caller lacks the capability, null if they have it.
export function requireCap(profile, capability) {
  if (can(profile, capability)) return null;
  return {
    statusCode: 403,
    body: JSON.stringify({
      ok: false,
      error: "insufficient_capability",
      capability,
    }),
    headers: { "Content-Type": "application/json" },
  };
}

// Activity-feed visibility filter — store and DO see store+all,
// admin sees all. Used when serving getTicketActivities.
export function activityVisibilityForTier(tier) {
  if (tier === "admin") return null; // null = no filter
  return ["store", "all"];
}
