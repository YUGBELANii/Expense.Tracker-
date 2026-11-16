import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';

const ok = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');

const emptyForm = () => ({
  product_id: '',
  supplier_id: '',
  quantity: '',
  buy_price: '',
  purchase_date: today(),
  invoice_no: '',
  batch_number: '',
  manufacturing_date: '',
  expiry_date: '',
  note: ''
});

// Record a stock purchase: which product, from which supplier, how much,
// at what price, with optional invoice/batch/expiry details.
export default function PurchasesSection({ products, suppliers, onChanged }) {
  const [form, setForm] = useState(emptyForm());
  const [productQuery, setProductQuery] = useState('');
  const [addToStock, setAddToStock] = useState(true);
  const [updateBuyPrice, setUpdateBuyPrice] = useState(false);
  const [rememberSupplier, setRememberSupplier] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchSupplierFilter, setBatchSupplierFilter] = useState('');

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3500);
  };

  const loadBatches = useCallback(async () => {
    if (!sb) return;
    setBatchesLoading(true);
    try {
      const data = await ok(
        sb.from('purchase_batches')
          .select('*, products(name, unit), suppliers(name)')
          .order('purchase_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(300)
      );
      setBatches(data || []);
    } catch (e) {
      setBatches([]);
      setErr('Could not load purchases. Run the suppliers/batches SQL migration first. (' + (e.message || e) + ')');
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const activeSuppliers = (suppliers || []).filter(s => s.active);

  const productOptions = useMemo(() => {
    const term = productQuery.trim().toLowerCase();
    const list = term
      ? (products || []).filter(p =>
          `${p.name || ''} ${p.category || ''} ${p.barcode || ''}`.toLowerCase().includes(term)
        )
      : (products || []);
    return list.slice(0, 80);
  }, [products, productQuery]);

  const selectedProduct = (products || []).find(p => p.id === form.product_id) || null;

  async function save(e) {
    e.preventDefault();
    setErr('');
    const qty = Number(form.quantity);
    if (!form.product_id) { setErr('Choose a product.'); return; }
    if (!form.supplier_id) { setErr('Choose a supplier. Create one in the Suppliers tab first.'); return; }
    if (!(qty > 0)) { setErr('Quantity must be more than zero.'); return; }
    if (!form.purchase_date) { setErr('Choose the purchase date.'); return; }
    if (form.manufacturing_date && form.expiry_date && form.expiry_date < form.manufacturing_date) {
      setErr('Expiry date cannot be earlier than manufacturing date.');
      return;
    }

    setSaving(true);
    try {
      if (!sb) throw new Error('Supabase is not configured.');

      await ok(
        sb.from('purchase_batches').insert({
          product_id: form.product_id,
          supplier_id: form.supplier_id,
          quantity: qty,
          buy_price: form.buy_price === '' ? null : Number(form.buy_price),
          purchase_date: form.purchase_date,
          invoice_no: form.invoice_no.trim() || null,
          batch_number: form.batch_number.trim() || null,
          manufacturing_date: form.manufacturing_date || null,
          expiry_date: form.expiry_date || null,
          note: form.note.trim() || null
        })
      );

      // Follow-up product updates. Each is optional and explicit.
      const productUpdate = {};
      if (addToStock) {
        // Re-read the row so a stale screen does not overwrite newer stock.
        const fresh = await ok(
          sb.from('products').select('id, quantity').eq('id', form.product_id).single()
        );
        productUpdate.quantity = (Number(fresh.quantity) || 0) + qty;
      }
      if (updateBuyPrice && form.buy_price !== '') {
        productUpdate.buy_price = Number(form.buy_price);
      }
      if (rememberSupplier) {
        productUpdate.preferred_supplier_id = form.supplier_id;
      }
      if (Object.keys(productUpdate).length) {
        await ok(sb.from('products').update(productUpdate).eq('id', form.product_id));
      }

      flash(
        'Purchase saved.' +
        (addToStock ? ` Stock increased by ${qty}.` : '') +
        (rememberSupplier ? ' Supplier remembered for restock.' : '')
      );
      setForm(f => ({ ...emptyForm(), supplier_id: f.supplier_id, purchase_date: f.purchase_date }));
      setProductQuery('');
      await loadBatches();
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not save purchase: ' + (er.message || er));
    } finally {
      setSaving(false);
    }
  }

  const shownBatches = batchSupplierFilter
    ? batches.filter(b => b.supplier_id === batchSupplierFilter)
    : batches;

  return (
    <section className="admin-card admin-spaced-section">
      <h2 className="sec"><span>Purchases (stock in)</span></h2>
      <p className="hint">
        Record every purchase batch here: which item, from which supplier, quantity, rate,
        invoice and expiry. "Add to stock" increases the product quantity so the Restock tab
        and Stock Ledger stay correct.
      </p>

      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice bad">{err}</div>}

      <form className="f" onSubmit={save} style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>New purchase</h3>
        <div className="grid">
          <label className="full">
            Search product
            <input
              value={productQuery}
              onChange={e => setProductQuery(e.target.value)}
              placeholder="Type name, category or barcode to filter the list below"
            />
          </label>
          <label className="full">
            Product
            <select
              value={form.product_id}
              onChange={e => setForm({ ...form, product_id: e.target.value })}
              required
            >
              <option value="">Select product ({productOptions.length} shown)</option>
              {productOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.pack_size ? ` · ${p.pack_size}` : ''} (stock: {+p.quantity || 0} {p.unit || ''})
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier
            <select
              value={form.supplier_id}
              onChange={e => setForm({ ...form, supplier_id: e.target.value })}
              required
            >
              <option value="">Select supplier</option>
              {activeSuppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Quantity{selectedProduct ? ` (${selectedProduct.unit || 'units'})` : ''}
            <input
              type="number"
              min="0.001"
              step="any"
              value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })}
              required
            />
          </label>
          <label>
            Buy price per unit (₹)
            <input
              type="number"
              min="0"
              step="any"
              value={form.buy_price}
              onChange={e => setForm({ ...form, buy_price: e.target.value })}
              placeholder={selectedProduct && selectedProduct.buy_price != null ? `current: ${selectedProduct.buy_price}` : ''}
            />
          </label>
          <label>
            Purchase date
            <input
              type="date"
              value={form.purchase_date}
              onChange={e => setForm({ ...form, purchase_date: e.target.value })}
              required
            />
          </label>
          <label>
            Invoice no.
            <input value={form.invoice_no} onChange={e => setForm({ ...form, invoice_no: e.target.value })} />
          </label>
          <label>
            Batch number
            <input value={form.batch_number} onChange={e => setForm({ ...form, batch_number: e.target.value })} />
          </label>
          <label>
            Manufacturing date
            <input
              type="date"
              value={form.manufacturing_date}
              onChange={e => setForm({ ...form, manufacturing_date: e.target.value })}
            />
          </label>
          <label>
            Expiry date
            <input
              type="date"
              value={form.expiry_date}
              onChange={e => setForm({ ...form, expiry_date: e.target.value })}
            />
          </label>
          <label className="full">
            Note
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          </label>
          <label className="full">
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={addToStock} onChange={e => setAddToStock(e.target.checked)} />
              Add this quantity to product stock
            </span>
          </label>
          <label className="full">
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={updateBuyPrice} onChange={e => setUpdateBuyPrice(e.target.checked)} />
              Also update the product's buy price to this rate
            </span>
          </label>
          <label className="full">
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={rememberSupplier} onChange={e => setRememberSupplier(e.target.checked)} />
              Remember this supplier as the product's restock supplier
            </span>
          </label>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save purchase'}
          </button>
        </div>
      </form>

      <h3 className="sec">
        <span>Recent purchases</span>
        <select value={batchSupplierFilter} onChange={e => setBatchSupplierFilter(e.target.value)}>
          <option value="">All suppliers</option>
          {(suppliers || []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </h3>

      <div className="wrap dt">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Supplier</th>
              <th>Qty</th>
              <th>Buy price</th>
              <th>Total</th>
              <th>Invoice</th>
              <th>Batch</th>
              <th>Expiry</th>
            </tr>
          </thead>
          <tbody>
            {shownBatches.map(b => (
              <tr key={b.id}>
                <td>{b.purchase_date}</td>
                <td>{b.products?.name || 'Unknown product'}</td>
                <td>{b.suppliers?.name || '–'}</td>
                <td>{+b.quantity} {b.products?.unit || ''}</td>
                <td>{b.buy_price != null ? inr(b.buy_price) : '–'}</td>
                <td>{b.buy_price != null ? inr(Number(b.buy_price) * Number(b.quantity)) : '–'}</td>
                <td>{b.invoice_no || '–'}</td>
                <td>{b.batch_number || '–'}</td>
                <td>{b.expiry_date || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {batchesLoading && <div className="pad">Loading purchases...</div>}
        {!batchesLoading && shownBatches.length === 0 && (
          <div className="pad">No purchases recorded yet.</div>
        )}
      </div>
    </section>
  );
}
