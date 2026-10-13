# 2. How it works, from first principles

## 2.1 The big picture

```
 Guard phone (Expo app)                    Supabase (cloud)                        Supervisor (browser)
 ┌──────────────────────┐   HTTPS + login  ┌──────────────────────────────┐  HTTPS  ┌────────────────────┐
 │ Scan QR / barcode/NFC│ ───────────────► │ Auth: who are you?           │ ◄────── │ Portal (Netlify)   │
 │ GPS, time, photos    │                  │ Postgres + RLS: may you?     │         │ live map, alarms,  │
 │ SQLite OUTBOX        │ ◄─────────────── │ submit_scan(): is it genuine?│ ──────► │ schedules, reports │
 │ background GPS task  │                  │ Storage (private photos)     │ Realtime│                    │
 └──────────────────────┘                  │ pg_cron every 5 min: missed? │ (push)  └────────────────────┘
                                           │ Edge Function: create users  │
                                           └──────────────────────────────┘
```

Two principles drive every design choice:
1. **Never trust the phone.** It can fake its location and its clock. The phone sends raw evidence; the **server** decides.
2. **Never lose a scan.** Signal drops all the time on patrol. Everything is saved on the phone first, then uploaded.

## 2.2 Security: Row Level Security (RLS)

The apps talk to the database directly, using the public `anon` key plus the user's login token.

- **The anon key protects nothing.** Anyone can extract it from the app.
- **The login token does.** The server issues and signs it, so it cannot be forged. Inside the database, `auth.uid()` reads the user's id from that token.
- **RLS policies** are rules attached to each table, checked for every row:

| Table | Guard can | Supervisor / admin can |
|---|---|---|
| profiles | read and edit own name/phone only | read all; edit; only **admins** change roles |
| checkpoints, routes | read those on own shifts | full control |
| shifts | read own | create, edit, cancel |
| scans | read own; create **only via `submit_scan`** | read all; override verdict with a note |
| scan_attachments, Storage | add/read files of **own** scans | read all |
| alarms, incidents | read own | read all, acknowledge, resolve |
| location_pings | add own points | read all (live map) |

Scans and attachments **cannot be deleted** by anyone through the apps. They are evidence.

## 2.3 A scan, step by step

1. **On the phone (scanner screen).**
   - GPS starts the moment the scanner opens, so a good fix is ready.
   - The scanned value is matched against the route's checkpoints, cached on the phone. Unknown codes, such as a product barcode, are refused straight away.
   - The phone records `device_time` (when scanned) and the GPS fix (lat, lng, accuracy, and *mocked* on Android).
2. **On the phone (report screen).** The guard chooses **Normal** or **Issue found**.
   - Issue found requires a note **and** at least one photo.
   - Photos are compressed to 1,600 px, JPEG 70%: about 300 KB instead of 5 MB.
   - Voice memos are AAC (.m4a) and stop automatically at 2 minutes.
3. **Outbox.** The scan and its files are written to SQLite and the app's document folder. The guard sees **Pending upload**.
4. **Sync.** The sync engine calls `submit_scan()` with the same scan id every time it retries, so a retry never creates a duplicate.
5. **Server validation (`submit_scan`).**

| Check | Flag | Effect |
|---|---|---|
| Code matches this checkpoint | `code_mismatch` | rejected |
| Checkpoint is on this shift's route | `not_on_route` | rejected |
| Distance ≤ checkpoint radius (30 m default) | `too_far` | rejected |
| GPS present | `no_gps` | rejected |
| Android reports a fake-GPS app | `mock_location` | rejected |
| Scan time inside the shift window | `outside_shift` | rejected |
| Phone clock within 5 min of the server | `clock_drift` | flagged (still counts) |
| GPS accuracy ≤ 50 m | `low_accuracy` | flagged (still counts) |
| Shift was started in the app | `shift_not_started` | flagged (still counts) |
| Scanned before due time + 15 min grace | `late` | counts, but lowers punctuality |

   **Rejected** scans are still **stored** (never discard evidence). They do not count towards completion, and they raise a `scan_rejected` alarm. A supervisor can override any verdict, with a mandatory reason.
6. **Attachments** upload to the private bucket at `patrol-media/scans/{scan_id}/{file}`. A row is then written to `scan_attachments`. Gallery photos whose EXIF date is before the shift start, or that have no date, get `flagged_pre_shift = true` on the server.

### The clock check, explained
An offline scan may upload hours later, so "server time minus scan time" would wrongly flag every offline scan. Instead the phone sends two readings of **its own** clock:

- `device_time`: when the tag was scanned.
- `device_sent_at`: when the upload left the phone.

The server works out:

- `clock_offset = server_now − device_sent_at`: how wrong the phone's clock is.
- `effective_time = device_time + clock_offset`: the true scan time.

This is accurate however long the scan waited in the outbox. It also catches a guard who changes the phone clock.

