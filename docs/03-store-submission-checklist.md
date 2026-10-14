# 3. iPhone (TestFlight) and Android (direct APK) release checklist

Tick every line before submitting. Items already handled in the code are marked ✅. Items you must do are marked ☐.

## 3.1 Before either store
- ✅ App icon, Android adaptive icon and splash screen are made from the official Muscat Bay logo (`brand/generate_assets.py`).
- ☐ Ask Marketing for the **vector** logo (SVG, AI or PDF). The supplied PNG is 400 px, so the Arabic and English wordmark on the splash screen is slightly soft; the icon itself is redrawn and sharp. Replace `brand/muscat_bay.png` with a ≥1600 px export and run `python3 brand/generate_assets.py`.
- ☐ Complete every **[square bracket]** in the privacy policy, in all three places:
  - `docs/privacy-policy.md`
  - `apps/guard/src/app/privacy.tsx`
  - `apps/portal/src/pages/Privacy.tsx`
- ☐ Deploy the portal so the privacy policy has a public URL: `https://<portal>/privacy`.
- ☐ Create a **reviewer test account**: a security login, the four guard names saved under Night patrol, and one QR label (print its code) for the reviewer to scan. The reviewer can start a patrol at any time; no shift needs scheduling.
- ☐ Set the version in `app.config.ts` (`version`). Build numbers auto-increment (`eas.json` → `autoIncrement`).
- ✅ Account sign-up is not offered (internal tool). Both stores accept this for **business/internal** apps. Explain it in the review notes.
- ✅ In-app privacy policy screen (login screen and Personal tab).
- ✅ Crash reporting (Sentry) with no personal data.

## 3.2 Apple App Store
- ✅ Account: **Individual** Apple Developer account. The App Store and TestFlight show the account holder's name as the developer, not Muscat Bay. If Muscat Bay later enrols as an Organisation, move the app with Apple's **App Transfer**; the bundle ID `com.muscatbay.patrol` stays the same.
- ☐ Distribute through **TestFlight**. Build with `npm run build:ios`, then upload with `npm run submit:ios`. Invite the security phones as **external testers** (email or public link). The first build of each version goes through a short Beta App Review. Each build expires after **90 days**, so publish a new build before then (see the renewal routine below).
- ☐ Only if a permanent install is needed: request **Unlisted** distribution. Apple often rejects login-only internal tools from the public listing.
- ✅ Permission texts (Info.plist) explain each use:
  - location when in use
  - location always
  - camera
  - photo library
  - microphone
  - NFC
- ✅ `UIBackgroundModes: location`; blue indicator shown while tracking.
- ✅ NFC entitlement (`com.apple.developer.nfc.readersession.formats`) is added by the plugin.
  - ☐ In the Apple Developer portal, App ID → enable **NFC Tag Reading**. EAS usually does this automatically. Check it once.
- ✅ Privacy manifest (`privacyManifests` in `app.config.ts`).
- ✅ `ITSAppUsesNonExemptEncryption = false` (only standard HTTPS).
- ☐ App Store Connect → **App Privacy** ("nutrition label"). Declare:
  - **Precise Location**: App Functionality. Linked to user. Not used for tracking.
  - **Name, Email, Phone**: App Functionality. Linked to user.
  - **Photos, Audio Data**: App Functionality. Linked to user.
  - **Crash Data**: App Functionality. Not linked to user.
  - **Device ID** (the anonymous app installation ID sent to Expo when the app checks for updates): App Functionality. Not linked to user.
  - **Tracking**: No.
- ☐ Review notes. Paste and adapt:
  > Internal tool for licensed security guards at Muscat Bay, Oman. Accounts are issued by the employer; there is no public sign-up. Test login: [email] / [password]. On the Work tab, tap any name under "Who is on duty?", then Start patrol. Scan the attached QR code (or any checkpoint label) to test. Background location is used only while a shift is active, to show supervisors patrol progress and to locate a guard after an SOS; it stops when the shift ends.
- ☐ Consider **Unlisted** distribution (only people with the link can find it) or **Apple Business Manager** custom-app distribution. This suits an internal tool.
- ☐ Screenshots for 6.9" and 6.5" iPhones: Work, Scan, Report, Histories, Statistic.

### TestFlight renewal routine (every build expires after 90 days)
A TestFlight build stops opening 90 days after it was uploaded. Put a reminder in the calendar for **day 75** of every build.
- ☐ Before day 90, build and upload a new build: `npm run build:ios`, then `npm run submit:ios`. The build number goes up by itself, so the same version can be uploaded again. Updates sent with `eas update` reach the new build too.
- ☐ In App Store Connect → TestFlight, check the new build shows **Ready to Test** for the external testers group. A new build of the same version usually needs no new Beta App Review.
- ☐ On each iPhone, open the **TestFlight** app and tap **Update** next to MB Patrol. Better: in TestFlight → MB Patrol, turn on **Automatic Updates** once, so new builds install by themselves.
- ☐ Tell the guards: **never delete MB Patrol to reinstall it.** Deleting the app deletes scans that are saved on the phone and not uploaded yet. Always update over the installed app.
- ☐ Before day 90, check every iPhone shows the new build (Personal tab → bottom of the screen shows the version and build number).

