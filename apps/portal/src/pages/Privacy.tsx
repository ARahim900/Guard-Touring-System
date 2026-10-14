// Public privacy policy page (no login). The app stores require a public URL:
// use https://<your-portal>.netlify.app/privacy.
// Keep identical to the in-app screen (apps/guard/src/app/privacy.tsx).
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Who we are',
    body: [
      'MB Patrol is an internal tool operated by Saraya Bandar Jissah SAOC ("Muscat Bay") for security patrols within the Muscat Bay community, Sultanate of Oman. It is used only by Muscat Bay’s own security team and the Muscat Bay staff who supervise it. Every account is created by Muscat Bay.',
    ],
  },
  {
    title: 'What we collect and why',
    body: [
      'Account details: name, work email, employee number and phone number. Used to sign you in and to identify your patrol records. Where a login is shared, the guard name chosen at the start of a patrol is recorded with that shift for the same purpose.',
      'Checkpoint scans: the checkpoint, the time on your phone and on our server, your GPS position and its accuracy, and whether the phone reported a simulated ("mock") location. Used to confirm that each checkpoint was visited.',
      'Location during shifts: while your shift is active, your position is recorded about once a minute, including when the app is closed or not in use, so supervisors can see patrol progress and respond to an SOS. Location is never collected outside an active shift. Tracking stops when the patrol ends, which happens automatically at the end of the shift.',
      'Photos, voice memos and notes that you choose to attach to a scan. Gallery photos are checked against the date they were taken, so photos taken before your shift can be reviewed.',
      'SOS alerts, including your position at the time.',
      'Crash reports (device model, operating system, app version, error details) sent to our crash-reporting provider, Sentry. These do not include your name, email or location.',
      'App update checks: the guard app checks for updates with Expo, our app update service. Each check sends an anonymous app installation ID, the app version and the phone’s operating system. It does not include your name, email or location.',
    ],
  },
  {
    title: 'Who can see it',
    body: [
      'Authorised Muscat Bay supervisors and administrators only. The security team’s login shows only the security team’s own patrol records. We do not sell your data or use it for advertising.',
      'Data is stored with our hosting provider, Supabase, and crash reports with Sentry, under contracts that protect it.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'GPS trail recorded during shifts: deleted automatically after 90 days.',
      'Scans, photos, voice memos, incidents and alarms: kept permanently as Muscat Bay’s security patrol records.',
      'Account details: kept while you work on the Muscat Bay site, then deactivated.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'Under the Oman Personal Data Protection Law (Royal Decree 6/2022) you may ask to see, correct or delete your personal data, subject to Muscat Bay’s legal and security obligations. Contact security@muscatbay.com or aalbalushi@muscatbay.com.',
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
          <span className="flex size-11 items-center justify-center rounded-md bg-white p-1.5">
            <img src="/muscat-bay-mark.png" alt="Muscat Bay" className="size-full" />
          </span>
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
