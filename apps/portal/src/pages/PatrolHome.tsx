import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button, ErrorNote, Field, Input, Select, Spinner } from '@/components/ui';
import { TimePicker } from '@/components/TimePicker';
import { InstallPatrol } from '@/components/InstallPatrol';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { unwrap, useAsync } from '@/lib/useAsync';

interface PatrolSettings {
  patrol_guard_id: string | null;
  guard_names: string[];
  night_shift_start: string | null;
  night_shift_end: string | null;
}
interface SecurityLogin { id: string; full_name: string; email: string | null }

function PatrolSetup({ settings, guards, onSaved }: {
  settings: PatrolSettings; guards: SecurityLogin[]; onSaved: () => void;
}) {
  const [guard, setGuard] = useState(settings.patrol_guard_id ?? (guards.length === 1 ? guards[0].id : ''));
  const [start, setStart] = useState(settings.night_shift_start?.slice(0, 5) ?? '');
  const [end, setEnd] = useState(settings.night_shift_end?.slice(0, 5) ?? '');
  const [names, setNames] = useState(() => Array.from({ length: 4 }, (_, index) => settings.guard_names[index] ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!guard || !start || !end || start === end) {
      setError('Choose the security login and different start and end times.');
      return;
    }
    if (names.some((name) => name.trim().length < 3) || new Set(names.map((name) => name.trim().toLowerCase())).size !== 4) {
      setError('Enter four different guard names.'); return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: saveError } = await supabase.rpc('save_daily_patrol', { p_guard_id: guard, p_start: start, p_end: end, p_guard_names: names.map((name) => name.trim()) });
      if (saveError) throw saveError;
      toast.success('Saved. Patrols will be prepared automatically every night.');
      onSaved();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  }

  return (
    <form className="max-w-xl space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2 className="text-xl">Night patrol setup</h2>
      <p className="text-sm text-muted-foreground">Save once. Every active location is included each night.</p>
      <Field label="Security login">
        <Select value={guard} onChange={(event) => setGuard(event.target.value)} required>
          <option value="">Choose security login</option>
          {guards.map((account) => <option key={account.id} value={account.id}>{account.email ?? account.full_name}</option>)}
        </Select>
      </Field>
      {!guards.length ? <p>No security login yet. <Link to="/guards" className="text-primary underline">Add an account</Link>.</p> : null}
      <div className="grid grid-cols-2 gap-4">
        <TimePicker label="Start time" value={start} onChange={setStart} />
        <TimePicker label="End time" value={end} onChange={setEnd} />
      </div>
      {start && end && end < start ? <p className="text-sm">Ends the following morning.</p> : null}
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">The four guards</legend>
        <p className="text-sm text-muted-foreground">The guard selects their name at the start of each night. Edit this list whenever the team changes.</p>
        {names.map((name, index) => <Field key={index} label={`Guard ${index + 1}`}><Input required minLength={3} maxLength={100} value={name} onChange={(event) => setNames(names.map((current, position) => position === index ? event.target.value : current))} /></Field>)}
      </fieldset>
      <ErrorNote message={error} />
      <Button type="submit" loading={saving}>Save patrol setup</Button>
      {settings.patrol_guard_id ? <p className="text-sm text-muted-foreground">Changes apply to upcoming patrols. A patrol already under way keeps its original hours and locations.</p> : null}
    </form>
  );
}

export default function PatrolHomePage() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [settings, guards, locations] = await Promise.all([
      supabase.from('app_settings').select('patrol_guard_id, night_shift_start, night_shift_end, guard_names').eq('id', 1).single<PatrolSettings>(),
      supabase.from('profiles').select('id, full_name, email').eq('active', true).eq('role', 'guard').order('full_name').returns<SecurityLogin[]>(),
      supabase.from('checkpoints').select('id', { count: 'exact', head: true }).eq('active', true),
    ]);
    if (locations.error) throw locations.error;
    if (locations.count === null) throw new Error('Could not load the number of patrol locations. Try again.');
    return { settings: unwrap(settings), guards: unwrap(guards), count: locations.count };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div><h1 className="text-2xl">Night patrol</h1><p className="mt-2 text-muted-foreground">Guards visit each location once and scan its label.</p></div>
      <div className="flex flex-wrap gap-3">
        <Link to="/checkpoints" className="rounded-md bg-primary px-5 py-3 font-semibold text-white">Locations & QR labels</Link>
        <Link to="/reports" className="rounded-md border border-border px-5 py-3 font-semibold text-primary">View reports</Link>
      </div>
      <ErrorNote message={error} />
      {error ? <Button variant="outline" onClick={() => void reload()}>Try again</Button> : null}
      {loading ? <Spinner /> : data ? (
        <>
          <p>{data.count ? `${data.count} active location${data.count === 1 ? '' : 's'} will be included automatically.` : 'Add your locations and print their labels to begin.'}</p>
          <PatrolSetup key={JSON.stringify(data.settings)} settings={data.settings} guards={data.guards} onSaved={() => void reload()} />
          {data.settings.patrol_guard_id && data.count > 0 ? <section className="space-y-3 border-t border-border pt-6">
            <h2 className="text-xl">Ready for the security team</h2>
            <p>Open the link below on the guard’s phone. Sign in with the security login, choose the guard’s name and tap <strong>Start scanning</strong>.</p>
            <a href="/guard" className="block break-words text-primary underline">{window.location.origin}/guard</a>
            <p className="text-sm text-muted-foreground">Your manager account opens this setup page. The security account opens the scanner.</p>
          </section> : null}
        </>
      ) : null}
      <InstallPatrol />
      <Link to="/guards" className="inline-block text-sm text-primary underline">Manage login accounts</Link>
    </div>
  );
}
