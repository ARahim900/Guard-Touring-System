# MB Patrol, simplified: design

**Date:** 2026-10-12 · **Status:** for Rahim's review · Codex-reviewed (read-only), points re-checked at source · **Replaces:** the 13-page portal and 5-tab guard app

## 1. Goal

One daily patrol round covering every checkpoint (30 or more), proven by a barcode scan
taken at the checkpoint. Guards need four actions; supervisors need four pages. Everything
else is removed.

**Success means:**
- A guard can complete a round with no training beyond "Start, Scan, End".
- A scan taken away from the checkpoint (e.g. a photo of the label scanned later) is rejected.
- The supervisor sees, for today and any past day, which checkpoints were done, missed or rejected.
- The monthly PDF shows the same, day by day.

## 2. Decisions taken

| Topic | Decision | Source |
|---|---|---|
| Platform | Native phone app (iPhone + Android), stripped down | Rahim, option B |
| Round | **1 round per day**; every active checkpoint scanned once | Rahim |
| Checkpoints | 30 or more | Rahim |
| "Day" | Fixed calendar day 00:00–23:59 Asia/Muscat | Claude default; Rahim said "go ahead" |
| Labels | QR codes (a 2-D barcode) | Claude; QR scans at any angle and in poor light |
| Map | Esri World Imagery satellite, as in the Muscat Bay app; no Google key | Rahim asked for a satellite map |
| Login | One shared security login; guard types their name at Start shift | Existing (migration 06) |

## 3. Guard app: one screen

```
┌───────────────────────────┐
│ MB Patrol   On duty: Ali  │  purple bar · "12 / 32 done today"
├───────────────────────────┤
│   SATELLITE MAP           │  pins: done (success) · not yet (grey) · rejected (danger)
│      [you are here]       │
├───────────────────────────┤
│   [  SCAN  ]  [ REPORT ]  │  two large buttons
│   [ End shift ]  [ Call ] │  Call = dials the control room
└───────────────────────────┘
```

| Action | Behaviour |
|---|---|
| **Start shift** | Shown when no shift is active: type name, tap Start. Creates the shift on the server, so **Start needs signal** (scans after that work offline). A shift still open at midnight is closed automatically and a new one is started for the new day. |
| **Scan** | Camera opens; reads the QR; shows a green tick or red cross with the reason ("Too far: 140 m"). |
| **Report** | Camera photo (no gallery) + short note + current GPS position. Works anywhere, not only at a checkpoint. |
| **End shift** | One tap. The confirm shows how many checkpoints are still not done today and how many scans are waiting to upload. |
| **Call** | Records the time and GPS position (queued if offline), then dials `EXPO_PUBLIC_CONTROL_ROOM_PHONE`. The record shows on the Today page. Replaces the SOS alarm system. |

**Offline:** if there is no signal, the scan is kept on the phone with its GPS fix and time,
and uploads automatically later (existing outbox, kept).

**Removed from the guard app:** tabs, statistics, histories, personal page, NFC, voice memo,
background location tracking, SOS button, gallery photos, Sentry.

## 4. How a scan is proven (server-side, unchanged in principle)

| Check | Result |
|---|---|
| Phone GPS more than the checkpoint radius (default 30 m) from the checkpoint | **Rejected – too far**; map shows both points |
| GPS position taken more than 10 s before or after the QR read (the phone sends the GPS time; today it can be up to 2 min old and the server never sees its age) | **Rejected – stale GPS** |
| No GPS position at all | **Rejected – no GPS** |
| Android reports a fake-GPS app | **Rejected – fake GPS** |
| Scan time in the future, or outside the guard's shift | **Rejected** |
| Scan uploaded more than 12 h after it was taken (offline queue) | **Flagged** for review |
| Phone clock differs from server clock by more than 5 min | **Flagged** (still counts); server time is used |
| GPS accuracy worse than 50 m | **Flagged "weak GPS"** (still counts; typical indoors) |
| QR is not a Muscat Bay checkpoint code | The app says so; nothing is sent |
| Checkpoint switched off in the portal | **Rejected** |

Scanning reads only the live camera. There is no "scan from photo" option. A photo shown on a second phone can still be read by the camera, which is why the GPS check, not the camera, is the real proof.

**Known limits (see section 11 for decisions):** iPhones cannot report fake-GPS apps, and a
rooted Android can hide them; anyone holding the shared password could call the server directly
with invented positions; the typed guard name proves nothing about who is holding the phone.
Indoor GPS can be 20–60 m out, so indoor checkpoints may need a larger radius. Checkpoint radii
must not overlap.

## 5. Supervisor portal: four pages

| Page | Content |
|---|---|
| **Today** | Date picker (default today). Satellite map + list: done / not yet / missed / rejected. Counts: "28 of 32 done". Click a rejected scan to see the checkpoint pin and the phone position on the same map (today it only links to OpenStreetMap). Issue reports and Call records appear in the list. Override a rejected scan with a reason. |
| **Checkpoints** | Satellite map: click to add a pin, drag to correct it; name and radius. Print QR labels. |
| **Reports** | Pick a month → PDF: one line per day (done, missed, rejected, guard on duty), then the missed and rejected detail. |
| **Users** | Reset the shared security password; add or remove supervisors. |

