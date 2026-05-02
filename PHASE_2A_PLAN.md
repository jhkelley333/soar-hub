# Phase 2a Plan — Work Orders Module

This document captures the agreed plan for SOAR Hub Phase 2a, carried
forward from the planning session that preceded implementation. All
six default decisions are locked in (see "Locked defaults" below) so
the next session — or a future maintainer — can pick this up without
re-litigating scope.

## Locked defaults

- **Attachments storage** — Supabase Storage (not Smartsheet, not Drive).
  Tickets stay on Smartsheet; new photos and quotes are uploaded to a
  Supabase Storage bucket and the resulting public URL is written into
  the Smartsheet "Quote URL" column (or notes field as fallback).
- **Vendors tab** — Included. Sourced from a Google Sheet via a Netlify
  Function that uses `GOOGLE_SERVICE_ACCOUNT_JSON` to authenticate.
- **Videos tab** — Included. Sourced from a Google Drive folder via the
  same service account.
- **Static info tabs** — Included. Solugenix, Coke, and RF Tech each get
  a static-content tab (vendor contact info, escalation notes).
- **Store list** — Derived from the authenticated user's `user_scopes`
  rows in the Supabase auth helper. The Netlify Function trusts the
  scope claims after JWT validation; no additional client-side filter.
- **Smartsheet linkage** — The Smartsheet "Store Number" column matches
  `stores.number` in Supabase 1:1.
- **Seed data** — Keep placeholder/sample data for now. Real org data
  (stores, users, scopes) lands in a later phase.

## Step 1 — Repaint to Sonic palette

Update design tokens in `src/styles/globals.css`:

| Token                 | Hex       | Role                               |
|-----------------------|-----------|------------------------------------|
| `--color-accent`      | `#008AD8` | Sky — replaces zinc-900 as primary |
| `--color-accent-hover`| tint of Sky | hover state                      |
| `--color-accent-fg`   | `#FFFFFF` | foreground on accent surfaces      |
| `--color-frost`       | `#74D2E7` | hover/focus accents                |
| `--color-midnight`    | `#285780` | headers, structural ink            |
| `--color-cherry`      | `#E40046` | destructive, CTAs, sign-in         |

Surface stays white-on-light; ink stays near-black for readability.
Primitives:
- `Button` primary → Sky; danger → Cherry.
- Headings → Midnight.
- Login button → Cherry (sign-in is the most important conversion CTA).

Result: same minimalist structure, fully Sonic-branded.

## Step 2 — Build Phase 2a Work Orders

Port the existing vanilla-JS Work Orders UI to React, using the SOAR
Hub primitives (`Button`, `Card`, `Badge`, `Input`, `Label`,
`PageHeader`, `EmptyState`, `Skeleton`).

The Netlify Function backend continues to broker the same external
calls — Smartsheet for tickets, Google Sheets for vendors, Google
Drive for videos. The change in this phase is **auth**: the function
must validate a Supabase JWT using `@supabase/supabase-js` server-side
with the service-role key, instead of the legacy `soar_session`
cookie. The frontend calls the function with
`Authorization: Bearer <supabase_access_token>`.

Tabs in the module:
1. **List** — open / in-progress / completed work orders for the user's
   scoped stores.
2. **Detail** — single ticket view with status, assignee, history.
3. **Edit / New** — create or update a ticket.
4. **Photo upload** — attach photos and quotes via Supabase Storage;
   write the resulting URL back to the Smartsheet row.
5. **Vendors** — pulled from Google Sheet.
6. **Videos** — pulled from Google Drive.
7. **Solugenix / Coke / RF Tech** — static info tabs.

## Step 3 — Approval flow stays loose

Smartsheet's existing automation continues to fire alerts to approvers.
Phase 2a does **not** build an approval queue; that belongs to
Facilities 2.

## Auth bridging detail

In `netlify/functions/work-orders.js`:

- Replace `getSessionUser` with a function that:
  1. Reads `Authorization: Bearer <token>` from the request header.
  2. Calls `supabase.auth.getUser(token)` using a server-side client
     constructed with `SUPABASE_SERVICE_ROLE_KEY`.
  3. Looks up the user's `role` from `profiles` and `scope` rows from
     `user_scopes`.
  4. Returns `{ id, email, role, scopes }` or a 401.
- All downstream Smartsheet / Sheets / Drive calls stay the same.

## Environment variables (set in Netlify dashboard)

- `VITE_SUPABASE_URL` — frontend Supabase URL.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side Supabase key (functions
  only, never exposed to the browser).
- `SMARTSHEET_TOKEN` — Smartsheet API token.
- `SMARTSHEET_SHEET_ID` — work-orders sheet ID.
- `VENDOR_SHEET_ID` — Google Sheet ID for the vendor list.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service account credentials for
  Sheets + Drive.

## Commit plan

1. **docs: add Phase 2a plan** — this file.
2. **feat(theme): repaint design tokens to Sonic palette** — globals.css
   plus any primitive updates that depend on the new tokens.
3. **feat(functions): work-orders.js with Supabase JWT auth bridge** —
   server-side validation, Smartsheet + Sheets + Drive glue, Supabase
   Storage upload helper.
4. **feat(work-orders): React module with all tabs** — list, detail,
   edit, photo upload, vendors, videos, static info tabs.

Each commit is pushed manually by the human operator between steps to
work around a broken push pipe in the development harness.
