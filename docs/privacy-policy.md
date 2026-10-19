# MB Security: Web portal privacy policy

> Applies to the active web portal used by guards and supervisors. Keep this document aligned with `apps/portal/src/pages/Privacy.tsx`. The unused native application has separate capabilities.

## Who we are

MB Security is an internal tool operated by Saraya Bandar Jissah SAOC ("Muscat Bay") for security patrols within the Muscat Bay community, Sultanate of Oman. It is used only by Muscat Bay’s own security team and the Muscat Bay staff who supervise it. Every account is created by Muscat Bay.

## What we collect and why

Account details: name, work email, employee number and phone number. Used to sign you in and to identify your patrol records. Where a login is shared, the guard name chosen at the start of a patrol is recorded with that shift for the same purpose.

Checkpoint scans: the location scanned, the guard name selected for the patrol, the time on your phone and on our server, and your GPS position and its accuracy. These records help confirm that each location was visited. The browser does not report whether GPS is simulated.

Location access: the web portal requests a current GPS position when you scan, or when a supervisor chooses to use their location to place a checkpoint. It does not track your position in the background or while the app is closed.

Camera access: the web portal uses your camera to read QR codes and barcodes. The scanner does not save or upload camera images. Closing the scanner or leaving the app stops its camera stream.

Phone storage: your patrol details and scans are stored on this device so saved scans can be retried after a connection failure. Keep the app open to upload pending scans. Clearing browser storage can remove scans that have not yet uploaded.

Existing evidence: authorised supervisors can view and review stored notes, photos, voice memos, incidents and alarms. The current web scanning flow records normal visits; it does not submit photos, voice memos or SOS alerts.

Diagnostics: if crash reporting is enabled, the web portal sends error and browser information to Sentry to help diagnose failures.

Web updates: the browser downloads application files from our website and caches them for faster reopening. The web portal does not use Expo update services.

## Who can see it

Authorised Muscat Bay supervisors and administrators only. The security team’s login shows only the security team’s own patrol records. We do not sell your data or use it for advertising.

Patrol and account records are stored in the securitymuscatbay Supabase project in Singapore. The website is hosted by Vercel. Diagnostics are sent to Sentry when crash reporting is enabled.

## How long we keep it

The web portal does not create a background GPS trail. Any GPS trail records from earlier native-app use follow the configured backend retention period.

Scans, photos, voice memos, incidents and alarms: kept permanently as Muscat Bay’s security patrol records.

Account details: kept while you work on the Muscat Bay site, then deactivated.

## Your rights

Under the Oman Personal Data Protection Law (Royal Decree 6/2022) you may ask to see, correct or delete your personal data, subject to Muscat Bay’s legal and security obligations. Contact security@muscatbay.com or aalbalushi@muscatbay.com.

You can turn off camera and location access for this site in your browser settings at any time. Without camera access, labels cannot be scanned; without location access, a visit cannot be recorded and verified.

## Changes

Updates to this policy are published on this page. Last updated: 19 October 2026.
