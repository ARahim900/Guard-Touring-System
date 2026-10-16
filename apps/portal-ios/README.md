# MB Security: supervisor iPhone app

A small native iPhone app (Swift, Apple's WebKit) that shows the live
supervisor portal (`https://securitymbpatrolling.netlify.app`) full-screen.
The portal itself is the app, so every Netlify deploy of `main` reaches the
phone with no new build. Installed size is under 1 MB; the earlier React
Native version was about 26 MB.

What the app adds to the website:
- Home Screen icon and splash in the brand colours.
- The notch and home-indicator areas are filled in the top-bar purple and the
  bottom-bar white (purple on the sign-in page).
- PDF, CSV and label exports open the iPhone share sheet (Save to Files, Mail,
  AirDrop), because a web view cannot download files itself.
- The portal's "Are you sure?" questions (window.confirm) show as iPhone alerts.
- The camera is allowed for the portal's label scanning; links outside the
  portal open in Safari inside the app; pull down to refresh.

## Files

- `ios/MBPatrol/PortalViewController.swift`: everything the app does.
- `ios/MBPatrol/Info.plist`: name, permissions text, launch screen.
- `ios/project.yml`: XcodeGen spec. After changing it, run
  `cd ios && xcodegen generate && pod install`.
- `ios/Podfile`: empty; EAS Build always runs `pod install`.

## Release a new build to TestFlight

Only needed when this folder changes (icon, name, permissions, native code).

```bash
cd apps/portal-ios
npx eas-cli build -p ios --profile production --auto-submit
```

- Home Screen name: **MB Security** (`CFBundleDisplayName` in `ios/MBPatrol/Info.plist`). The App Store Connect record and TestFlight listing are still called "MB Patrol".
- Expo project: `@arpro900/mb-patrol-portal`. Bundle ID: `com.muscatbay.patrol.supervisor`.
- App Store Connect app ID `6823613060` is set in `eas.json`.
- Change `MARKETING_VERSION` in `ios/project.yml` for a new version; EAS raises the build number.
- Distribution is private: TestFlight internal testers only, never the public App Store.
- A TestFlight build expires 90 days after upload.

## Local check

```bash
cd apps/portal-ios/ios
pod install
xcodebuild -workspace MBPatrol.xcworkspace -scheme MBPatrol -configuration Release -sdk iphonesimulator build
```
