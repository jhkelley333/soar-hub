# SOAR QSR Operations Hub

Centralized operations platform for Sonic Drive-In franchise operations.
Modules: Work Orders, Payroll Action Forms (PAF), Resource Center, My Team, Ranker.

## Stack

- **Frontend** — Vite + React 18 + TypeScript + Tailwind v4
- **Auth + DB** — Supabase (Postgres + Auth + RLS)
- **Hosting** — Netlify (static + functions)
- **Versioning** — GitHub

## Architecture in one paragraph

Authorization is split into two independent dimensions: a single **role**
per user (`shift_manager → gm → do → sdo → rvp → admin`, plus the horizontal
`payroll` role) and zero-or-more **scope** rows that grant access to a
store, district, market, region, or globally. Row Level Security policies in
Postgres enforce visibility — the frontend simply queries Supabase and
trusts the result. See `docs/architecture/0001-roles-and-scopes.md`.

## Getting started

### 1. Provision Supabase

1. Create a project at <https://supabase.com>.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. Run `supabase/seed/seed.sql` for org sample data.
4. In **Authentication → Providers**, enable Email (password + magic link).

### 2. Create users + assign roles/scopes

Invite users from the Supabase dashboard (**Authentication → Users → Add
user**). The `on_auth_user_created` trigger creates a matching `profiles`
row automatically. Then assign role + scope using the SQL templates at
the bottom of `supabase/seed/seed.sql`.

### 3. Run locally

```bash
npm install
cp .env.example .env
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from your Supabase
# project's API settings
npm run dev
```

Open <http://localhost:5173>.

### 4. Deploy to Netlify

1. Connect this repo in Netlify.
2. Set environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Build settings come from `netlify.toml` — no extra config needed.

## Repo layout

```
soar-hub/
├── docs/architecture/         # ADRs (decisions, not status reports)
├── netlify/functions/         # Server-only work (webhooks, integrations)
├── public/                    # Static assets
├── src/
│   ├── app/                   # Routing, layout shell, navigation config
│   ├── auth/                  # Supabase Auth provider + login
│   ├── lib/                   # Supabase client, query client, helpers
│   ├── modules/               # Feature-first: each module owns its UI/logic
│   │   ├── dashboard/
│   │   ├── work-orders/
│   │   ├── paf/
│   │   ├── resources/
│   │   ├── team/
│   │   └── ranker/
│   ├── shared/ui/             # Design system primitives
│   ├── styles/                # Tailwind entry + design tokens
│   └── types/                 # Shared TypeScript types
└── supabase/
    ├── migrations/            # Versioned SQL — every change is a migration
    └── seed/                  # Sample org data
```

## Phase plan

- **Phase 1 — Foundation (this branch)**: Auth, RBAC + RLS, app shell,
  module scaffolding, design system.
- **Phase 2 — Functionality**: Work Order lifecycle, PAF submission/approval,
  Resource library, Team directory, notifications.
- **Phase 3 — Optimization**: Ranker analytics, automation, reporting,
  performance tuning.