**Removed pages:** Dashboard, Live map, Alarms, Incidents, Scans, Schedules, Routes, Contractors.

## 6. Daily round logic

- A checkpoint is **done** for a day when it has at least one scan graded *valid* or *flagged*
  (or *overridden* by a supervisor) whose `effective_time` falls on that Muscat calendar day.
  *Rejected* scans never count.
- The **expected** checkpoints for a day are those that were active on that day (new columns
  `active_from`, `active_until` on checkpoints). Switching a checkpoint off later does not rewrite
  past days.
- Override keeps the original automatic grade untouched: new columns `override_valid`,
  `override_reason`, `override_by`, `override_at`. Today the portal overwrites `validation`, which
  destroys the evidence.
- **Not yet** = no counting scan and the day is not over. **Missed** = no counting scan and the day is over.
- Calculated when the page is read (a database view). No 5-minute background job.
- One round per day, fixed. More rounds would be a later, separate change.

## 7. Back-end changes

| Change | Detail |
|---|---|
| New migration `…0800_simple_patrol.sql` | `start_patrol(name)` and `end_patrol()` create/close a shift without a schedule (locked so two taps cannot open two shifts); `submit_scan` drops the route and due-time logic, keeps all location/clock checks and adds the GPS-age check; function `daily_round_status(p_day date)` callable by supervisors/admins only; `call_log` table for Call records |
| Shifts | `route_id`, `scheduled_start`, `scheduled_end` become optional. Every function that relies on them (`daily_patrol_log`, `contractor_report`, `shift_checkpoint_status`, `start_shift_as`) is replaced or removed in the same migration, and the TypeScript types are regenerated. |
| Cron job `patrol-monitor` | Replaced by a once-a-day job that only deletes GPS records older than the retention period (privacy). Missed checkpoints are calculated on read. |
| Unused tables | `routes`, `route_checkpoints`, `shift_checkpoints`, `alarms`, `guard_locations`, `contractors` and the incident workflow stay in place, unused. Dropped later only with Rahim's approval. |
| Edge Function `admin-users` | Unchanged |

## 8. Maps

- **Portal:** keep Leaflet; swap the OpenStreetMap layer for Esri World Imagery; add the Esri tile
  host to the Content Security Policy; show the Esri attribution.
- **Guard app:** `@maplibre/maplibre-react-native` (v11, needs the New Architecture, which Expo
  SDK 57 has) with the same Esri layer. Added to `plugins`; works only in the development and store
  builds, not Expo Go.
- **Licence:** Esri World Imagery is covered by Esri's terms and needs attribution. The anonymous
  tile address used by the Muscat Bay app is not clearly licensed for company use. See section 11.

## 9. Testing

- Database: extend the existing local PostgreSQL tests for `start_patrol`, `submit_scan`
  (in range, too far, fake GPS, clock drift, offline upload) and `daily_round_status`
  (done / not yet / missed across midnight Muscat time).
- Portal: type-check and build; click through all four pages in the browser on the live site.
- Guard app: type-check; on a real Android and iPhone, run the acceptance test in the install guide,
  rewritten for the new flow (including "scan a photo of the label 100 m away → rejected").

## 10. Out of scope

Multiple rounds per day, live tracking, NFC, SOS alarms, shift schedules, contractors, Sentry,
device attestation (Play Integrity / App Attest), hardware-bound device keys.
Each can be added back later if a real need appears.

## 11. Decisions still needed from Rahim

| # | Question | Options |
|---|---|---|
| 1 | Who is on duty? | **a.** Type a name (current, no proof) · **b.** Pick from a guard list + 4-digit personal PIN (recommended: one extra step, real accountability) |
| 2 | Whose phones? | **a.** Guards' own phones · **b.** Company Android phones (recommended: fake-GPS detection works, no personal data) |
| 3 | Map licence | **a.** Same anonymous Esri address as the Muscat Bay app (unclear licence) · **b.** Free ArcGIS developer API key (recommended: same imagery, licensed, free tier) |

## 12. Codex review: what was accepted and rejected

| Codex point | Outcome |
|---|---|
| Stale GPS (up to 2 min) and age not checked by server | **Accepted** – 10 s rule, section 4 |
| Override overwrites the original grade | **Accepted** – separate override columns |
| Past days change when checkpoints are switched off | **Accepted** – `active_from` / `active_until` |
| A view cannot take a date parameter | **Accepted** – function with staff-only access |
| Nullable shift columns break 4 functions | **Accepted** – replaced in the same migration |
| Cron also deletes old GPS records | **Accepted** – keep a daily clean-up job |
| Start needs signal; midnight crossing | **Accepted** – section 3 |
| Remove `rounds_per_day` / `round_day_start` | **Accepted** |
| Keep a minimal SOS | **Accepted** – Call button logs time and position |
| Reports anywhere; End shift warns | **Accepted** |
| Offline replay | **Accepted** – flag uploads over 12 h |
| Reject weak GPS (> 50 m) outright | **Rejected** – would block genuine indoor scans; stays flagged and visible |
| Device attestation, hardware device keys | **Rejected for now** – too complex for the brief; company phones (decision 2) cover most of the risk |
| Guard PIN, company phones, Esri licence | **Needs Rahim** – section 11 |
