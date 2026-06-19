# Module guide — how a feature is built in SOAR Hub

This is the working spec for adding (or extending) a module. It captures the
conventions the codebase already follows so a new module — like the next one
coming out of design — drops into place without reinventing plumbing. Read it
alongside `docs/ENV.md` (env vars) and `docs/MIGRATIONS.md` (schema changes).

> TL;DR: a module is a folder under `src/modules/<name>/`, a single Netlify
> function under `netlify/functions/<name>.js` that acts as a service-role
> bridge, optionally a numbered migration under `supabase/migrations/`, and
> two registrations (a nav row + a route). Authorization is **role × scope**,
> enforced in the function. Money is integer cents.

---

## 1. Anatomy of a module

```
src/modules/<name>/
├── <Name>Route.tsx     # desktop/mobile split shell (optional)
├── <Name>Page.tsx      # the desktop page (header, tabs, content)
├── mobile/             # mobile-specific shell + tabs (if it has one)
├── api.ts              # typed wrappers around the Netlify function
├── types.ts            # request/response + row types for this module
├── <Name>GuideDrawer.tsx   # in-app user guide (see §7)
└── …Tab.tsx / …Drawer.tsx / …Modal.tsx  # feature components
```

Keep modules **feature-first and self-contained**: a module owns its UI, its
api wrapper, and its types. Cross-module reuse goes through `src/shared/ui`
(design-system primitives) and `src/lib` (supabase client, query client,
flags, helpers) — not by importing one module's internals into another.

## 2. Frontend ↔ backend: the api.ts pattern

Every module talks to exactly one Netlify function through a thin typed
`api.ts`. The shape is consistent across modules (see
`src/modules/cash-management/api.ts`):

```ts
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/<name>";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers ?? {}) } });
  if (!res.ok) { /* parse { error } from body, throw Error(message) */ }
  return res.json() as Promise<T>;
}
```

- The request carries the user's **Supabase JWT** as a bearer token — never a
  service-role key (that lives only on the server).
- Actions are dispatched by an `?action=` query param (`overview`, `config`,
  `submit-closeout`, …). GET for reads, POST for writes.
- Components call these wrappers through **TanStack Query** (`useQuery` /
  `useMutation`), keyed `["<module>", …]`, with sensible `staleTime`.

## 3. The Netlify function: a service-role bridge

Each module's backend (`netlify/functions/<name>.js`) follows the same auth +
scoping contract as `cash-management.js` / `paf.js` / `facilities-v2.js`:

1. **Validate** the incoming JWT using the service-role key.
2. **Look up** the caller's profile (role + scopes).
3. **Gate every action** on role and visible-store scope — define
   role sets at the top (e.g. `const CLOSEOUT_ROLES = new Set([...])`) and
   check them per action. Never trust the client.
4. Use the **service-role client** only after auth passes:

