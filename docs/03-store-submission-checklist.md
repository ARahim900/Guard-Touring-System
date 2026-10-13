# 3. App Store and Google Play submission checklist

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
- ☐ Check how the Apple Developer account is enrolled. **Organisation** (needs Muscat Bay's D-U-N-S number) shows *Muscat Bay* as the seller. **Individual** shows the account holder's personal name on the App Store page; it cannot be changed later without transferring the app.
- ☐ Pilot through **TestFlight** first (no App Review for internal testers; each build lasts 90 days), then request **Unlisted** distribution. Apple often rejects login-only internal tools from the public listing.
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
  - **Tracking**: No.
- ☐ Review notes. Paste and adapt:
  > Internal tool for licensed security guards at Muscat Bay, Oman. Accounts are issued by the employer; there is no public sign-up. Test login: [email] / [password]. On the Work tab, tap any name under "Who is on duty?", then Start patrol. Scan the attached QR code (or any checkpoint label) to test. Background location is used only while a shift is active, to show supervisors patrol progress and to locate a guard after an SOS; it stops when the shift ends.
- ☐ Consider **Unlisted** distribution (only people with the link can find it) or **Apple Business Manager** custom-app distribution. This suits an internal tool.
- ☐ Screenshots for 6.9" and 6.5" iPhones: Work, Scan, Report, Histories, Statistic.

## 3.3 Google Play
- ✅ Permissions declared:
  - `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`
  - `FOREGROUND_SERVICE_LOCATION`
  - `CAMERA`, `RECORD_AUDIO`, `NFC`
- ✅ Unused storage and media-playback service permissions are blocked.
- ✅ **Prominent disclosure** is shown before the background-location prompt (Work tab → Start patrol).
- ✅ Foreground-service notification while tracking.
- ☐ Play Console → **App content**:
  - **Privacy policy**: the public URL.
  - **Data safety**: Location (precise), Personal info (name, email, phone), Photos, Audio, App activity, Crash logs. All for *App functionality*; none shared or sold. Data is encrypted in transit. Users can request deletion via the privacy contact.
  - **Location permissions declaration** (background): describe the feature ("live patrol tracking during an active security shift") and upload a **short video**. It must show the disclosure dialog, the permission prompt and the tracking notification.
  - **Foreground service declaration**: type *location*, same justification and video.
  - **Target audience**: 18+. Not designed for children.
  - **Ads**: none.
- ☐ Consider a **private app** through Managed Google Play, if the contractor phones are company-managed.
- ☐ Use the internal testing track first (`eas.json` submits there), then closed testing, then production.
- ☐ Screenshots (phone): same set as iOS. Feature graphic 1024×500.

## 3.4 After release
- ☐ Watch Sentry for the first week; fix any crash-free-session rate below 99.5%.
- ☐ Run the acceptance test (installation guide, Part 5.3) on one Android and one iPhone of the models the guards actually use.
- ☐ Check that battery use is acceptable over a full 12-hour shift. If not, raise `timeInterval` or `distanceInterval` in `apps/guard/src/services/location.ts`.
