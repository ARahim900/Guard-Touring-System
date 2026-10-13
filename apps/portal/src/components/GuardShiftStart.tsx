import { ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorNote, Field, Select } from '@/components/ui';
import { TimePicker } from '@/components/TimePicker';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export function GuardShiftStart({ names, startTime, endTime, disabled, onStarted }: {
  names: string[]; startTime: string | null; endTime: string | null; disabled: boolean; onStarted: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(startTime?.slice(0, 5) ?? '');
  const [end, setEnd] = useState(endTime?.slice(0, 5) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    if (!name || !start || !end || start === end) { setError('Choose your name and different start and end times.'); return; }
    setSaving(true); setError(null);
    try {
      const { data, error: startError } = await supabase.rpc('start_my_patrol', { p_start: start, p_end: end, p_on_duty_name: name }).abortSignal(AbortSignal.timeout(15000));
      if (startError) throw startError;
      if (!data) throw new Error('The shift was not confirmed. Please try again.');
      await onStarted();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  }

  return <section className="space-y-4 rounded-xl border border-border bg-card p-5">
    <h2 className="text-xl">Start your patrol</h2>
    <p className="text-sm text-muted-foreground">Choose your name and this shift’s hours. No manager assignment is needed.</p>
    <Field label="Guard on duty"><Select className="min-h-12 text-base" value={name} onChange={(event) => setName(event.target.value)} disabled={saving}><option value="">Choose your name</option>{names.map((guard) => <option key={guard} value={guard}>{guard}</option>)}</Select></Field>
    <div className="grid grid-cols-2 gap-3"><TimePicker label="Start time" value={start} onChange={setStart} /><TimePicker label="End time" value={end} onChange={setEnd} /></div>
    <p className="text-sm text-muted-foreground">Muscat time. Choose hours that include now.{start && end && end < start ? ' This shift crosses midnight.' : ''} Hours and name are kept once the patrol starts.</p>
    <ErrorNote message={error} />
    <Button className="min-h-14 w-full text-base" icon={ScanLine} loading={saving} disabled={disabled || !name || !start || !end} onClick={() => void begin()}>Start scanning</Button>
  </section>;
}