```js
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Scope visibility comes from the `user_visible_stores` / `manageable_users`
RPCs — filter queries to what the caller can actually see. Write an audit-log
row for every state change (the Cash and PAF modules both keep an
`*_audit_log` table).

> **Internal/scheduled functions** (no user JWT — cron jobs, sweeps) are the
> exception. They should be guarded by a shared secret (`CRON_SECRET`, see
> `docs/ENV.md`) rather than role checks. This is a known open item.

## 4. Authorization: role × scope

Two independent dimensions (see `docs/architecture/0001-roles-and-scopes.md`):

- **Role** — one per user. Vertical ladder
  `crew_member → crew_leader → associate_manager → first_assistant_manager →
  shift_manager → gm → do → sdo → rvp → vp → coo → admin` plus horizontal
  personas `payroll`, `accounting`, `facilities`, `human_resources` that don't
  slot into the ladder.
- **Scope** — zero-or-more rows granting store / district / market / region /
  global visibility.

Enforced **server-side**: the function gates on role and filters by scope. The
frontend nav/route guards are a UX courtesy (hide dead links), not the
security boundary. RLS backs the tables that the frontend queries directly.

## 5. Registering the module

Two edits make a module reachable:

1. **`src/app/nav.ts`** — add a `NavItem` to the `NAV` array:
   ```ts
   { to: "/<path>", label: "…", icon: SomeIcon, roles: ["gm", "do", …] },
   ```
   `roles: null` means "everyone signed in." An optional `flagKey` widens
   visibility to feature-flag testers (see §6).

2. **`src/app/router.tsx`** — add the route, wrapped in a guard:
   ```tsx
   <ProtectedRoute requireRoles={["gm", "do", …]}>
     <ThePage />
   </ProtectedRoute>
   ```
   Both `ProtectedRoute` and `FlagOrRoleRoute` also honor **Role Access
   overrides** (`/admin/role-access`), which let an admin grant/revoke a
   role's access to a module without a code change. Keep the route's role list
   in sync with the nav row.

## 6. Feature flags (pilots)

To pilot a module with hand-picked testers before opening it to a full role
set, add a `flagKey` to the nav row and use `FlagOrRoleRoute` (instead of
`ProtectedRoute`) on the route — access is granted if the role matches **or**
the flag is ON for that user. Admins manage per-user flags at
`/admin/feature-flags`.

When the module ships to its full role set, **retire the flag**: switch the
route back to `ProtectedRoute`, drop the `flagKey` from the nav row. (`PAF`
still uses `paf_pilot`; the `cash_management_pilot` flag was retired this way.)

## 7. In-app user guide

Every user-facing module ships a guide so the reference lives where the team
works. The pattern is a `<Name>GuideDrawer.tsx` (a `@/shared/ui/Drawer` with
plain styled `H`/`P`/`Li` helpers — no Markdown dependency) opened by a
**Guide** button (`HelpCircle` icon) in the page header. See
`PafGuideDrawer.tsx`, `CashGuideDrawer.tsx`, `WorkOrdersGuideDrawer.tsx`.

## 8. Schema changes

Every schema change is a **numbered migration** in `supabase/migrations/`.
Full conventions are in `docs/MIGRATIONS.md`; the essentials:

- Sequential prefix; render the SQL inline when proposing one; make it
  **self-record** in `schema_migrations` (CI's `npm run check:migrations`
  enforces this for prefixes ≥ 135).
- `ALTER TYPE … ADD VALUE` can't run in the same transaction that uses the new
  value — split it. Use `IF NOT EXISTS` for enum additions.
- For service-role-only tables, enable RLS with **no policies** (the function
  is the only writer).
- End reload-sensitive migrations with `notify pgrst, 'reload schema';`.
- Always confirm you're on the **Soar Hub v2** Supabase project before running
  SQL.

## 9. Email (Resend)

Outbound notifications go through Resend from within the function. Defaults
come from the `RESEND_*` env vars; a module can override the sender with a
per-module From name (`PAF_FROM_NAME`, `CASH_FROM_NAME`, …) — see
`docs/ENV.md`. Email is best-effort: if `RESEND_API_KEY` is unset the send is
a logged no-op and the user-facing action still succeeds.

## 10. Mobile / PWA

The app is an installable PWA. Modules with a heavy mobile workflow split into
a desktop page and a mobile shell behind a `<Name>Route.tsx` (using
`useIsDesktop()`), giving the mobile view a bottom-nav + sticky-action layout
that feels native — without touching the desktop layout. Lighter modules just
use responsive Tailwind. Keep admin/settings surfaces off the mobile shell.

## 11. Conventions checklist

- [ ] Money and other currency values are **integer cents** end-to-end;
      format only at the edges.
- [ ] Server-only secrets never carry a `VITE_` prefix.
- [ ] Every state change writes an audit-log row.
- [ ] Nav row + route guard share the same role list.
- [ ] `npm run typecheck && npm run lint && npm run check:migrations &&
      npm run build` pass (CI runs all four).
- [ ] A user-facing module has an in-app Guide drawer.
