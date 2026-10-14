import { Clock3, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorNote, Field, Select } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export function GuardShiftStart({ names, endTime, disabled, onStarted }: {
  names: string[]; endTime: string | null; disabled: boolean; onStarted: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultEnd = endTime?.slice(0, 5) ?? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Muscat', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + 12 * 3600000));

  async function begin() {
    if (!name) { setError('Choose your name to start.'); return; }
    setSaving(true); setError(null);
    try {
      const { data, error: startError } = await supabase.rpc('start_patrol_now', { p_on_duty_name: name, p_end: null }).abortSignal(AbortSignal.timeout(15000));
      if (startError) throw startError;
      if (!data) throw new Error('The shift was not confirmed. Please try again.');
      await onStarted();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
    <h2 className="text-xl">Ready for your patrol?</h2>
    <p className="text-sm text-muted-foreground">Choose your name, then scan the QR label at each location.</p>
    <Field label="Guard on duty"><Select className="min-h-12 text-base" value={name} onChange={(event) => setName(event.target.value)} disabled={saving}><option value="">Choose your name</option>{names.map((guard) => <option key={guard} value={guard}>{guard}</option>)}</Select></Field>
    <div className="flex gap-3 rounded-xl bg-secondary-light p-4 text-primary"><Clock3 className="size-5 shrink-0" aria-hidden="true" /><div><p className="font-medium">Nothing to finish</p><p className="mt-1 text-sm">Your patrol starts now and ends by itself at {defaultEnd}. Every scan records its time and GPS position.</p></div></div>
    <ErrorNote message={error} />
    <Button className="min-h-14 w-full text-base" icon={ScanLine} loading={saving} disabled={disabled || !name} onClick={() => void begin()}>Start scanning</Button>
  </section>;
}
