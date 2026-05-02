# ADR 0001 — Roles and Scopes

## Decision

Authorization in SOAR Hub is split into two independent dimensions:

1. **Role** — *what* a user can do (a single value per user).
2. **Scope** — *where* they can do it (zero-or-more rows in `user_scopes`).

This is enforced at the database via Row Level Security. Application code
does not perform role checks for data access; it queries Postgres and trusts
the result.

## Roles

Hierarchy roles, ordered low → high (`role_level()` returns the numeric tier):

| role            | level | typical scope         |
| --------------- | ----- | --------------------- |
| `shift_manager` | 10    | one store             |
| `gm`            | 20    | one store             |
| `do`            | 30    | one or more districts |
| `sdo`           | 40    | one or more markets   |
| `rvp`           | 50    | one or more regions   |
| `admin`         | 100   | global                |

Horizontal role (excluded from numeric hierarchy):

| role      | level  | scope                                           |
| --------- | ------ | ----------------------------------------------- |
| `payroll` | `null` | global read+write on PAF data; cross-org reads  |

`payroll` users *process* Payroll Action Forms in the application. They need
read+write access to PAFs across every store, plus read access to employee
profiles. They are NOT in the operational chain of command — a payroll user
cannot, e.g., approve a work order or override a DO's decision.

## Scopes

`user_scopes(user_id, scope_type, scope_id)`:

- `scope_type='global'` — sees everything (admin, payroll)
- `scope_type='region'` — every store under a region
- `scope_type='market'` — every store under a market
- `scope_type='district'` — every store in a district
- `scope_type='store'` — exactly one store

A user can have multiple rows. A DO running 8 stores in two adjacent
districts can be modeled as two `district` rows OR eight `store` rows
depending on org reality. Both work; pick whichever matches the source of
truth so it stays in sync.

## RLS pattern

For any module table that references a `store_id`:

```sql
alter table <module> enable row level security;
create policy <module>_select on <module> for select
  using (can_see_store(store_id));
```

For PAF specifically, payroll gets an additional unconditional policy:

```sql
create policy paf_payroll_all on paf for all
  using (is_payroll() or can_see_store(store_id))
  with check (is_payroll() or can_see_store(store_id));
```

## Why this is durable

- Adding a new region or store requires **zero policy changes**.
- Adding a new role requires editing one enum + one `role_level()` case.
- Promoting a DO to SDO is one `update profiles set role='sdo'` + scope row
  changes — no app code change.
- Audit is built in: who can see what is answerable by querying
  `user_visible_stores(user_id)`.
