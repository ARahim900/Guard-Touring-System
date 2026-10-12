// Public privacy policy page (no login). The app stores require a public URL:
// use https://<your-portal>.netlify.app/privacy.
// Keep identical to the in-app screen (apps/guard/src/app/privacy.tsx).
import { ShieldCheck } from 'lucide-react';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Who we are',
    body: [
      'MB Patrol is an internal tool operated by [Muscat Bay legal entity name] ("Muscat Bay") for security patrols within the Muscat Bay community, Sultanate of Oman. It is used only by guards whose accounts are created by Muscat Bay or its security contractors.',
    ],
  },
  {
    title: 'What we collect and why',
    body: [
      'Account details: name, work email, employee number, phone number and contractor. Used to sign you in and to identify your patrol records.',
      'Checkpoint scans: the checkpoint, the time on your phone and on our server, your GPS position and its accuracy, and whether the phone reported a simulated ("mock") location. Used to confirm that each checkpoint was visited.',
      'Location during shifts: while your shift is active, your position is recorded about once a minute, including when the app is closed or not in use, so supervisors can see patrol progress and respond to an SOS. Location is never collected outside an active shift. Tracking stops when you end your shift.',
      'Photos, voice memos and notes that you choose to attach to a scan. Gallery photos are checked against the date they were taken, so photos taken before your shift can be reviewed.',
      'SOS alerts, including your position at the time.',
      'Crash reports (device model, operating system, app version, error details) sent to our crash-reporting provider, Sentry. These do not include your name, email or location.',
    ],
  },
  {
    title: 'Who can see it',
    body: [
      'Muscat Bay supervisors and administrators, and supervisors of your own security contractor. Monthly performance reports are shared with your contractor. We do not sell your data or use it for advertising.',
      'Data is stored with our hosting provider, Supabase, and crash reports with Sentry, under contracts that protect it.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'GPS trail recorded during shifts: deleted automatically after 90 days.',
      'Scans, photos, voice memos, incidents and alarms: kept as patrol records for [retention period, e.g. 3 years] and then deleted, unless needed for an investigation.',
      'Account details: kept while you work on the Muscat Bay site, then deactivated.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'Under the Oman Personal Data Protection Law (Royal Decree 6/2022) you may ask to see, correct or delete your personal data, subject to Muscat Bay’s legal and security obligations. Contact [privacy contact email].',
      'You can turn off location, camera, microphone or photo access in your phone settings at any time. Without location, scans cannot be verified.',
    ],
  },
  { title: 'Changes', body: ['We will show any change to this policy in the app. Last updated: [date of release].'] },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-full bg-background">
      <header className="bg-primary px-6 py-6 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <ShieldCheck className="size-8 text-secondary" />
          <div>
            <p className="text-lg font-bold">MB Patrol</p>
            <p className="text-sm opacity-80">Privacy policy</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 text-lg">{s.title}</h2>
            <div className="space-y-2 text-[15px] leading-relaxed">
              {s.body.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
