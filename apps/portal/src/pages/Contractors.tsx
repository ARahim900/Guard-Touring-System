// Contractors: the security companies. Guards and reports are grouped by them.
import { Building2, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Contractor } from '@/lib/types';
import { unwrap, useAsync } from '@/lib/useAsync';

type Form = Partial<Contractor> & { name: string };

export default function ContractorsPage() {
  const { data, loading, error, reload } = useAsync(async () => unwrap(await supabase.from('contractors').select('*').order('name')) as Contractor[], []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form) return;
    if (form.name.trim().length < 2) return toast.error('Enter the company name.');
    setSaving(true);
    const row = {
      name: form.name.trim(),
      contract_ref: form.contract_ref?.trim() || null,
      contact_name: form.contact_name?.trim() || null,
      contact_phone: form.contact_phone?.trim() || null,
      contact_email: form.contact_email?.trim() || null,
      active: form.active ?? true,
    };
    const res = form.id ? await supabase.from('contractors').update(row).eq('id', form.id) : await supabase.from('contractors').insert(row);
    setSaving(false);
    if (res.error) return toast.error(friendlyError(res.error));
    toast.success('Contractor saved.');
    setForm(null);
    void reload({ silent: true });
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => f && { ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Contractors" actions={<Button icon={Plus} onClick={() => setForm({ name: '', active: true })}>New contractor</Button>} />
      <Card>
        <ErrorNote message={error} />
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={Building2} title="No contractors yet" message="Add the security companies whose guards patrol Muscat Bay." />
        ) : (
          <Table head={['Company', 'Contract ref.', 'Contact', 'Phone', 'Email', 'Status', '']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>{c.contract_ref ?? '–'}</Td>
                <Td>{c.contact_name ?? '–'}</Td>
                <Td>{c.contact_phone ?? '–'}</Td>
                <Td>{c.contact_email ?? '–'}</Td>
                <Td>{c.active ? <Badge label="Active" tone="success" /> : <Badge label="Inactive" />}</Td>
                <Td className="text-right"><Button size="sm" variant="outline" icon={Pencil} onClick={() => setForm(c)}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal
        open={Boolean(form)}
        title={form?.id ? 'Edit contractor' : 'New contractor'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button loading={saving} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        {form ? (
          <div className="space-y-3">
            <Field label="Company name"><Input value={form.name} onChange={set('name')} /></Field>
            <Field label="Contract / AMC reference"><Input value={form.contract_ref ?? ''} onChange={set('contract_ref')} /></Field>
            <Field label="Contact person"><Input value={form.contact_name ?? ''} onChange={set('contact_name')} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone"><Input value={form.contact_phone ?? ''} onChange={set('contact_phone')} /></Field>
              <Field label="Email"><Input type="email" value={form.contact_email ?? ''} onChange={set('contact_email')} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
            </label>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