## 3.3 Android: direct APK installation (no Google Play)
Decision: the guard phones install the app directly from an APK file. Google Play's listing, Data safety form and background-location video are therefore not required.
- ✅ Permissions declared: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `NFC`. Unused storage and media-playback permissions are blocked.
- ✅ **Prominent disclosure** is shown before the background-location prompt (Work tab → Start patrol), and a notification is shown while tracking.
- ☐ Build: in `apps/guard`, run `npm run build:apk`. When the build finishes, Expo shows a download link and QR code.
- ☐ Install on each phone:
  1. Open the link on the phone and download the APK.
  2. When Android asks, allow **Install unknown apps** for the browser.
  3. If Play Protect warns about an unknown developer, choose **Install anyway**.
  4. Settings → Apps → MB Patrol → Battery → **Unrestricted**. Otherwise some phones stop background tracking.
- ☐ Download a backup of the signing key once (`npx eas-cli credentials` → Android → Download keystore) and store it with Muscat Bay's IT records. Without it, an update cannot be installed over the existing app.

### How updates reach the Android phones
There is no Google Play to push new versions, so updates arrive in two ways.

**1. Most changes: automatically (EAS Update).** Screens, wording, rules and bug fixes are JavaScript only. Publish them with
```bash
cd apps/guard
npm run update:production -- "Short description of the change"
```
(the same as `eas update --channel production --environment production --message "..."`). Each phone checks for an update when the app opens and when it comes back to the screen, downloads it in the background, and uses it the next time the app starts. It never restarts the app during a patrol. Updates reach both the APK phones and the TestFlight iPhones (`production` and `production-apk` builds share the `production` channel). Try it first on a `preview` build with `npm run update:preview -- "..."`.

**2. Native changes: a new APK and the in-app notice.** A change to native code (a new or updated native library, a new permission, an Expo SDK upgrade) cannot be sent by EAS Update. For these:
- ☐ Raise `APP_VERSION` in `apps/guard/app.config.ts` (for example 1.0.0 → 1.1.0). This keeps old builds from receiving updates they cannot run.
- ☐ Build the APK: `npm run build:apk`. For iPhones, also build and upload to TestFlight (see 3.2).
- ☐ Put the APK where the phones can download it, at an `https://` link:
  - the **Expo build page** link that EAS prints when `npm run build:apk` finishes (the same kind of link used for the first install); or
  - a **Supabase Storage** bucket, e.g. a public bucket named `app-releases`: Storage → New bucket → Public → upload `mb-patrol-1.1.0.apk` → copy its URL. Anyone with the link can download the app, but it holds only public settings; the login still protects all data.
- ☐ Tell the phones: Supabase dashboard → **Table Editor** → `app_settings` → the single row → set
  - `android_latest_version` to the new version exactly as in `app.config.ts`, e.g. `1.1.0` (numbers and dots only), and
  - `android_download_url` to the `https://` link of the APK,

  then **Save**. Android phones with an older version show *"A new version of MB Patrol is available"* on the Work tab with a **Download the new version** button and the warning *"Install it over this app. Do not uninstall first."* The card never blocks a patrol; it disappears once the new version is installed.
- ☐ On each phone: tap the button, download, and install **over** the old app. Saved scans and the login are kept because Expo signs every build with the same key.
  - **Never uninstall** the app while Histories shows uploads pending. Uninstalling deletes scans that are saved offline.
- ☐ To hide the notice again (e.g. a bad build), clear both fields.
- ☐ Google has announced that, from 2026 onwards and country by country, certified Android phones will only install apps from **verified developers**, including apps installed directly. Check the status for Oman before 2027. If it applies, register in the Android Developer Console; the APK route itself stays the same.

## 3.4 After release
- ☐ Watch Sentry for the first week; fix any crash-free-session rate below 99.5%.
- ☐ Run the acceptance test (installation guide, Part 5.3) on one Android and one iPhone of the models the guards actually use.
- ☐ Check that battery use is acceptable over a full 12-hour shift. If not, raise `timeInterval` or `distanceInterval` in `apps/guard/src/services/location.ts`.
- ☐ Check that updates arrive: publish a small change with `npm run update:production -- "Test update"`, close and reopen the app on one Android phone and one iPhone, and check the change shows. On expo.dev → project → Updates you can see how many phones have it.
- ☐ Confirm the login is stored encrypted: after installing this version over the previous one, the guards stay signed in (the old, unencrypted copy is moved into the encrypted store and deleted on first start).
- ☐ Keep the calendar reminders: TestFlight renewal (day 75 of each iPhone build) and, after each APK build, `android_latest_version` and `android_download_url` in `app_settings`.
