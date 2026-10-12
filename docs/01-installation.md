# 1. Installation: from a clean computer to a working system

Follow the parts in order. Each step says **what** to do and **why**. Commands go in a terminal: **Terminal** on macOS, or **PowerShell** on Windows.

| Part | Result | Time |
|---|---|---|
| 1. Tools | Node.js, Git, an editor | 15 min |
| 2. Backend (Supabase) | Database, security rules, storage, Edge Function, first admin | 30 min |
| 3. Supervisor portal | Running locally, then live on Netlify | 30 min |
| 4. Guard app | Development build on your phone, then store builds | 1–2 h |
| 5. Field set-up | Checkpoints, labels, NFC tags, first patrol test | half a day on site |

---

## Part 1: Tools

### 1.1 Install Node.js 22 LTS
Node.js runs the build tools for both apps.
- Download the **LTS** installer from https://nodejs.org and install it with the default options.
- Check it worked:
  ```bash
  node -v   # should print v22.x or later
  npm -v
  ```

### 1.2 Install Git and get the code
```bash
git --version            # if missing, install from https://git-scm.com
git clone https://github.com/ARahim900/Patrolling_Tour_System.git
cd Patrolling_Tour_System
```

### 1.3 Editor
Install **Visual Studio Code** (https://code.visualstudio.com). Open the `Patrolling_Tour_System` folder in it.

---

## Part 2: Backend (Supabase)

> **Status on 12 Oct 2026:** steps 2.2 and 2.3 are already done on project `zdezuylsruzbddqcdhog`, installed through the Claude connector and checked against the tested local copy.
> - **Database:** all 13 tables, the security rules, the private storage bucket, realtime, the reports and the live-map view are installed. Migrations 06 (guard on duty, for the shared login) and 07 (daily patrol log) are installed too.
> - **Edge Function:** `admin-users` is deployed.
>
> **Also done:** step 2.1 (public sign-up is off) and step 2.6 (leaked key revoked).
>
> **Still to do:** step 2.4 (first admin).

Your project reference is **`zdezuylsruzbddqcdhog`**. Its URL is `https://zdezuylsruzbddqcdhog.supabase.co`.

### 2.1 Turn off public sign-up
Why: accounts are created only by supervisors. Nobody should be able to register themselves.

Supabase Dashboard → **Authentication** → **Sign In / Providers** → switch **off** "Allow new users to sign up". Keep **Email** enabled as a provider.

### 2.2 Create the database (migrations)
A "migration" is a SQL file that changes the database. The seven files in `supabase/migrations/` build everything, and they must run **in order**.

**Option A: Supabase CLI (recommended, repeatable)**
```bash
# from the Patrolling_Tour_System folder
npx supabase login                                   # opens the browser once
npx supabase init                                    # creates supabase/config.toml; answer "N" to the editor questions
npx supabase link --project-ref zdezuylsruzbddqcdhog # asks for your DATABASE password (Dashboard → Project Settings → Database)
npx supabase db push                                 # applies the 7 migrations in order
```

**Option B: SQL Editor (no command line)**
Dashboard → **SQL Editor** → **New query**. Paste the whole content of each file and press **Run**, one file at a time, in this order:
1. `20261012000100_core_schema.sql`
2. `20261012000200_auth_helpers_and_rls.sql`
3. `20261012000300_patrol_functions.sql`
4. `20261012000400_storage.sql`
5. `20261012000500_monitoring_reports_realtime.sql`
6. `20261012000600_guard_on_duty.sql`
7. `20261012000700_daily_patrol_log.sql`

Check it worked:
- **Table Editor**: 13 tables. Each one shows **RLS enabled**.
- **Storage**: a bucket called **patrol-media**, marked **Private**.
- **Integrations → Cron** (or Database → Cron): a job called **patrol-monitor** that runs every 5 minutes.

### 2.3 Deploy the Edge Function (account management)
Why: creating a login needs the secret key (`sb_secret_…`, formerly `service_role`). That key must stay on Supabase's servers, so the portal asks this function to create accounts instead.
```bash
npx supabase functions deploy admin-users --project-ref zdezuylsruzbddqcdhog --no-verify-jwt
```
You do not need to set any secret. Supabase gives every function its own `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` automatically.

`--no-verify-jwt` is required: the platform's built-in JWT check only understands the legacy keys, which are switched off (step 2.6). The function checks the caller's login itself.

### 2.4 Make yourself the first admin
1. Dashboard → **Authentication** → **Users** → **Add user** → **Create new user**. Enter your email and a strong password, and tick **Auto Confirm User**.
2. Open `supabase/bootstrap_first_admin.sql`, check the email address, paste it into the **SQL Editor** and press **Run**. It should return one row with `role = admin`.

### 2.5 Check the security advisors
Dashboard → **Advisors** → **Security Advisor**. It should show no "RLS disabled" errors.

### 2.6 Rotate the leaked `service_role` key
The `service_role` key was pasted into a chat while this system was being built. Treat it as compromised: anyone holding it can read and delete all data.
The fix is to move to Supabase's new key pair and switch the legacy keys off:

| Legacy key (off) | Replaced by | Used by |
|---|---|---|
| `anon` | Publishable key `sb_publishable_…` | Portal and guard app (`VITE_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) |
| `service_role` | Secret key `sb_secret_…` | `admin-users` Edge Function only (read from `SUPABASE_SECRET_KEYS`) |

1. Put the **publishable** key in both `.env` files and the Netlify and EAS variables. The variable names stay the same.
2. Deploy the Edge Function as in step 2.3.
3. Dashboard → **Project Settings** → **API Keys** → **Legacy API keys** → **Disable JWT-based API keys**. This stops the legacy keys working in the `apikey` header.
4. Dashboard → **Project Settings** → **JWT Keys** → **Previously used keys** → **Legacy HS256 (Shared Secret)** → **Revoke key**. Step 3 alone is not enough: the legacy keys stay valid as login tokens (`Authorization: Bearer`) until the secret that signed them is revoked.
5. Create a test account from the portal (step 3.3). This confirms the Edge Function still works.

> **Status on 12 Oct 2026:** steps 2–4 are done on `zdezuylsruzbddqcdhog`. Tested: the legacy keys are rejected in both the `apikey` and `Authorization` headers; the publishable key and the Edge Function work.

---

## Part 3: Supervisor portal

### 3.1 Run it on your computer
```bash
cd apps/portal
npm ci                         # installs the exact package versions in package-lock.json
cp .env.example .env.local     # Windows PowerShell: Copy-Item .env.example .env.local
```
Open `.env.local` and paste the **publishable** key (`sb_publishable_…`) after `VITE_SUPABASE_ANON_KEY=`. Find it under Dashboard → Project Settings → API Keys. **Never paste a secret key here.**
```bash
npm run dev                    # open http://localhost:5173 and sign in as the admin
```

### 3.2 Deploy to Netlify
1. Push the code to GitHub (already done if you are reading this from the repository).
2. Netlify → **Add new site** → **Import an existing project** → GitHub → choose `Patrolling_Tour_System`.
3. Set **Base directory** to `apps/portal`. Netlify then reads the build command and publish folder from `apps/portal/netlify.toml`.
4. **Site configuration → Environment variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_SENTRY_DSN`.
5. **Deploy**. Note the address (e.g. `https://mb-patrol.netlify.app`).
6. In Supabase → **Authentication** → **URL Configuration**, set **Site URL** to that address.

The public privacy policy is then at `https://<your-site>/privacy`. The app stores need this address.

### 3.3 First data (in the portal, in this order)
1. **Contractors**: add each security company.
2. **Guards & users**: create the **one shared security login** (e.g. security@muscatbay.com, role Guard, linked to the contractor). The portal suggests a temporary password. Share it in person with the security team leader only. Each guard types their own name at Start shift.
3. **Checkpoints**: create them on site (see Part 5).
4. **Routes**: put checkpoints in order and set "due at shift start + N min".
5. **Schedules**: create shifts. Use "Repeat for N days" to fill a month quickly.

---

## Part 4: Guard app

### 4.1 Why a "development build", not Expo Go
NFC, background location and Sentry use native code that the general-purpose **Expo Go** app does not contain. So we build our own app, once, in the cloud with **EAS Build**. After that, code changes reload instantly, just like Expo Go.

### 4.2 Accounts you need
- **Expo** account (free): https://expo.dev/signup
- **Apple Developer Program** (USD 99/year), for iPhone builds and the App Store.
- **Google Play Console** (USD 25 once), for the Play Store.

### 4.3 Install and link
```bash
cd apps/guard
npm ci
cp .env.example .env            # then paste the publishable key and the control-room number
npm install -g eas-cli
eas login
eas init                        # creates the Expo project and prints its ID
```
`eas init` prints a **project ID**. Paste it into `apps/guard/app.config.ts`, replacing `PASTE-EAS-PROJECT-ID-HERE`.

### 4.4 Give the cloud build its settings
`.env` stays on your computer, so EAS needs its own copy of the public values. Run this once per environment (`development`, `preview`, `production`):
```bash
eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value https://zdezuylsruzbddqcdhog.supabase.co --visibility plaintext
eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <publishable key> --visibility plaintext
eas env:create --environment development --name EXPO_PUBLIC_CONTROL_ROOM_PHONE --value +96824857781 --visibility plaintext
# Optional crash reporting:
eas env:create --environment development --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility plaintext
eas env:create --environment development --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
eas env:create --environment development --name SENTRY_ORG --value <org-slug> --visibility plaintext
eas env:create --environment development --name SENTRY_PROJECT --value <project-slug> --visibility plaintext
```
If you are not using Sentry yet, add `SENTRY_DISABLE_AUTO_UPLOAD` = `true` instead of the last three.

### 4.5 Build and install on your phone
```bash
eas build --profile development --platform android   # about 15 min; gives a link/QR to install the APK
eas build --profile development --platform ios       # needs Apple Developer; register your iPhone when asked
npx expo start --dev-client                          # then open the installed app; it connects to your computer
```

### 4.6 Production builds and store submission
```bash
eas build --profile production --platform all
eas submit --platform android --latest     # goes to the Play "internal testing" track first
eas submit --platform ios --latest         # goes to TestFlight
```
Before submitting, work through [the store checklist](03-store-submission-checklist.md).

---

## Part 5: Field set-up and acceptance test

### 5.1 Place each checkpoint accurately
Scans more than the checkpoint radius (default **30 m**) away are **rejected**. So GPS placement matters.
- Best: stand at the checkpoint with a phone or tablet, open the portal's **Checkpoints** page, choose **New checkpoint** → **Use my location**.
- Indoors (pump rooms, plant rooms, basements) GPS is often 20–60 m out. Choose one:
  - set the checkpoint position at the room entrance, or
  - raise that checkpoint's radius to 50–80 m, or
  - accept that supervisors will review those scans. Every rejection shows the measured distance and GPS accuracy, and a supervisor can override it with a reason.

### 5.2 Labels and tags
- **QR labels**: Checkpoints → **Print QR labels**. Print on weatherproof sticker paper, or laminate. Mount at about 1.4 m, out of direct sun.
- **NFC tags** (optional, recommended where labels get damaged): use NTAG213/215 stickers. With any free NFC-writing app, write a **Text** record that contains the checkpoint code exactly, e.g. `MB-CP-0001`. This works on both iPhone and Android.

### 5.3 Acceptance test (sign off each line)
| # | Test | Expected |
|---|---|---|
| 1 | Guard logs in; Work tab shows today's shift and route | Checkpoints listed with due times |
| 2 | Personal → type your full name (and ID) → Start shift; allow location "All the time" | Status "On shift"; Work tab shows "On duty: name"; portal live map shows that name within 2 min |
| 2a | Try Start shift with the name left empty | App refuses: name required |
| 3 | Scan QR at a checkpoint → Normal → Save | Toast "saved"; Work tab ticks it; portal Scan records shows **Valid** |
| 4 | Scan the same label 100 m away | Saved, but portal shows **Rejected – too far** and an alarm |
| 5 | Airplane mode → scan 2 checkpoints with photos | "Saved offline" and "Pending upload"; turn data on → uploads automatically |
| 6 | Issue found without a photo | App refuses: photo and note required |
| 7 | Issue found with photo, note and voice memo | Portal Incidents shows it with photo and playable audio |
| 8 | Hold SOS for 2 s | Portal sounds an alarm, shows a pop-up, and a red marker at the guard's position |
| 9 | Skip a checkpoint past its due time + 15 min | "Missed checkpoint" alarm within 5 min |
| 10 | Android: enable a fake-GPS app, then scan | **Rejected – fake GPS** |
| 11 | End shift | Tracking notification disappears; live map drops the guard |
| 12 | Reports → contractor → month → Download PDF | PDF with completion, punctuality and the daily patrol log naming the guard on duty each day |

## Everyday commands

| Task | Command (run in the app's folder) |
|---|---|
| Portal: run locally | `npm run dev` |
| Portal: check types and build | `npm run build` |
| Guard app: start dev server | `npx expo start --dev-client` |
| Guard app: check types | `npm run typecheck` |
| Guard app: check dependencies | `npx expo-doctor` |
| Database: apply new migrations | `npx supabase db push` |
| Database: run the monitor by hand | SQL editor: `select public.run_patrol_monitor();` |
