import React, { useState, useMemo } from 'react';
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
  email: '',
  contact_person: '',
  address: '',
  gstin: '',
  note: '',
  active: true
};

function isValidEmail(v) {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizePhone(v) {
  if (!v) return '';
  const digits = String(v).replace(/\D/g, '');
  if (digits.length === 10) return '+91' + digits;
  if (digits.startsWith('91') && digits.length === 12) return '+' + digits;
  if (v.trim().startsWith('+')) return '+' + digits;
  return digits ? digits : v.trim();
}

// Suppliers CRUD. Delete is a soft archive (active=false) so purchase
// history keeps pointing at a real supplier.
export default function SuppliersSection({ suppliers, products = [], onChanged }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [psSearch, setPsSearch] = useState('');
  const [psCategory, setPsCategory] = useState('');
  const [psSupplierFilter, setPsSupplierFilter] = useState('');
  const [psAssignedFilter, setPsAssignedFilter] = useState('all');
  const [psSavingId, setPsSavingId] = useState(null);

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  async function save(e) {
    e.preventDefault();
    setErr('');
    const name = form.name.trim();
    if (!name) {
      setErr('Supplier name is required.');
      return;
    }
    if (!isValidEmail(form.email.trim())) {
      setErr('Enter a valid email address.');
      return;
    }
    const phoneNorm = normalizePhone(form.phone);
    if (phoneNorm && phoneNorm.replace(/\D/g, '').length < 8) {
      setErr('Enter a valid phone number (at least 8 digits).');
      return;
    }
    // duplicate check (client-side)
    const dup = (suppliers || []).find(s => s.id !== form.id && (s.name || '').trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      setErr('A supplier with this name already exists.');
      return;
    }
    setSaving(true);
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      const payload = {
        name,
        phone: phoneNorm || null,
        email: form.email.trim() || null,
        contact_person: form.contact_person.trim() || null,
        address: form.address.trim() || null,
        gstin: form.gstin.trim() || null,
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

  const psCategories = useMemo(() => {
    const set = new Set((products || []).map(p => p.category).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const psFilteredProducts = useMemo(() => {
    let list = (products || []).slice();
    const term = psSearch.trim().toLowerCase();
    if (term) list = list.filter(p => (p.name || '').toLowerCase().includes(term));
    if (psCategory) list = list.filter(p => (p.category || '') === psCategory);
    if (psSupplierFilter === '__none__') list = list.filter(p => !p.preferred_supplier_id);
    else if (psSupplierFilter) list = list.filter(p => String(p.preferred_supplier_id) === String(psSupplierFilter));
    if (psAssignedFilter === 'unassigned') list = list.filter(p => !p.preferred_supplier_id);
    if (psAssignedFilter === 'assigned') list = list.filter(p => !!p.preferred_supplier_id);
    return list;
  }, [products, psSearch, psCategory, psSupplierFilter, psAssignedFilter]);

  async function setProductSupplier(productId, supplierId) {
    setErr('');
    setPsSavingId(productId);
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      await ok(sb.from('products').update({ preferred_supplier_id: supplierId || null }).eq('id', productId));
      flash('Supplier assignment updated.');
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not update supplier assignment: ' + (er.message || er));
    } finally {
      setPsSavingId(null);
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
            Name *
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="98765 43210" />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
          </label>
          <label>
            Contact person
            <input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          </label>
          <label className="full">
            Business address
            <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </label>
          <label>
            GSTIN (optional)
            <input value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} placeholder="e.g. 27AAAAA0000A1Z5" />
          </label>
          <label className="full">
            Additional notes
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

      <div className="tools" style={{ marginBottom: 8 }}>
        <input type="search" placeholder="Search suppliers by name…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search suppliers" />
      </div>
      <div className="wrap dt">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Contact</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(suppliers || []).filter(s => !search.trim() || (s.name||'').toLowerCase().includes(search.trim().toLowerCase())).map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.phone || '–'}</td>
                <td>{s.email || '–'}</td>
                <td>{s.contact_person || '–'}</td>
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
                        email: s.email || '',
                        contact_person: s.contact_person || '',
                        address: s.address || '',
                        gstin: s.gstin || '',
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
                    {!s.active && (
                      <button className="btn ghost small" onClick={async () => {
                        try {
                          if (!sb) throw new Error('Supabase not configured.');
                          await ok(sb.from('suppliers').update({ active: true, updated_at: new Date().toISOString() }).eq('id', s.id));
                          flash('Supplier reactivated.');
                          if (onChanged) await onChanged();
                        } catch (er) { setErr('Could not reactivate: ' + (er.message || er)); }
                      }}>
                        Reactivate
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

      <h2 className="sec" style={{ marginTop: 24 }}><span>Product Supplier Assignment</span></h2>
      <p className="hint">Assign a preferred supplier to each product. Archived suppliers are not shown for new assignments, but remain visible if already assigned.</p>
      <div className="tools" style={{ flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search products…" value={psSearch} onChange={e => setPsSearch(e.target.value)} aria-label="Search products" />
        <select value={psCategory} onChange={e => setPsCategory(e.target.value)}>
          <option value="">All categories</option>
          {psCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={psSupplierFilter} onChange={e => setPsSupplierFilter(e.target.value)}>
          <option value="">All suppliers</option>
          <option value="__none__">Unassigned</option>
          {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (archived)'}</option>)}
        </select>
        <select value={psAssignedFilter} onChange={e => setPsAssignedFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="unassigned">Unassigned only</option>
          <option value="assigned">Assigned only</option>
        </select>
      </div>
      <div className="wrap dt">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Product</th>
              <th>Category</th>
              <th>Stock</th>
              <th>Current supplier</th>
              <th>Assign</th>
            </tr>
          </thead>
          <tbody>
            {psFilteredProducts.length === 0 && <tr><td colSpan={5} className="empty">No products match filters.</td></tr>}
            {psFilteredProducts.map(p => {
              const currentSupplier = (suppliers || []).find(s => String(s.id) === String(p.preferred_supplier_id));
              const currentLabel = currentSupplier ? `${currentSupplier.name}${currentSupplier.active ? '' : ' (archived)'}` : '— Unassigned —';
              return (
                <tr key={p.id}>
                  <td style={{ textAlign: 'left' }}>{p.name}</td>
                  <td>{p.category || '–'}</td>
                  <td>{+p.quantity || 0} {p.unit || ''}</td>
                  <td>{currentLabel}</td>
                  <td>
                    <select
                      value={p.preferred_supplier_id || ''}
                      disabled={psSavingId === p.id}
                      onChange={e => setProductSupplier(p.id, e.target.value)}
                    >
                      <option value="">— None —</option>
                      {(suppliers || []).filter(s => s.active || String(s.id) === String(p.preferred_supplier_id)).map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (archived)'}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
