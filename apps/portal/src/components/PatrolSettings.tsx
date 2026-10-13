import { Clock3, Settings2, Users } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button, ErrorNote, Field, Input, Modal, Select } from '@/components/ui';
import { TimePicker } from '@/components/TimePicker';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface PatrolSettingsData {
  patrol_guard_id: string | null;
  guard_names: string[];
  night_shift_start: string | null;
  night_shift_end: string | null;
}
export interface SecurityLogin { id: string; full_name: string; email: string | null }

function TeamEditor({ names, onApply, onClose }: { names: string[]; onApply: (names: string[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(names);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  function apply() {
    const trimmed = draft.map((name) => name.trim());
    if (trimmed.some((name) => name.length < 3 || name.length > 100) || new Set(trimmed.map((name) => name.toLowerCase())).size !== 4) {
      setError('Use four different names, each between 3 and 100 characters.'); return;
    }
    onApply(trimmed);
  }
  return createPortal(<Modal open title="Manage team" onClose={onClose} footer={<><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" onClick={apply}>Use these names</Button></>}>
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Select a guard to update their name. Existing patrol records keep the original name.</p>
      <Field label="Select guard"><Select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setError(null); }}>{draft.map((name, index) => <option key={index} value={index}>{name || `Guard ${index + 1}`}</option>)}</Select></Field>
      <Field label="Guard name"><Input value={draft[selected]} minLength={3} maxLength={100} onChange={(event) => setDraft(draft.map((name, index) => index === selected ? event.target.value : name))} /></Field>
      <p className="text-sm text-muted-foreground">Select Save shift settings afterwards to save your changes.</p>
      <ErrorNote message={error} />
    </div>
  </Modal>, document.body);
}

export function PatrolSettings({ settings, guards, onSaved }: { settings: PatrolSettingsData; guards: SecurityLogin[]; onSaved: () => void }) {
  const [guard, setGuard] = useState(settings.patrol_guard_id ?? (guards.length === 1 ? guards[0].id : ''));
  const [start, setStart] = useState(settings.night_shift_start?.slice(0, 5) ?? '');
  const [end, setEnd] = useState(settings.night_shift_end?.slice(0, 5) ?? '');
  const [names, setNames] = useState(() => Array.from({ length: 4 }, (_, index) => settings.guard_names[index] ?? ''));
  const [editingTeam, setEditingTeam] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = Boolean(settings.patrol_guard_id && settings.night_shift_start && settings.night_shift_end);
  const namesReady = names.every((name) => name.trim().length >= 3);
  const dirty = guard !== settings.patrol_guard_id || start !== settings.night_shift_start?.slice(0, 5) || end !== settings.night_shift_end?.slice(0, 5) || JSON.stringify(names) !== JSON.stringify(settings.guard_names);
  const duration = start && end ? ((Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) + 1440) % 1440 : null;

  async function save() {
    if (!guard) { setError('Choose the security login under Account settings.'); return; }
    if (!start || !end || start === end) { setError('Choose different start and end times.'); return; }
    if (!namesReady || new Set(names.map((name) => name.trim().toLowerCase())).size !== 4) { setError('Open Manage team and enter four different guard names.'); return; }
    setSaving(true); setError(null);
    try {
      const { error: saveError } = await supabase.rpc('save_daily_patrol', { p_guard_id: guard, p_start: start, p_end: end, p_guard_names: names.map((name) => name.trim()) });
      if (saveError) throw saveError;
      toast.success('Shift settings saved. Patrols are prepared automatically.');
      onSaved();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  }

  return <section id="shift-settings" className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex items-center gap-3 border-b border-border p-5"><Clock3 className="size-5 text-primary" aria-hidden="true" /><div><h2 className="text-lg">Nightly schedule</h2><p className="mt-1 text-sm text-muted-foreground">Every night · Muscat time</p></div></div>
    <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="text-sm text-muted-foreground">Each night's patrol is prepared in advance, so a night that is never started raises an alarm and is recorded as Missed. Guards can still start a patrol without it.</p>
      <div className="grid grid-cols-2 gap-3"><TimePicker label="Start time" value={start} onChange={setStart} /><TimePicker label="End time" value={end} onChange={setEnd} /></div>
      {duration !== null && duration > 0 ? <p className="text-sm text-primary">{Math.floor(duration / 60)}h {duration % 60 ? `${duration % 60}m` : ''}{end < start ? ' · ends the following morning' : ''}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3"><div className="flex items-center gap-2 text-sm"><Users className="size-4 text-primary" aria-hidden="true" /><span>{namesReady ? '4 guards available in the dropdown' : 'Add your four guards'}</span></div><Button type="button" variant="ghost" onClick={() => setEditingTeam(true)}>Manage team</Button></div>
      <ErrorNote message={error} />
      <Button type="submit" className="min-h-12 w-full" loading={saving} disabled={configured && !dirty}>Save shift settings</Button>
      {configured ? <p className="text-xs text-muted-foreground">Changes apply to upcoming patrols. A patrol already in progress keeps its original hours.</p> : null}
      <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-primary"><Settings2 className="mr-2 inline size-4" aria-hidden="true" />Account settings</summary><div className="mt-4 space-y-3"><Field label="Security login"><Select value={guard} onChange={(event) => setGuard(event.target.value)}><option value="">Choose security login</option>{guards.map((account) => <option key={account.id} value={account.id}>{account.email ?? account.full_name}</option>)}</Select></Field><Link to="/guards" className="inline-block py-2 text-sm text-primary underline">Manage login accounts</Link></div></details>
    </form>
    {editingTeam ? <TeamEditor names={names} onApply={(next) => { setNames(next); setEditingTeam(false); }} onClose={() => setEditingTeam(false)} /> : null}
  </section>;
}
