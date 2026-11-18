import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';
import InvoiceReconciliation from './InvoiceReconciliation';

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

// Record purchase history only. Stock changes remain manual in Stock Management.
export default function PurchasesSection({ products, suppliers, onChanged }) {
  const [form, setForm] = useState(emptyForm());
  const [productQuery, setProductQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchSupplierFilter, setBatchSupplierFilter] = useState('');
  const [comparisonQuery, setComparisonQuery] = useState('');

  const requestIdRef = React.useRef(null);
  function getRequestId(payload) {
    const signature = JSON.stringify(payload);
    if (!requestIdRef.current || requestIdRef.current.signature !== signature) {
      requestIdRef.current = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        signature
      };
    }
    return requestIdRef.current.id;
  }

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3500);
  };

  const loadBatches = useCallback(async () => {
    if (!sb) return;
    setBatchesLoading(true);
    try {
      // Read the complete purchase history in stable pages. A fixed 300-row
      // window can silently omit the latest supplier rate for older products.
      const allRows = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const page = await ok(
          sb.from('purchase_batches')
            .select('id, product_id, supplier_id, quantity, buy_price, purchase_date, created_at, invoice_no, batch_number, products(name, unit, pack_size), suppliers(name)')
            .order('purchase_date', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + pageSize - 1)
        );
        allRows.push(...(page || []));
        if (!page || page.length < pageSize) break;
      }
      setBatches(allRows);
    } catch (e) {
      setBatches([]);
      setErr('Could not load purchase history. (' + (e.message || e) + ')');
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
    if (!Number.isFinite(qty) || qty <= 0) { setErr('Quantity must be a finite number greater than zero.'); return; }
    if (form.buy_price !== '') {
      const price = Number(form.buy_price);
      if (!Number.isFinite(price) || price < 0) { setErr('Buy price must be a valid non-negative number.'); return; }
    }
    if (!form.purchase_date) { setErr('Choose the purchase date.'); return; }
    if (form.manufacturing_date && form.expiry_date && form.expiry_date < form.manufacturing_date) {
      setErr('Expiry date cannot be earlier than manufacturing date.');
      return;
    }

    setSaving(true);
    let purchaseSaved = false;
    try {
      if (!sb) throw new Error('Supabase is not configured.');

      const purchaseDetails = {
        p_product_id: form.product_id,
        p_quantity: qty,
        p_buy_price: form.buy_price === '' ? null : Number(form.buy_price),
        p_supplier_id: form.supplier_id || null,
        p_purchase_date: form.purchase_date,
        p_invoice_no: form.invoice_no.trim() || null,
        p_batch_number: form.batch_number.trim() || null,
        p_manufacturing_date: form.manufacturing_date || null,
        p_expiry_date: form.expiry_date || null,
        p_note: form.note.trim() || null
      };
      const requestId = getRequestId(purchaseDetails);
      const rpcPayload = { p_request_id: requestId, ...purchaseDetails };

      // Call the atomic purchase-history RPC. It never changes stock.
      const { error: rpcError } = await sb.rpc('record_purchase', rpcPayload);
      if (rpcError) throw rpcError;
      purchaseSaved = true;

      requestIdRef.current = null; // purchase committed; next submission gets a fresh key
      flash('Purchase record saved. Stock was not changed.');
      const previousSupplier = form.supplier_id;
      const previousDate = form.purchase_date;
      setForm({ ...emptyForm(), supplier_id: previousSupplier, purchase_date: previousDate });
      setProductQuery('');
      await loadBatches();
      if (onChanged) await onChanged();
    } catch (er) {
      // Keep the same request ID when the database did not confirm the purchase.
      setErr(purchaseSaved
        ? 'Purchase was saved, but the screen could not refresh. Reload to see the saved record. ' + (er.message || er)
        : 'Could not save purchase: ' + (er.message || er));
    } finally {
      setSaving(false);
    }
  }

  const shownBatches = batchSupplierFilter
    ? batches.filter(b => b.supplier_id === batchSupplierFilter)
    : batches;

  // Compare each supplier's most recent recorded rate for the same product.
  // Product identity also fixes its unit/pack size; we deliberately do not guess
  // equivalence between different product records or package descriptions.
  const supplierPriceRows = useMemo(() => {
    const latestByPair = new Map();
    batches.forEach(batch => {
      if (!batch.supplier_id || batch.buy_price === null || batch.buy_price === undefined) return;
      const price = Number(batch.buy_price);
      if (!Number.isFinite(price) || price < 0) return;
      const key = `${batch.product_id}:${batch.supplier_id}`;
      if (!latestByPair.has(key)) {
        latestByPair.set(key, {
          productId: batch.product_id,
          productName: batch.products?.name || 'Unknown product',
          unit: batch.products?.unit || 'unit',
          packSize: batch.products?.pack_size || '',
          supplierId: batch.supplier_id,
          supplierName: batch.suppliers?.name || 'Unknown supplier',
          price,
          purchaseDate: batch.purchase_date
        });
      }
    });

    const byProduct = new Map();
    [...latestByPair.values()].forEach(row => {
      if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
      byProduct.get(row.productId).push(row);
    });

    return [...byProduct.values()]
      .map(rows => {
        const lowest = Math.min(...rows.map(row => row.price));
        const supplierCount = rows.length;
        return rows.map(row => ({
          ...row,
          supplierCount,
          comparable: supplierCount > 1,
          lowest: row.price === lowest,
          difference: row.price - lowest,
          differencePercent: lowest > 0 ? ((row.price - lowest) / lowest) * 100 : null
        }));
      })
      .flat()
      .sort((a, b) => a.productName.localeCompare(b.productName) || a.price - b.price);
  }, [batches]);

  const visiblePriceRows = useMemo(() => {
    const term = comparisonQuery.trim().toLowerCase();
    return supplierPriceRows.filter(row =>
      !term || `${row.productName} ${row.packSize} ${row.supplierName}`.toLowerCase().includes(term)
    );
  }, [supplierPriceRows, comparisonQuery]);

  const comparableProductCount = useMemo(
    () => new Set(supplierPriceRows.filter(row => row.comparable).map(row => row.productId)).size,
    [supplierPriceRows]
  );

  return (
    <section className="admin-card admin-spaced-section">
      <h2 className="sec"><span>Purchase records</span></h2>
      <p className="hint">
        Record every purchase batch here: which item, from which supplier, quantity, rate,
        invoice and expiry. Saving a purchase records its supplier-specific rate only; it does not change inventory or overwrite the product buy price. Use Stock Management to add received stock after checking it physically.
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
            Supplier (optional)
            <select
              value={form.supplier_id}
              onChange={e => setForm({ ...form, supplier_id: e.target.value })}
            >
              <option value="">No supplier</option>
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
</div>
        <div className="row">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save purchase'}
          </button>
        </div>
      </form>

      <InvoiceReconciliation products={products || []} />

      <h3 className="sec"><span>Supplier price comparison</span></h3>
      <p className="hint">
        Compares the latest recorded invoice rate from each supplier for the same product, using the full purchase history. Rates are per product unit; package size and unit are shown to prevent misleading comparisons. This is historical data, not a live quote.
      </p>
      <div className="row" style={{ alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <strong>{comparableProductCount} products with multiple supplier rates</strong>
        <input
          value={comparisonQuery}
          onChange={e => setComparisonQuery(e.target.value)}
          placeholder="Search product or supplier"
          aria-label="Search price comparisons"
          style={{ maxWidth: 320 }}
        />
      </div>
      <div className="wrap dt">
        <table>
          <thead>
            <tr><th>Product / pack</th><th>Supplier</th><th>Latest rate</th><th>Purchase date</th><th>Difference vs lowest</th><th>Comparison</th></tr>
          </thead>
          <tbody>
            {visiblePriceRows.map(row => (
              <tr key={row.productId + ':' + row.supplierId}>
                <td>{row.productName}{row.packSize ? <><br /><small>{row.packSize} · {row.unit}</small></> : <><br /><small>{row.unit}</small></>}</td>
                <td>{row.supplierName}</td>
                <td>{inr(row.price)} / {row.unit}</td>
                <td>{row.purchaseDate}</td>
                <td>
                  {row.lowest ? '—' : `+${inr(row.difference)} / ${row.unit}`}
                  {!row.lowest && row.differencePercent !== null ? <small> ({row.differencePercent.toFixed(1)}%)</small> : null}
                </td>
                <td>
                  {!row.comparable
                    ? 'Only one supplier recorded'
                    : row.lowest
                      ? <span className="tag ok">Lowest recorded</span>
                      : 'Higher recorded rate'}
                </td>
              </tr>
            ))}
            {visiblePriceRows.length === 0 && (
              <tr><td colSpan={6} className="empty">
                {batchesLoading ? 'Loading complete purchase history...' : 'No comparable supplier rates yet. Record purchases with a supplier and buy price; a product becomes comparable after at least two suppliers have purchase history.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

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
