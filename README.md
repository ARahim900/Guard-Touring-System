# MB Patrol: Muscat Bay Security Patrol System

A security patrol system for Muscat Bay, built in one release. It has three parts:

| Part | What it is | Technology | Where it runs |
|---|---|---|---|
| **Guard app** | Guards scan checkpoints, report issues, raise SOS | Expo SDK 57 (React Native), TypeScript | iPhone and Android (EAS Build) |
| **Supervisor portal** | Manage guards, checkpoints, routes and schedules; live map; alarms; monthly PDF reports | React 19, Vite, TypeScript, Tailwind CSS 4 | Netlify |
| **Backend** | Logins, database, security rules, photo storage, scheduled checks | Supabase (Auth, Postgres + RLS, Storage, Edge Functions, pg_cron) | Supabase project `zdezuylsruzbddqcdhog` |

## Start here

1. **[Installation, step by step](docs/01-installation.md)**: from a clean computer to a working system.
2. **[How it works](docs/02-how-it-works.md)**: the design explained from first principles (security, offline sync, scan validation).
3. **[iPhone and Android release checklist](docs/03-store-submission-checklist.md)**.
4. **[Privacy policy](docs/privacy-policy.md)**: complete the items in [square brackets] before release.

## Folder structure

```
Patrolling_Tour_System/
├── README.md                     ← you are here
├── docs/                         ← installation, design, store checklist, privacy policy
├── brand/                        ← official logo + script that generates every icon from it
├── supabase/
│   ├── migrations/               ← the database, applied in order
│   │   ├── …0100_core_schema.sql              tables
│   │   ├── …0200_auth_helpers_and_rls.sql     who can see/change what (RLS)
│   │   ├── …0300_patrol_functions.sql         scan validation, shift start/end, SOS, statistics
│   │   ├── …0400_storage.sql                  private photo/voice bucket + rules
│   │   └── …0500_monitoring_reports_realtime.sql  5-minute monitor, reports, live map
│   ├── functions/admin-users/    ← Edge Function: create logins, reset passwords, disable accounts
│   └── bootstrap_first_admin.sql ← run once to make yourself admin
└── apps/
    ├── guard/                    ← Expo mobile app
    │   ├── app.config.ts         ← app name, permissions text, plugins
    │   ├── eas.json              ← EAS Build profiles
    │   └── src/
    │       ├── app/              ← screens (file name = route)
    │       │   ├── (tabs)/       ← Work · Statistic · [+] · Histories · Personal
    │       │   ├── scan/         ← scanner and report screens
    │       │   ├── login.tsx, privacy.tsx
    │       ├── offline/          ← SQLite outbox + sync engine
    │       ├── services/         ← location, NFC, photos
    │       ├── tasks/            ← background location task
    │       ├── context/          ← login, shift, toasts
    │       ├── components/       ← UI building blocks, SOS button, voice recorder
    │       └── lib/              ← Supabase client, brand theme, helpers
    └── portal/                   ← supervisor website
        ├── netlify.toml          ← build + security headers
        └── src/
            ├── pages/            ← Dashboard, Live map, Alarms, Incidents, Scans,
            │                       Schedules, Routes, Checkpoints, Guards, Reports
            ├── components/       ← layout, maps, scan evidence viewer, UI kit
            ├── context/          ← login, live alarms (Realtime)
            └── lib/              ← Supabase client, PDF report, helpers
```

## Security: read this first

- **The secret key (`sb_secret_…`, formerly `service_role`) must never be in any app, file or Git commit.** It bypasses every security rule. It lives only inside Supabase, where the Edge Function reads it automatically.
- The legacy `service_role` key was shared in a chat message while this was being built. The fix is to switch the legacy keys off; the apps use the new **publishable** key and the Edge Function uses the new **secret** key. See [installation step 2.6](docs/01-installation.md#26-rotate-the-leaked-service_role-key).
- The publishable key in the apps is public by design. Security comes from Row Level Security in the database, which is enabled on every table.

## What has been tested

Every push and pull request runs the automated checks in `.github/workflows/ci.yml`: database and report tests, portal type-check, build and dependency audit, and the guard app type-check. Database changes are made only through `supabase/migrations/`; apply them in order and never paste older SQL over a newer function.

- All five SQL migrations were applied to a local PostgreSQL server and tested:
  - RLS isolation: one guard cannot see another guard's data.
  - A guard cannot promote themselves to admin.
  - Scan validation: distance, mocked GPS, wrong tag, clock drift and idempotent retries.
  - Gallery photo dating, storage folder rules, statistics, the monthly patrol report, the 5-minute monitor and route-change protection.
- The guard app type-checks with zero errors. Its JavaScript bundle builds for Android and iOS.
- The portal type-checks, builds for production, and its login and privacy pages render with no browser errors.
- Three independent review agents then audited the database, the guard app and the portal. They confirmed 26 defects, all fixed and re-tested: 7 in the database, 10 in the guard app and 9 in the portal.
- **Not yet tested:** running against your live Supabase project, and on real phones. This container could not reach the project. NFC, GPS and background tracking can only be proven on physical devices.
