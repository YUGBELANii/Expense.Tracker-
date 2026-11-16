import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';
import {
  buildRestockItems,
  groupBySupplier,
  buildRestockMessage,
  buildWhatsAppLink,
  stockState
} from '../services/restock';

const ok = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Out-of-stock / low-stock board grouped by supplier, with a ready
// WhatsApp order message per supplier and copy-paste fallback.
export default function RestockSection({ products, suppliers, brands, manufacturers, onChanged }) {
  const [lastBatchByProduct, setLastBatchByProduct] = useState({});
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [thresholdDrafts, setThresholdDrafts] = useState({});
  const [supplierDrafts, setSupplierDrafts] = useState({});
  const [savingProductId, setSavingProductId] = useState(null);
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [thresholdSearch, setThresholdSearch] = useState('');

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  const loadLastBatches = useCallback(async () => {
    if (!sb) return;
    setLoadingBatches(true);
    try {
      const rows = await ok(
        sb.from('purchase_batches')
          .select('product_id, supplier_id, quantity, buy_price, purchase_date')
          .order('purchase_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(3000)
      );
      const byProduct = {};
      (rows || []).forEach(r => {
        if (!byProduct[r.product_id]) byProduct[r.product_id] = r; // newest first
      });
      setLastBatchByProduct(byProduct);
    } catch (e) {
      setLastBatchByProduct({});
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    loadLastBatches();
  }, [loadLastBatches]);

  const items = useMemo(
    () => buildRestockItems({ products: products || [], brands: brands || [], manufacturers: manufacturers || [], lastBatchByProduct }),
    [products, brands, manufacturers, lastBatchByProduct]
  );

  const groups = useMemo(
    () => groupBySupplier(items, (suppliers || []).filter(s => s.active)),
    [items, suppliers]
  );

  const outCount = items.filter(i => i.state === 'out').length;
  const lowCount = items.length - outCount;

  async function saveThreshold(productId) {
    const raw = thresholdDrafts[productId];
    setSavingProductId(productId);
    setErr('');
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      const value = raw === '' || raw === undefined ? null : Number(raw);
      if (value !== null && !(value >= 0)) throw new Error('Threshold must be zero or more.');
      await ok(sb.from('products').update({ low_stock_threshold: value }).eq('id', productId));
      flash('Low-stock level saved.');
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not save low-stock level: ' + (er.message || er));
    } finally {
      setSavingProductId(null);
    }
  }

  async function assignSupplier(productId) {
    const supplierId = supplierDrafts[productId];
    if (!supplierId) return;
    setSavingProductId(productId);
    setErr('');
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      await ok(sb.from('products').update({ preferred_supplier_id: supplierId }).eq('id', productId));
      flash('Supplier assigned for restock.');
      if (onChanged) await onChanged();
    } catch (er) {
      setErr('Could not assign supplier: ' + (er.message || er));
    } finally {
      setSavingProductId(null);
    }
  }

  async function copyMessage(group) {
    const text = buildRestockMessage(group);
    try {
      await navigator.clipboard.writeText(text);
      flash('Order list copied. Paste it anywhere.');
    } catch (_e) {
      window.prompt('Copy the order list below:', text);
    }
  }

  const thresholdProducts = useMemo(() => {
    const term = thresholdSearch.trim().toLowerCase();
    const list = term
      ? (products || []).filter(p => `${p.name || ''} ${p.category || ''}`.toLowerCase().includes(term))
      : (products || []);
    return list.slice(0, 60);
  }, [products, thresholdSearch]);

  const activeSuppliers = (suppliers || []).filter(s => s.active);

  return (
    <section className="admin-card admin-spaced-section">
      <h2 className="sec"><span>Restock board</span></h2>
      <p className="hint">
        Items that are out of stock or at/below their low-stock level, grouped by the supplier
        to order from. Use the WhatsApp button for an instant order message, or copy the list.
        A product's supplier comes from "Remember supplier" on the Purchases tab, or assign it below.
      </p>

      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice bad">{err}</div>}

      <section className="totals" aria-label="Restock summary">
        <div className="tot">
          <span>Out of stock</span>
          <b className={outCount ? 'neg' : ''}>{outCount}</b>
        </div>
        <div className="tot profit">
          <span>Low stock</span>
          <b>{lowCount}</b>
        </div>
        <div className="tot mrp">
          <span>Suppliers to contact</span>
          <b>{groups.filter(g => g.supplierId).length}</b>
        </div>
      </section>

      {loadingBatches && <div className="pad">Loading purchase history...</div>}

      {items.length === 0 && !loadingBatches && (
        <div className="pad">
          Nothing needs restocking right now. Set low-stock levels below so items appear here
          before they run out.
        </div>
      )}

      {groups.map(group => {
        const message = buildRestockMessage(group);
        const waLink = buildWhatsAppLink(group.phone, message);
        return (
          <div key={group.supplierId || 'none'} className="pcard" style={{ marginBottom: 14 }}>
            <div className="ph">
              <b>
                {group.supplierName}
                {group.contactPerson ? ` · ${group.contactPerson}` : ''}
              </b>
              <div className="act">
                {group.supplierId && (
                  <a
                    className="btn small"
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    title={group.phone ? `WhatsApp ${group.phone}` : 'No phone saved: opens WhatsApp share'}
                  >
                    WhatsApp order
                  </a>
                )}
                <button className="btn ghost small" type="button" onClick={() => copyMessage(group)}>
                  Copy list
                </button>
              </div>
            </div>
            {group.supplierId && !group.phone && (
              <p className="hint">No phone saved for this supplier. Add it in the Suppliers tab for one-tap ordering.</p>
            )}
            <div className="wrap dt">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Brand</th>
                    <th>Manufacturer</th>
                    <th>Left</th>
                    <th>Order qty</th>
                    <th>Last rate</th>
                    <th>Status</th>
                    {!group.supplierId && <th>Assign supplier</th>}
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(item => (
                    <tr key={item.productId}>
                      <td className="name">
                        {item.name}
                        {item.packSize ? <small> {item.packSize}</small> : null}
                      </td>
                      <td>{item.brandName || '–'}</td>
                      <td>{item.manufacturerName || '–'}</td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{item.suggestedQty ? `${item.suggestedQty} ${item.unit}` : 'ask supplier'}</td>
                      <td>{item.lastBuyPrice != null ? inr(item.lastBuyPrice) : '–'}</td>
                      <td>
                        <span className={`tag ${item.state === 'out' ? 'bad' : ''}`}>
                          {item.state === 'out' ? 'Out of stock' : 'Low stock'}
                        </span>
                      </td>
                      {!group.supplierId && (
                        <td>
                          <div className="act">
                            <select
                              value={supplierDrafts[item.productId] || ''}
                              onChange={e => setSupplierDrafts({ ...supplierDrafts, [item.productId]: e.target.value })}
                            >
                              <option value="">Choose...</option>
                              {activeSuppliers.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <button
                              className="btn ghost small"
                              type="button"
                              disabled={!supplierDrafts[item.productId] || savingProductId === item.productId}
                              onClick={() => assignSupplier(item.productId)}
                            >
                              Set
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <h3 className="sec">
        <span>Low-stock levels</span>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => setShowThresholdEditor(v => !v)}
        >
          {showThresholdEditor ? 'Hide' : 'Set levels'}
        </button>
      </h3>
      <p className="hint">
        A product joins the restock board when its stock is at or below this level.
        Leave empty to alert only when fully out of stock.
      </p>

      {showThresholdEditor && (
        <>
          <div className="tools">
            <input
              value={thresholdSearch}
              onChange={e => setThresholdSearch(e.target.value)}
              type="search"
              placeholder="Search product to set its low-stock level"
              aria-label="Search products"
            />
          </div>
          <div className="wrap dt">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Low-stock level</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {thresholdProducts.map(p => {
                  const state = stockState(p);
                  const draft = thresholdDrafts[p.id] !== undefined
                    ? thresholdDrafts[p.id]
                    : (p.low_stock_threshold ?? '');
                  return (
                    <tr key={p.id}>
                      <td className="name">{p.name}<small>{p.category || ''}</small></td>
                      <td>{+p.quantity || 0} {p.unit || ''}</td>
                      <td>
                        <span className={`tag ${state === 'out' ? 'bad' : state === 'low' ? '' : 'ok'}`}>
                          {state === 'out' ? 'Out' : state === 'low' ? 'Low' : 'OK'}
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          style={{ maxWidth: 110 }}
                          value={draft}
                          onChange={e => setThresholdDrafts({ ...thresholdDrafts, [p.id]: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          className="btn ghost small"
                          type="button"
                          disabled={savingProductId === p.id}
                          onClick={() => saveThreshold(p.id)}
                        >
                          {savingProductId === p.id ? 'Saving...' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {thresholdProducts.length === 0 && <div className="pad">No products match.</div>}
          </div>
        </>
      )}
    </section>
  );
}
