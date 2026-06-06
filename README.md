# SOAR QSR Operations Hub

Centralized operations platform for Sonic Drive-In franchise operations —
one signed-in home for field leaders and the back office.

**Modules:** Dashboard · Work Orders · Chat · Ranker · Labor · Cash
Management · Workspaces · Reno Scoping · Walkthroughs (My Walks +
review/assignments/templates) · PAF (Payroll Action Forms) · Employee
Actions · Contacts · Resources · My Team · My Stores · plus admin tooling
(Org Admin, Feature Flags, Role Access, PAF Config, Labor Sync, Bulk
Attributes).

## Stack

- **Frontend** — Vite 5 + React 18 + TypeScript 5.6 + Tailwind v4
- **Data layer** — TanStack Query over Supabase
- **Auth + DB** — Supabase (Postgres + Auth + RLS + Storage)
- **Hosting** — Netlify (static + serverless functions + scheduled functions)
- **Email** — Resend (transactional notifications)
- **Push / PWA** — hand-rolled service worker + web-push (VAPID)
- **Automation** — GitHub Actions (CI + scheduled labor pull)
- **Versioning** — GitHub

## Architecture in one paragraph

Authorization is split into two independent dimensions: a single **role**
per user and zero-or-more **scope** rows that grant access to a store,
district, market, region, or globally. The vertical management ladder runs
`crew_member → crew_leader → associate_manager → first_assistant_manager →
shift_manager → gm → do → sdo → rvp → vp → coo → admin` (`carhop` is an
hourly store role alongside crew). Alongside it sit **horizontal** roles
that don't slot into the ladder — `payroll`, `accounting`, `facilities`,
and `human_resources` — each a focused, single-purpose persona. Row Level
Security policies in Postgres enforce visibility; the frontend simply
queries Supabase (or a service-role-backed Netlify function) and trusts the
result. See `docs/architecture/0001-roles-and-scopes.md`.

## Docs

- **`docs/ENV.md`** — every environment variable, where it's set, and
  whether it's required. Mirror of `.env.example` with full notes.
- **`docs/MIGRATIONS.md`** — migration conventions + the
  `schema_migrations` tracking table / `npm run check:migrations` guard.
- **`docs/cash-management-guide.md`** — Cash Management user guide
  (night close → next-day deposit validation cycle).
- **`docs/architecture/`** — ADRs (decisions, not status reports).

## Getting started

### 1. Provision Supabase

1. Create a project at <https://supabase.com>.
2. In the SQL editor, run the migrations in `supabase/migrations/` in order
   (`0001_init.sql` first). See `docs/MIGRATIONS.md` for the conventions.
3. Run `supabase/seed/seed.sql` for org sample data.
4. In **Authentication → Providers**, enable Email (password + magic link).

### 2. Create users + assign roles/scopes

Invite users from the Supabase dashboard (**Authentication → Users → Add
user**). The `on_auth_user_created` trigger creates a matching `profiles`
row automatically. Then assign role + scope using the SQL templates at
the bottom of `supabase/seed/seed.sql`, or manage them in-app via
**Org Admin** and **Role Access** (admin only).

### 3. Run locally

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase
# project's API settings (see docs/ENV.md for the rest)
npm run dev
```

Open <http://localhost:5173>.

### 4. Quality gates

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint 9 (flat config)
npm run check:migrations  # every migration self-records in schema_migrations
npm run build             # production build
```

CI (`.github/workflows/ci.yml`) runs all four on every PR and on pushes to
`main`.

### 5. Deploy to Netlify

1. Connect this repo in Netlify.
2. Set environment variables (see `docs/ENV.md`). At minimum:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `RESEND_API_KEY` for email.
3. Build settings come from `netlify.toml` — no extra config needed.

## Repo layout

```
soar-hub/
├── .github/workflows/          # CI + scheduled labor auto-pull
├── docs/                       # ENV, MIGRATIONS, guides, architecture ADRs
├── netlify/functions/          # Server-only work (service-role bridge,
│                               #   webhooks, integrations, scheduled jobs)
├── public/                     # Static assets + PWA (manifest, sw.js)
├── scripts/                    # check-migrations.mjs + maintenance scripts
├── src/
│   ├── app/                    # Routing, layout shell, navigation config
│   ├── auth/                   # Supabase Auth provider + login
│   ├── lib/                    # Supabase client, query client, helpers
│   ├── modules/                # Feature-first: each module owns its UI/logic
│   │   ├── dashboard/          #   home + mobile home + quick actions
│   │   ├── work-orders-v2/     #   primary facilities ticketing flow
│   │   ├── chat/               #   messaging
│   │   ├── ranker/             #   store performance analytics (DO+)
│   │   ├── labor/              #   daily labor review vs chart
│   │   ├── cash-management/    #   night close → deposit validation cycle
│   │   ├── workspaces/         #   workspaces + assignments / sign-offs / CAPs
│   │   ├── reno-scoping/       #   pre-reskin scoping (2026 Full-to-Bright)
│   │   ├── walkthrough/        #   store walkthroughs (My Walks + review hub)
│   │   ├── paf/                #   Payroll Action Forms
│   │   ├── employee-actions/   #   training credit + PTO requests
│   │   ├── contacts/           #   directory
│   │   ├── resources/          #   resource / document library
│   │   ├── team/               #   My Team directory
│   │   ├── my-stores/          #   store rollup + birthdays
│   │   ├── admin/              #   org admin, feature flags, role access, etc.
│   │   └── …                   #   (region, public-submit, vendor-portal, …)
│   ├── shared/ui/              # Design system primitives
│   ├── styles/                 # Tailwind entry + design tokens
│   └── types/                  # Shared TypeScript types
└── supabase/
    ├── migrations/             # Versioned SQL — every change is a migration
    └── seed/                   # Sample org data
```

## Conventions

- **Every schema change is a numbered migration** in `supabase/migrations/`.
  Render the SQL inline when proposing one, and make it self-record in
  `schema_migrations`. See `docs/MIGRATIONS.md`.
- **Server-only secrets never get a `VITE_` prefix** — that prefix bakes a
  value into the browser bundle. Service-role work happens in Netlify
  functions.
- **Feature flags** (`/admin/feature-flags`) widen access to a module for
  hand-picked pilot testers without editing the role allowlist in
  `src/app/nav.ts` (e.g. `paf_pilot`, `cash_management_pilot`).
- **Money is stored and computed in integer cents**, formatted only at the
  edges.
