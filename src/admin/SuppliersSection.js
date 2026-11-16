import React, { useState } from 'react';
import { sb } from '../lib/supabase';

const ok = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const emptyForm = {
  id: null,
  name: '',
  phone: '',
  contact_person: '',
  address: '',
  note: '',
  active: true
};

// Suppliers CRUD. Delete is a soft archive (active=false) so purchase
// history keeps pointing at a real supplier.
export default function SuppliersSection({ suppliers, onChanged }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  async function save(e) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) {
      setErr('Supplier name is required.');
      return;
    }
    setSaving(true);
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        contact_person: form.contact_person.trim() || null,
        address: form.address.trim() || null,
        note: form.note.trim() || null,
        active: !!form.active
      };
      if (form.id) {
        await ok(sb.from('suppliers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', form.id));
        flash('Supplier updated.');
      } else {
        await ok(sb.from('suppliers').insert(payload));
        flash('Supplier created.');
      }
      setForm(emptyForm);
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not save supplier: ' + (er.message || er));
    } finally {
      setSaving(false);
    }
  }

  async function archive(s) {
    setErr('');
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      await ok(sb.from('suppliers').update({ active: false, updated_at: new Date().toISOString() }).eq('id', s.id));
      flash('Supplier archived. Purchase history is preserved.');
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not archive supplier: ' + (er.message || er));
    }
  }

  return (
    <section className="admin-card admin-spaced-section">
      <h2 className="sec"><span>Suppliers</span></h2>
      <p className="hint">
        Who you buy stock from (distributor, wholesaler or direct company depot).
        The phone number is used for one-tap WhatsApp restock orders (+91 assumed for 10-digit numbers).
        If the list fails to load, run <code>supabase/migrations/2026-11-16_suppliers_batches_restock.sql</code> first.
      </p>

      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice bad">{err}</div>}

      <form className="f" onSubmit={save} style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>{form.id ? 'Edit supplier' : 'Create new supplier'}</h3>
        <div className="grid">
          <label>
            Name
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            WhatsApp phone
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210" />
          </label>
          <label>
            Contact person
            <input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          </label>
          <label>
            Address
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className="full">
            Note
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Delivery days, payment terms..." />
          </label>
          {form.id && (
            <label className="full">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm({ ...form, active: e.target.checked })}
                />
                Active
              </span>
            </label>
          )}
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving...' : form.id ? 'Save changes' : 'Create supplier'}
          </button>
          {form.id && (
            <button type="button" className="btn ghost" onClick={() => setForm(emptyForm)}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="wrap dt">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Contact</th>
              <th>Note</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(suppliers || []).map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.phone || '–'}</td>
                <td>{s.contact_person || '–'}</td>
                <td>{s.note || '–'}</td>
                <td>
                  <span className={`tag ${s.active ? 'ok' : ''}`}>
                    {s.active ? 'Active' : 'Archived'}
                  </span>
                </td>
                <td>
                  <div className="act">
                    <button
                      className="btn ghost small"
                      onClick={() => setForm({
                        id: s.id,
                        name: s.name || '',
                        phone: s.phone || '',
                        contact_person: s.contact_person || '',
                        address: s.address || '',
                        note: s.note || '',
                        active: !!s.active
                      })}
                    >
                      Edit
                    </button>
                    {s.active && (
                      <button className="btn ghost small danger" onClick={() => archive(s)}>
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!suppliers || suppliers.length === 0) && (
          <div className="pad">No suppliers yet. Create the first one above.</div>
        )}
      </div>
    </section>
  );
}
