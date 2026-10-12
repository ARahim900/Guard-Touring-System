// =============================================================================
// Routes: an ordered list of checkpoints, each with a target time expressed
// as "minutes after the shift starts". Example: a 22:00 shift with offsets
// 0, 20, 45 expects checkpoints at 22:00, 22:20 and 22:45 (+ grace period).
//
// Editing rule (enforced in the database): shifts that have already started
// keep the checkpoints they were patrolled against, so past reports never
// change. Shifts not yet started pick up your changes automatically.
// =============================================================================
import { ArrowDown, ArrowUp, Plus, Route as RouteIcon, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Checkpoint, Contractor, Route, RouteCheckpoint } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

interface Draft {
  id?: string;
  name: string;
  description: string;
  contractor_id: string;
  active: boolean;
  items: { checkpoint_id: string; due_offset_min: number }[];
}

export default function RoutesPage() {
  const routes = useAsync(async () => unwrap(await supabase.from('routes').select('*, route_checkpoints(count)').order('name')) as Route[], []);
  const checkpoints = useAsync(async () => unwrap(await supabase.from('checkpoints').select('*').order('name')) as Checkpoint[], []);
  const contractors = useAsync(async () => unwrap(await supabase.from('contractors').select('*').order('name')) as Contractor[], []);

  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addId, setAddId] = useState('');

  // Load the chosen route into the editor.
  useEffect(() => {
    if (selected === null) return setDraft(null);
    if (selected === 'new') return setDraft({ name: '', description: '', contractor_id: '', active: true, items: [] });
    setLoadingDraft(true);
    (async () => {
      const r = routes.data?.find((x) => x.id === selected);
      const { data, error } = await supabase.from('route_checkpoints').select('*').eq('route_id', selected).order('sequence');
      setLoadingDraft(false);
      if (error || !r) return toast.error(friendlyError(error));
      setDraft({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        contractor_id: r.contractor_id ?? '',
        active: r.active,
        items: (data as RouteCheckpoint[]).map((rc) => ({ checkpoint_id: rc.checkpoint_id, due_offset_min: rc.due_offset_min })),
      });
    })();
  }, [selected, routes.data]);

  const cpName = (id: string) => checkpoints.data?.find((c) => c.id === id)?.name ?? '…';
  const available = (checkpoints.data ?? []).filter((c) => c.active && !draft?.items.some((i) => i.checkpoint_id === c.id));

  function move(i: number, dir: -1 | 1) {
    if (!draft) return;
    const items = [...draft.items];
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setDraft({ ...draft, items });
  }

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 2) return toast.error('Enter a route name.');
    if (!draft.items.length) return toast.error('Add at least one checkpoint.');
    setSaving(true);
    try {
      const row = { name: draft.name.trim(), description: draft.description.trim() || null, contractor_id: draft.contractor_id || null, active: draft.active };
      let routeId = draft.id;
      if (routeId) {
        unwrap(await supabase.from('routes').update(row).eq('id', routeId).select('id'));
      } else {
        routeId = (unwrap(await supabase.from('routes').insert(row).select('id').single()) as { id: string }).id;
      }
      // Remove checkpoints taken off the route, then write the current list.
      const keep = draft.items.map((i) => i.checkpoint_id);
      let del = supabase.from('route_checkpoints').delete().eq('route_id', routeId);
      if (keep.length) del = del.not('checkpoint_id', 'in', `(${keep.join(',')})`);
      unwrap(await del.select('route_id'));
      unwrap(
        await supabase
          .from('route_checkpoints')
          .upsert(
            draft.items.map((it, idx) => ({ route_id: routeId, checkpoint_id: it.checkpoint_id, sequence: idx + 1, due_offset_min: it.due_offset_min })),
            { onConflict: 'route_id,checkpoint_id' },
          )
          .select('route_id'),
      );
      toast.success('Route saved. Shifts not yet started now use this version.');
      await routes.reload({ silent: true });
      setSelected(routeId!);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Routes" subtitle="Order the checkpoints and set when each one is due." actions={<Button icon={Plus} onClick={() => setSelected('new')}>New route</Button>} />
      <div className="grid gap-[14px] lg:grid-cols-[320px_1fr]">
        <Card>
          <ErrorNote message={routes.error} />
          {routes.loading ? (
            <Spinner />
          ) : !routes.data?.length ? (
            <EmptyState icon={RouteIcon} title="No routes yet" />
          ) : (
            <ul className="-mx-2 space-y-1">
              {routes.data.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selected === r.id ? 'bg-secondary-light font-semibold text-primary' : 'hover:bg-muted'}`}
                  >
                    <span>{r.name}</span>
                    <span className="flex items-center gap-2">
                      {!r.active ? <Badge label="Inactive" /> : null}
                      <span className="text-xs text-muted-foreground">{r.route_checkpoints?.[0]?.count ?? 0} pts</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={draft ? (draft.id ? 'Edit route' : 'New route') : undefined}>
          {loadingDraft ? (
            <Spinner />
          ) : !draft ? (
            <EmptyState icon={RouteIcon} title="Select a route" message="Choose a route on the left, or create a new one." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Route name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Marina night patrol" /></Field>
                <Field label="Contractor (optional)">
                  <Select value={draft.contractor_id} onChange={(e) => setDraft({ ...draft, contractor_id: e.target.value })}>
                    <option value="">Any</option>
                    {contractors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Description (optional)"><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
              </label>

              <div>
                <p className="mb-2 text-sm font-semibold">Checkpoints in patrol order</p>
                {draft.items.length === 0 ? <p className="text-sm text-muted-foreground">No checkpoints yet.</p> : null}
                <ol className="space-y-2">
                  {draft.items.map((it, i) => (
                    <li key={it.checkpoint_id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                      <span className="flex size-7 items-center justify-center rounded-full bg-secondary-light text-sm font-bold text-primary">{i + 1}</span>
                      <span className="min-w-40 flex-1 font-medium">{cpName(it.checkpoint_id)}</span>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Due at shift start +
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-20"
                          value={it.due_offset_min}
                          onChange={(e) => {
                            const items = [...draft.items];
                            items[i] = { ...it, due_offset_min: Math.max(0, Number(e.target.value) || 0) };
                            setDraft({ ...draft, items });
                          }}
                        />
                        min
                      </label>
                      <Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}><ArrowUp className="size-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === draft.items.length - 1}><ArrowDown className="size-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, k) => k !== i) })} aria-label="Remove"><Trash2 className="size-4 text-danger-text" /></Button>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex gap-2">
                  <Select value={addId} onChange={(e) => setAddId(e.target.value)} className="max-w-sm">
                    <option value="">Add a checkpoint…</option>
                    {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Button
                    variant="outline"
                    icon={Plus}
                    disabled={!addId}
                    onClick={() => {
                      const last = draft.items[draft.items.length - 1]?.due_offset_min ?? -15;
                      setDraft({ ...draft, items: [...draft.items, { checkpoint_id: addId, due_offset_min: last + 15 }] });
                      setAddId('');
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button icon={Save} loading={saving} onClick={() => void save()}>Save route</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
