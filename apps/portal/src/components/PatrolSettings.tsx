import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button, ErrorNote, Field, Input, Modal, Select } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface PatrolSettingsData {
  patrol_guard_id: string | null;
  guard_names: string[];
}
export interface SecurityLogin { id: string; full_name: string; email: string | null }

function TeamEditor({ settings, guards, onSaved, onClose }: {
  settings: PatrolSettingsData; guards: SecurityLogin[]; onSaved: (settings: PatrolSettingsData) => void; onClose: () => void;
}) {
  const [names, setNames] = useState(() => Array.from({ length: 4 }, (_, index) => settings.guard_names[index] ?? ''));
  const initialGuard = settings.patrol_guard_id ?? (guards.length === 1 ? guards[0].id : '');
  const [guard, setGuard] = useState(initialGuard);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = guard !== initialGuard || JSON.stringify(names) !== JSON.stringify(Array.from({ length: 4 }, (_, index) => settings.guard_names[index] ?? ''));

  function close() {
    if (saving) return;
    if (dirty) setDiscarding(true);
    else onClose();
  }

  async function save() {
    const trimmed = names.map((name) => name.trim());
    if (!guard) { setError('Choose the security login for this team.'); return; }
    if (trimmed.some((name) => name.length < 3 || name.length > 100) || new Set(trimmed.map((name) => name.toLowerCase())).size !== 4) {
      setError('Use four different names, each between 3 and 100 characters.'); return;
    }
    setSaving(true); setError(null);
    try {
      const { error: saveError } = await supabase.rpc('save_patrol_team', { p_guard_id: guard, p_guard_names: trimmed });
      if (saveError) throw saveError;
      onSaved({ patrol_guard_id: guard, guard_names: trimmed });
      toast.success('Patrol team saved.');
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setSaving(false); }
  }

  return <Modal open title={discarding ? 'Discard team changes?' : 'Manage team'} onClose={close} footer={discarding ? <>
    <Button variant="outline" onClick={() => setDiscarding(false)}>Keep editing</Button>
    <Button variant="danger" onClick={onClose}>Discard changes</Button>
  </> : <>
    <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
    <Button type="submit" form="patrol-team-form" loading={saving} disabled={!dirty && Boolean(settings.patrol_guard_id && settings.guard_names.length === 4)}>Save team</Button>
  </>}>
    {discarding ? <p>Your changes have not been saved. Discard them or return to editing.</p> : <form id="patrol-team-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!saving) void save(); }}>
      <p className="text-sm text-muted-foreground">Update the four names guards choose when starting a patrol. Existing patrol records keep the original names.</p>
      <fieldset disabled={saving} className="space-y-4">
        <legend className="sr-only">Team details</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {names.map((name, index) => <Field key={index} label={`Guard ${index + 1} name`}><Input value={name} required minLength={3} maxLength={100} autoComplete="off" onChange={(event) => setNames((previous) => previous.map((value, i) => i === index ? event.target.value : value))} /></Field>)}
        </div>
        <Field label="Security login" hint="The shared account these guards use to sign in."><Select value={guard} onChange={(event) => setGuard(event.target.value)}><option value="">Choose security login</option>{guards.map((account) => <option key={account.id} value={account.id}>{account.email ?? account.full_name}</option>)}</Select></Field>
      </fieldset>
      <ErrorNote message={error} />
      {saving ? <p role="status" className="text-sm text-muted-foreground">Saving your team…</p> : null}
    </form>}
  </Modal>;
}

export function PatrolSettings({ settings, guards, onSaved }: { settings: PatrolSettingsData; guards: SecurityLogin[]; onSaved: () => void }) {
  const [current, setCurrent] = useState(settings);
  const [editingTeam, setEditingTeam] = useState(false);
  useEffect(() => { setCurrent(settings); }, [settings]);
  const login = guards.find((account) => account.id === current.patrol_guard_id);
  return <section className="rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
      <div className="flex items-center gap-3"><Users className="size-5 text-primary" aria-hidden="true" /><div><h2 className="text-lg">Patrol team</h2><p className="mt-1 text-sm text-muted-foreground">Patrols start any time and last 12 hours</p></div></div>
      <Button variant="outline" onClick={() => setEditingTeam(true)}>Manage team</Button>
    </div>
    <div className="space-y-4 p-5">
      {current.guard_names.length ? <ul className="flex flex-wrap gap-2" aria-label="Current guard names">{current.guard_names.map((name) => <li key={name} className="rounded-full bg-muted px-3 py-2 text-sm">{name}</li>)}</ul> : <p className="text-sm">Add the four guard names before the team starts patrolling.</p>}
      <p className="break-words text-sm text-muted-foreground">Security login: {login?.email ?? login?.full_name ?? 'Not configured'}</p>
      <Link to="/guards" className="inline-flex min-h-11 items-center text-sm text-primary underline">Manage login accounts</Link>
    </div>
    {editingTeam ? <TeamEditor settings={current} guards={guards} onSaved={(next) => { setCurrent(next); setEditingTeam(false); onSaved(); }} onClose={() => setEditingTeam(false)} /> : null}
  </section>;
}
