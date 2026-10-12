# MB Patrol, simplified: design

**Date:** 2026-10-12 · **Status:** for Rahim's review · **Replaces:** the 13-page portal and 5-tab guard app

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
| "Day" | Calendar day 00:00–23:59 Asia/Muscat, stored as a setting | Claude default; Rahim did not choose |
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
| **Start shift** | Shown when no shift is active: type name, tap Start. Creates the shift on the server (no schedule needed). |
| **Scan** | Camera opens; reads the QR; shows a green tick or red cross with the reason ("Too far: 140 m"). |
| **Report** | Camera photo (no gallery) + short note, attached to the last scan. |
| **End shift** | One tap, with a confirm. |
| **Call** | Dials `EXPO_PUBLIC_CONTROL_ROOM_PHONE`. Replaces the SOS alarm system. |

**Offline:** if there is no signal, the scan is kept on the phone with its GPS fix and time,
and uploads automatically later (existing outbox, kept).

**Removed from the guard app:** tabs, statistics, histories, personal page, NFC, voice memo,
background location tracking, SOS button, gallery photos, Sentry.

## 4. How a scan is proven (server-side, unchanged in principle)

| Check | Result |
|---|---|
| Phone GPS more than the checkpoint radius (default 30 m) from the checkpoint at the moment of scanning | **Rejected – too far**; map shows both points |
| No GPS position at all | **Rejected – no GPS** |
| Android reports a fake-GPS app | **Rejected – fake GPS** |
| Scan time in the future, or outside the guard's shift | **Rejected** |
| Phone clock differs from server clock by more than 5 min | **Flagged** (still counts); server time is used |
| GPS accuracy worse than 50 m | **Flagged "weak GPS"** (still counts; typical indoors) |
| QR is not a Muscat Bay checkpoint code | The app says so; nothing is sent |
| Checkpoint switched off in the portal | **Rejected** |

Scanning reads only the live camera. There is no "scan from photo" option.

**Known limits, accepted:** iPhones cannot report fake-GPS apps; indoor GPS can be 20–60 m out,
so indoor checkpoints may need a larger radius.

## 5. Supervisor portal: four pages

| Page | Content |
|---|---|
| **Today** | Date picker (default today). Satellite map + list: done / not yet / missed / rejected. Counts: "28 of 32 done". Click a rejected scan to see the checkpoint and the phone position on the map. Issue reports (photo + note) appear in the list. |
| **Checkpoints** | Satellite map: click to add a pin, drag to correct it; name and radius. Print QR labels. |
| **Reports** | Pick a month → PDF: one line per day (done, missed, rejected, guard on duty), then the missed and rejected detail. |
| **Users** | Add guard or supervisor, reset password, deactivate. |

**Removed pages:** Dashboard, Live map, Alarms, Incidents, Scans, Schedules, Routes, Contractors.

## 6. Daily round logic

- A checkpoint is **done** for a day when it has at least one scan graded *valid* or *flagged*
  whose `effective_time` falls on that Muscat calendar day. *Rejected* scans never count.
- Supervisors can override a rejected scan with a reason (existing review fields); an overridden
  scan then counts.
- **Not yet** = no counting scan and the day is not over. **Missed** = no counting scan and the day is over.
- Calculated when the page is read (a database view). No 5-minute background job.
- New setting `rounds_per_day` (default 1). Only 1 is implemented now; the setting exists so it can
  be raised later without a schema change.

## 7. Back-end changes

| Change | Detail |
|---|---|
| New migration `…0800_simple_patrol.sql` | `start_patrol(name)` and `end_patrol()` create/close a shift without a schedule; `submit_scan` drops the route and due-time logic and keeps all location/clock checks; view `daily_round_status(day)`; setting `rounds_per_day`, `round_day_start` |
| Shifts | `route_id`, `scheduled_start`, `scheduled_end` become optional |
| Cron job `patrol-monitor` | Unscheduled (no longer needed) |
| Unused tables | `routes`, `route_checkpoints`, `shift_checkpoints`, `alarms`, `guard_locations`, `contractors` and the incident workflow stay in place, unused. Dropped later only with Rahim's approval. |
| Edge Function `admin-users` | Unchanged |

## 8. Maps

- **Portal:** keep Leaflet; swap the OpenStreetMap layer for Esri World Imagery; add
  `server.arcgisonline.com` to the Content Security Policy; show the Esri attribution.
- **Guard app:** MapLibre React Native with the same Esri layer (no Google key). Needs the
  existing development build; Expo config plugin to be confirmed in the plan.

## 9. Testing

- Database: extend the existing local PostgreSQL tests for `start_patrol`, `submit_scan`
  (in range, too far, fake GPS, clock drift, offline upload) and `daily_round_status`
  (done / not yet / missed across midnight Muscat time).
- Portal: type-check and build; click through all four pages in the browser on the live site.
- Guard app: type-check; on a real Android and iPhone, run the acceptance test in the install guide,
  rewritten for the new flow (including "scan a photo of the label 100 m away → rejected").

## 10. Out of scope

Multiple rounds per day, live tracking, NFC, SOS alarms, shift schedules, contractors, Sentry.
Each can be added back later if a real need appears.
