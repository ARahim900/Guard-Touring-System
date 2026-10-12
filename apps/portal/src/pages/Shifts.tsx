// =============================================================================
// Schedules: assign a guard to a route for a time window.
// "Repeat for N days" creates the same shift on consecutive days in one go.
// Night shifts that end after midnight are handled automatically: if the end
// time is earlier than the start time, it is taken as the next day.
// =============================================================================
import { Ban, CalendarClock, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { SHIFT_STATUS } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { addDays, dayKey, dayRange, formatDay, formatTime, muscatInstant } from '@/lib/time';
import type { Profile, Route, Shift } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

interface Form {
  guard_id: string;
  route_id: string;
  date: string;
  start: string;
  end: string;
  repeat: number;
  notes: string;
}

export default function ShiftsPage() {
  const { profile } = useAuth();
  const [weekStart, setWeekStart] = useState(dayKey());
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const guards = useAsync(async () => unwrap(await supabase.from('profiles').select('id, full_name').eq('role', 'guard').eq('active', true).order('full_name')) as Profile[], []);
  const routes = useAsync(async () => unwrap(await supabase.from('routes').select('id, name, active').eq('active', true).order('name')) as Route[], []);

  const { data, loading, error, reload } = useAsync(async () => {
    const from = dayRange(weekStart).from;
    const to = dayRange(addDays(weekStart, 6)).to;
    return unwrap(
      await supabase
        .from('shifts')
        .select('*, profiles!shifts_guard_id_fkey(full_name), routes(name)')
        .gte('scheduled_start', from)
        .lt('scheduled_start', to)
        .order('scheduled_start'),
    ) as Shift[];
  }, [weekStart]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  async function save() {
    if (!form) return;
    if (!form.guard_id || !form.route_id) return toast.error('Choose a guard and a route.');
    if (!form.start || !form.end) return toast.error('Set start and end times.');
    const repeat = Math.min(Math.max(1, form.repeat), 62);
    const rows = Array.from({ length: repeat }, (_, i) => {
      const date = addDays(form.date, i);
      const start = muscatInstant(date, form.start);
      let end = muscatInstant(date, form.end);
      if (end <= start) end = new Date(end.getTime() + 86400000); // overnight shift
      return {
        guard_id: form.guard_id,
        route_id: form.route_id,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        notes: form.notes.trim() || null,
        created_by: profile!.id,
      };
    });

    // Warn about overlaps with existing shifts of the same guard.
    const { data: clash } = await supabase
      .from('shifts')
      .select('id, scheduled_start, scheduled_end')
      .eq('guard_id', form.guard_id)
      .neq('status', 'cancelled')
      .lt('scheduled_start', rows[rows.length - 1].scheduled_end)
      .gt('scheduled_end', rows[0].scheduled_start);
    // Two shifts overlap when each starts before the other ends.
    const overlaps = (clash ?? []).filter((c) =>
      rows.some((r) => new Date(c.scheduled_start) < new Date(r.scheduled_end) && new Date(c.scheduled_end) > new Date(r.scheduled_start)),
    );
    if (overlaps.length && !window.confirm(`This guard already has ${overlaps.length} shift(s) around these times. Create anyway?`)) return;

    setSaving(true);
    const { error: e } = await supabase.from('shifts').insert(rows);
    setSaving(false);
    if (e) return toast.error(friendlyError(e));
    toast.success(repeat > 1 ? `${repeat} shifts created.` : 'Shift created.');
    setForm(null);
    void reload({ silent: true });
  }

  async function cancel(s: Shift) {
    if (!window.confirm(`Cancel ${s.profiles?.full_name}'s shift on ${formatDay(s.scheduled_start)}?`)) return;
    const { error: e } = await supabase.from('shifts').update({ status: 'cancelled' }).eq('id', s.id);
    if (e) return toast.error(friendlyError(e));
    toast.success('Shift cancelled.');
    void reload({ silent: true });
  }

  async function remove(s: Shift) {
    if (!window.confirm('Delete this shift permanently? Only shifts that have not started can be deleted.')) return;
    const { error: e, count } = await supabase.from('shifts').delete({ count: 'exact' }).eq('id', s.id);
    if (e || !count) return toast.error(e ? friendlyError(e) : 'Only scheduled shifts can be deleted. Cancel it instead.');
    toast.success('Shift deleted.');
    void reload({ silent: true });
  }

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Shifts for the week. Times are Muscat time."
        actions={
          <Button icon={Plus} onClick={() => setForm({ guard_id: '', route_id: '', date: weekStart, start: '22:00', end: '06:00', repeat: 1, notes: '' })}>
            New shift
          </Button>
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft className="size-4" /></Button>
          <Input type="date" value={weekStart} onChange={(e) => e.target.value && setWeekStart(e.target.value)} className="w-44" />
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight className="size-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(dayKey())}>Today</Button>
          <span className="text-sm text-muted-foreground">{formatDay(`${weekStart}T12:00:00+04:00`)} – {formatDay(`${addDays(weekStart, 6)}T12:00:00+04:00`)}</span>
        </div>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={CalendarClock} title="No shifts this week" message="Create shifts with “New shift”. Use “Repeat” to fill several days at once." />
        ) : (
          <div className="space-y-6">
            {days.map((d) => {
              const list = data.filter((s) => dayKey(s.scheduled_start) === d);
              if (!list.length) return null;
              return (
                <div key={d}>
                  <h3 className="mb-2 text-sm">{formatDay(`${d}T12:00:00+04:00`)}</h3>
                  <Table head={['Time', 'Guard', 'Route', 'Status', 'Started / ended', '']}>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <Td className="whitespace-nowrap">{formatTime(s.scheduled_start)} – {formatTime(s.scheduled_end)}</Td>
                        <Td className="font-medium">{s.profiles?.full_name}</Td>
                        <Td>{s.routes?.name}</Td>
                        <Td><Badge {...SHIFT_STATUS[s.status]} /></Td>
                        <Td className="text-xs text-muted-foreground">
                          {s.actual_start ? formatTime(s.actual_start) : '–'} / {s.actual_end ? formatTime(s.actual_end) : '–'}
                          {s.notes ? <span className="block">{s.notes}</span> : null}
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          {s.status === 'scheduled' ? (
                            <>
                              <Button size="sm" variant="ghost" icon={Ban} onClick={() => void cancel(s)}>Cancel</Button>
                              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(s)}>Delete</Button>
                            </>
                          ) : s.status === 'active' ? (
                            <Button size="sm" variant="ghost" icon={Ban} onClick={() => void cancel(s)}>Cancel</Button>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(form)}
        title="New shift"
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>Create</Button>
          </>
        }
      >
        {form ? (
          <div className="space-y-3">
            <Field label="Guard">
              <Select value={form.guard_id} onChange={(e) => setForm({ ...form, guard_id: e.target.value })}>
                <option value="">Choose…</option>
                {guards.data?.map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Route">
              <Select value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
                <option value="">Choose…</option>
                {routes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="First date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Start"><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
              <Field label="End" hint={form.end <= form.start ? 'Ends next day' : undefined}><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
            </div>
            <Field label="Repeat for how many days?" hint="1 = this date only. Maximum 62.">
              <Input type="number" min={1} max={62} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="Notes (optional)"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
