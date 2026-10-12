import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button, Card, ErrorNote, Field, Input } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface ShiftHours { night_shift_start: string | null; night_shift_end: string | null }

export function NightShiftHours({ hours, loading, error, onSaved }: { hours: ShiftHours | null; loading: boolean; error: string | null; onSaved: (hours: ShiftHours) => void }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStart(hours?.night_shift_start?.slice(0, 5) ?? '');
    setEnd(hours?.night_shift_end?.slice(0, 5) ?? '');
  }, [hours]);

  async function save() {
    if (!start || !end || start === end) return toast.error('Choose different start and end times.');
    setSaving(true);
    try {
      const { error: saveError } = await supabase.rpc('set_night_shift_hours', { p_start: start, p_end: end });
      if (saveError) throw saveError;
      onSaved({ night_shift_start: start, night_shift_end: end });
      toast.success('Default night-shift hours saved. Existing shifts are unchanged.');
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Default night-shift hours" className="mb-[14px]">
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Start (Muscat)"><Input type="time" value={start} disabled={loading || saving} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End (Muscat)" hint={start && end && end < start ? 'Ends the following day' : undefined}><Input type="time" value={end} disabled={loading || saving} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Button icon={Save} disabled={loading || Boolean(error)} loading={saving} onClick={() => void save()}>Save hours</Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Used when creating new shifts. You can adjust each new shift before saving. Every location is due by that shift’s end.</p>
    </Card>
  );
}
