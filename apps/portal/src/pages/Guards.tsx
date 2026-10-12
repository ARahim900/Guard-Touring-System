// =============================================================================
// Guards & users. Logins are created here (there is no self sign-up).
// Creating a login, resetting a password and disabling an account go through
// the "admin-users" Edge Function, which holds the powerful service key on
// the server. Name, phone, employee number and contractor are saved directly
// (protected by Row Level Security).
// =============================================================================
import { KeyRound, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Contractor, Profile, UserRole } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

/** Call the admin-users Edge Function and surface its error message. */
async function callAdmin(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const json = ctx ? await ctx.json() : null;
      if (json?.error) msg = json.error;
    } catch {
      // keep the generic message
    }
    return { ok: false, error: msg };
  }
  return { ok: true, ...(data as object) };
}

/** Readable random password, e.g. "Patrol-4821-Kx7m". */
function suggestPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint32Array(8));
  const part = Array.from(rnd.slice(0, 4), (n) => chars[n % chars.length]).join('');
  return `Patrol-${1000 + (rnd[4] % 9000)}-${part}`;
}

interface NewUser {
  full_name: string;
  email: string;
  password: string;
  role: UserRole;
  contractor_id: string;
  employee_no: string;
  phone: string;
}

export default function GuardsPage() {
  const { isAdmin, profile: me } = useAuth();
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('guard');
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState<NewUser | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const contractors = useAsync(async () => unwrap(await supabase.from('contractors').select('*').order('name')) as Contractor[], []);
  const { data, loading, error, reload } = useAsync(async () => {
    let q = supabase.from('profiles').select('*, contractors(name)').order('full_name');
    if (roleFilter !== 'all') q = q.eq('role', roleFilter);
    if (!showInactive) q = q.eq('active', true);
    return unwrap(await q) as Profile[];
  }, [roleFilter, showInactive]);

  const canManage = (p: Profile) => isAdmin || p.role === 'guard';
  const roles = useMemo<UserRole[]>(() => (isAdmin ? ['guard', 'supervisor', 'admin'] : ['guard']), [isAdmin]);

  async function create() {
    if (!creating) return;
    setBusy(true);
    const res = await callAdmin({ action: 'create', ...creating, contractor_id: creating.contractor_id || null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? 'Could not create the account.');
    toast.success(`Account created for ${creating.full_name}. Share the password securely.`);
    setCreating(null);
    void reload({ silent: true });
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    const { error: e } = await supabase
      .from('profiles')
      .update({
        full_name: editing.full_name.trim(),
        phone: editing.phone?.trim() || null,
        employee_no: editing.employee_no?.trim() || null,
        contractor_id: editing.contractor_id || null,
        ...(isAdmin ? { role: editing.role } : {}),
      })
      .eq('id', editing.id);
    setBusy(false);
    if (e) return toast.error(friendlyError(e));
    toast.success('Saved.');
    setEditing(null);
    void reload({ silent: true });
  }

  async function toggleActive(p: Profile) {
    if (p.active && !window.confirm(`Disable ${p.full_name}? They will be signed out and unable to log in. History is kept.`)) return;
    const res = await callAdmin({ action: 'set_active', user_id: p.id, active: !p.active });
    if (!res.ok) return toast.error(res.error ?? 'Failed.');
    toast.success(p.active ? 'Account disabled.' : 'Account re-enabled.');
    void reload({ silent: true });
  }

  async function resetPassword() {
    if (!resetFor) return;
    setBusy(true);
    const res = await callAdmin({ action: 'set_password', user_id: resetFor.id, password: newPassword });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? 'Failed.');
    toast.success('Password changed. Share it with the user securely.');
    setResetFor(null);
  }

  return (
    <>
      <PageHeader
        title="Guards & users"
        subtitle="Create logins for guards (mobile app) and supervisors (this portal)."
        actions={
          <Button icon={Plus} onClick={() => setCreating({ full_name: '', email: '', password: suggestPassword(), role: 'guard', contractor_id: '', employee_no: '', phone: '' })}>
            New account
          </Button>
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Role" className="w-44">
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}>
              <option value="guard">Guards</option>
              <option value="supervisor">Supervisors</option>
              <option value="admin">Admins</option>
              <option value="all">Everyone</option>
            </Select>
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show disabled accounts
          </label>
        </div>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={Users} title="No accounts" />
        ) : (
          <Table head={['Name', 'Employee no.', 'Email', 'Phone', 'Contractor', 'Role', 'Status', '']}>
            {data.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.full_name}</Td>
                <Td>{p.employee_no ?? '–'}</Td>
                <Td>{p.email}</Td>
                <Td>{p.phone ?? '–'}</Td>
                <Td>{p.contractors?.name ?? '–'}</Td>
                <Td><Badge label={p.role} tone={p.role === 'guard' ? 'brand' : 'info'} /></Td>
                <Td>{p.active ? <Badge label="Active" tone="success" /> : <Badge label="Disabled" tone="danger" />}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canManage(p) ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" icon={Pencil} onClick={() => setEditing({ ...p })}>Edit</Button>
                      <Button size="sm" variant="outline" icon={KeyRound} onClick={() => { setResetFor(p); setNewPassword(suggestPassword()); }}>Password</Button>
                      {p.id !== me?.id ? (
                        <Button size="sm" variant="ghost" icon={p.active ? UserX : UserCheck} onClick={() => void toggleActive(p)}>
                          {p.active ? 'Disable' : 'Enable'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* --------------------------------------------------------- Create */}
      <Modal
        open={Boolean(creating)}
        title="New account"
        onClose={() => setCreating(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => void create()}>Create account</Button>
          </>
        }
      >
        {creating ? (
          <div className="space-y-3">
            <Field label="Full name"><Input value={creating.full_name} onChange={(e) => setCreating({ ...creating, full_name: e.target.value })} /></Field>
            <Field label="Email (used to sign in)"><Input type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></Field>
            <Field label="Temporary password" hint="At least 10 characters with letters and numbers. The user can change it in the app.">
              <Input value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} className="font-mono" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role">
                <Select value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value as UserRole })}>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Contractor">
                <Select value={creating.contractor_id} onChange={(e) => setCreating({ ...creating, contractor_id: e.target.value })}>
                  <option value="">None (Muscat Bay staff)</option>
                  {contractors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Employee no."><Input value={creating.employee_no} onChange={(e) => setCreating({ ...creating, employee_no: e.target.value })} /></Field>
              <Field label="Mobile"><Input value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} placeholder="+968…" /></Field>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ----------------------------------------------------------- Edit */}
      <Modal
        open={Boolean(editing)}
        title="Edit account"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => void saveEdit()}>Save</Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{editing.email}</p>
            <Field label="Full name"><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Employee no."><Input value={editing.employee_no ?? ''} onChange={(e) => setEditing({ ...editing, employee_no: e.target.value })} /></Field>
              <Field label="Mobile"><Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label="Contractor">
                <Select value={editing.contractor_id ?? ''} onChange={(e) => setEditing({ ...editing, contractor_id: e.target.value || null })}>
                  <option value="">None</option>
                  {contractors.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              {isAdmin ? (
                <Field label="Role">
                  <Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as UserRole })} disabled={editing.id === me?.id}>
                    {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* --------------------------------------------------------- Password */}
      <Modal
        open={Boolean(resetFor)}
        title={`New password for ${resetFor?.full_name ?? ''}`}
        onClose={() => setResetFor(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setResetFor(null)}>Cancel</Button>
            <Button loading={busy} onClick={() => void resetPassword()}>Set password</Button>
          </>
        }
      >
        <Field label="New password" hint="Share it with the user in person or by phone, not by group chat.">
          <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="font-mono" />
        </Field>
      </Modal>
    </>
  );
}
