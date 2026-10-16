# MB Patrol: supervisor iPhone app

A thin iPhone app around the live supervisor portal
(`https://securitymbpatrolling.netlify.app`). The portal itself is the app, so
every Netlify deploy of `main` reaches the phone with no new build.

What the app adds to the website:
- Home Screen icon and splash in the brand colours.
- The notch and home-indicator areas are filled in the top-bar purple and the
  bottom-bar white.
- PDF, CSV and label exports open the iPhone share sheet (Save to Files, Mail,
  AirDrop), because a web view cannot download files itself.
- Links outside the portal open in an in-app browser.

## Release a new build to TestFlight

Only needed when this folder changes (icon, name, permissions, native code).

```bash
cd apps/portal-ios
npm ci
npx eas-cli build -p ios --profile production --auto-submit
```

- Expo project: `@arpro900/mb-patrol-portal`. Bundle ID: `com.muscatbay.patrol.supervisor`.
- App Store Connect app ID `6823613060` is set in `eas.json`, so builds after the first one run without an Apple sign-in.
- Distribution is private: TestFlight internal testers only, never the public App Store.
- A TestFlight build expires 90 days after upload.

## Local check

```bash
LANG=en_US.UTF-8 npx expo run:ios --configuration Release
```

Use a Release build. Expo Go treats the "r" key as reload, so typing in web forms restarts the app.