## 2.4 Shifts, routes and history that never changes
- A **route** is an ordered list of checkpoints. Each one is due at "shift start + N minutes".
- When a **shift** is created, the database copies the route's checkpoints into `shift_checkpoints`.
- If a route is later edited, only **not-yet-started** shifts pick up the change. Started and past shifts keep what they were patrolled against, so **last month's report never changes.**
- One shift is **one pass** of the route. For repeated rounds in a night, schedule several shorter shifts (e.g. 22:00–00:00, 00:00–02:00). Or ask for a "rounds per shift" enhancement.

### One shared security login: "guard on duty"
Muscat Bay security uses **one shared login**, with one guard patrolling once a day. A login alone cannot tell us *who* patrolled, so:
- On the Work tab (app) or `/guard` page (web) the guard **taps their name** from the guard list the supervisor keeps under Night patrol. Nothing is prefilled, so yesterday's name cannot carry over by accident, and the server refuses any name not on the list.
- `start_patrol_now()` starts the patrol on the **server clock**, reuses the shift the nightly schedule prepared (or creates one), and stores the name on the shift (`shifts.on_duty_name`). **It cannot be changed afterwards** from the app; pressing Start again keeps the first name.
- Every scan, alarm, SOS, incident, the live map and the reports show this name. Records from before this change fall back to the login's name.
- **Reports → daily patrol log** lists one row per day: date, guard on duty, ID, route, visited / due, on time, incidents and SOS. It is also in the PDF.
- Limit to be aware of: the name is typed, not verified. A supervisor should check it against the duty roster. For stronger proof, give each guard their own login later; the system already supports that.

## 2.5 Alarms and the 5-minute monitor
`run_patrol_monitor()` runs every 5 minutes (pg_cron). It:

| Raises or does | When |
|---|---|
| `shift_not_started` alarm | Start time + 15 min passed and the guard has not started (no-show) |
| `missed_checkpoint` alarm | A checkpoint's due time + 15 min passed with no valid scan |
| Marks shift **missed** | The shift ended and was never started |
| Auto-closes shift | Still active 2 h after its end; it is labelled in the notes |
| Deletes GPS trail | Older than 90 days (privacy) |

- A late but genuine scan **auto-resolves** its missed alarm.
- The portal receives new alarms through **Realtime**, a WebSocket the server pushes to. Supervisors get a pop-up and a sound within a second, on any page. SOS pop-ups stay on screen for a minute.

## 2.6 Background location
- Tracking runs **only** between Start shift and End shift.
  - **Android** shows a permanent "Patrol shift in progress" notification (a foreground service). Android requires it, and it is honest to the guard.
  - **iOS** shows the blue location indicator.
- Points are recorded about once a minute, or every 25 m moved. They go to the outbox first, then upload in batches.
- If the phone restarts during a shift, tracking resumes the next time the app opens.
- Android policy expects an in-app explanation **before** the background permission prompt. The app shows it when the guard taps Start patrol.

## 2.7 Statistics (identical everywhere)
`patrol_stats()` is one server function, used by the guard's Statistic tab, the portal and the monthly PDF, so the numbers always agree.
- **Completion** = checkpoints visited ÷ checkpoints due. Only checkpoints whose due time + grace has passed are counted.
- **Punctuality** = visits within grace ÷ checkpoints visited.
- Monthly totals are **weighted** (sum of visits ÷ sum due), not an average of percentages.

## 2.8 Tunable settings
Edit in the Supabase SQL Editor. Changes apply immediately.
```sql
update public.app_settings set
  grace_minutes = 15,              -- lateness allowed before "late" / "missed"
  max_clock_drift_sec = 300,       -- phone clock tolerance
  max_gps_accuracy_m = 50,         -- poorer accuracy is flagged
  shift_early_start_minutes = 30,  -- how early a guard may start
  location_retention_days = 90     -- privacy: GPS trail kept for this long
where id = 1;
```
The radius is set **per checkpoint** on the portal's Checkpoints page (default 30 m).

## 2.9 Known limits: decisions to review
| Limit | Why | Option |
|---|---|---|
| iPhone cannot report fake GPS | iOS does not expose it to apps | Rely on distance, NFC tags and photo evidence; Android catches it |
| Start shift needs signal | The server must confirm the shift | Scans still work and are flagged `shift_not_started` |
| Indoor GPS is imprecise | Physics | Per-checkpoint radius, NFC, supervisor review (see installation 5.1) |
| One pass per shift | Keeps the model simple and auditable | Several shorter shifts, or a rounds enhancement |
| Shared login: name is typed, not verified | Security chose one login for all guards | Check against the duty roster, or move to one login per guard |
| Map tiles from OpenStreetMap | Free, no key | For heavy use, switch the tile URL in `PatrolMap.tsx` to a paid provider |
