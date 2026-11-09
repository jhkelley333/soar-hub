# Roster — GM and Leadership

## Where to find it

- Sidebar → **Roster** (`/admin/gm-roster`) — DO, SDO, RVP only
- System Settings → Org Tools → **GM Roster** — VP, COO, Admin

## GM Roster

The GM Roster tracks who is managing each store:
- **Named** — a GM is assigned (`gm_name`, `hire_date`, `placement_date`)
- **Open** — no GM (`projected_gm_name`, `projected_fill_date`, `still_interviewing`)

The `no_gm_credit` flag on `gm_roster` indicates if the store has an active No-GM credit tag.

## No-GM Tags

A No-GM tag is an open GM credit in the Hub. It applies a $880/week labor credit while the store is without a GM.

- **Create**: Employee Actions → No-GM tag → store, reason, start date, optional end date, note
- **End**: Go to the No-GM tag entry → set an end date
- Reasons: GM quit, GM terminated, GM promoted, P7 coverage import, etc.
- If the end date is left blank, the tag is open-ended and the credit runs through today.

## Known roster vs. SDO Update Sheet discrepancy

The GM Roster (Hub) and the SDO 2026 Update Sheet disagree on dozens of stores. The SDO column on the sheet holds market labels, not names. DO names like Robert Finley / Sara Rice may still appear on the sheet even if the Hub is updated.

## Birthday sync

GMs' birthdays are sourced from the SDO 2026 Update Sheet (GMs tab). The birthday sync script (`birthday-sync.js`) maps names from the sheet to profiles and updates the birthday field. The sheet lives at `1pLpW2-GJpV26TTsTiQt2lg3hZ0AUy7EZclYFd8jWk10`.

## My Stores

- Sidebar → **My Stores** (`/my-stores`) — available to GM and above
- Shows store cards with team info, birthday widget, and direct access to store detail
