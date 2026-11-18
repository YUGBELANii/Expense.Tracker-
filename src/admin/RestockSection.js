import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';
import {
  buildRestockItems,
  groupBySupplier,
  buildRestockMessage,
  buildWhatsAppLink,
  stockState
} from '../services/restock';

const DEFAULT_LOW_STOCK_THRESHOLD = 3;

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
  const [orderQtyDrafts, setOrderQtyDrafts] = useState({});
  const [excludedRestockItems, setExcludedRestockItems] = useState({});
  const [supplierDrafts, setSupplierDrafts] = useState({});
  const [savingProductId, setSavingProductId] = useState(null);
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [thresholdSearch, setThresholdSearch] = useState('');
  const [restockSearch, setRestockSearch] = useState('');
  const [restockCategory, setRestockCategory] = useState('');
  const [restockSupplierFilter, setRestockSupplierFilter] = useState('');
  const [restockSort, setRestockSort] = useState('stock_asc');

  const flash = text => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  const loadLastBatches = useCallback(async () => {
    if (!sb) return;
    setLoadingBatches(true);
    try {
      const prods = products || [];
      const lowOutIds = prods.filter(p => stockState(p, DEFAULT_LOW_STOCK_THRESHOLD) !== 'ok').map(p => p.id);
      if (lowOutIds.length === 0) {
        setLastBatchByProduct({});
        setLoadingBatches(false);
        return;
      }
      // Fetch batches for only low/out products (chunk if needed)
      const chunks = [];
      for (let i = 0; i < lowOutIds.length; i += 200) chunks.push(lowOutIds.slice(i, i + 200));
      const allRows = [];
      for (const chunk of chunks) {
        const rows = await ok(
          sb.from('purchase_batches')
            .select('product_id, supplier_id, quantity, buy_price, purchase_date, batch_number, expiry_date')
            .in('product_id', chunk)
            .order('purchase_date', { ascending: false })
            .order('created_at', { ascending: false })
        );
        allRows.push(...(rows || []));
      }
      const byProduct = {};
      allRows.forEach(r => {
        if (!byProduct[r.product_id]) byProduct[r.product_id] = r; // newest first
      });
      setLastBatchByProduct(byProduct);
    } catch (e) {
      setLastBatchByProduct({});
    } finally {
      setLoadingBatches(false);
    }
  }, [products]);

  useEffect(() => {
    loadLastBatches();
  }, [loadLastBatches]);

  const items = useMemo(
    () => buildRestockItems({ products: products || [], brands: brands || [], manufacturers: manufacturers || [], lastBatchByProduct, defaultThreshold: DEFAULT_LOW_STOCK_THRESHOLD }),
    [products, brands, manufacturers, lastBatchByProduct]
  );

  const categories = useMemo(() => {
    const set = new Set((products || []).map(p => p.category).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const filteredItems = useMemo(() => {
    let list = items.slice();
    const term = restockSearch.trim().toLowerCase();
    if (term) list = list.filter(i => (i.name || '').toLowerCase().includes(term) || (i.category || '').toLowerCase().includes(term));
    if (restockCategory) list = list.filter(i => (i.category || '') === restockCategory);
    if (restockSupplierFilter === '__none__') list = list.filter(i => !i.supplierId);
    else if (restockSupplierFilter) list = list.filter(i => String(i.supplierId) === String(restockSupplierFilter));
    if (restockSort === 'stock_asc') list.sort((a,b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
    else if (restockSort === 'name_asc') list.sort((a,b) => a.name.localeCompare(b.name));
    else if (restockSort === 'date_desc') list.sort((a,b) => (b.lastPurchaseDate || '').localeCompare(a.lastPurchaseDate || '') || a.name.localeCompare(b.name));
    return list;
  }, [items, restockSearch, restockCategory, restockSupplierFilter, restockSort]);

  const selectedRestockItems = useMemo(
    () => filteredItems
      .filter(item => !excludedRestockItems[item.productId])
      .map(item => ({
        ...item,
        suggestedQty: orderQtyDrafts[item.productId] !== undefined
          ? (orderQtyDrafts[item.productId] === '' ? null : Number(orderQtyDrafts[item.productId]))
          : item.suggestedQty
      })),
    [filteredItems, excludedRestockItems, orderQtyDrafts]
  );

  const groups = useMemo(
    () => groupBySupplier(selectedRestockItems, (suppliers || []).filter(s => s.active)),
    [selectedRestockItems, suppliers]
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
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Threshold must be a finite number zero or more.');
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
        Items at or below their low-stock level (default {DEFAULT_LOW_STOCK_THRESHOLD} units, unless a custom level is set) or out of stock. Grouped by supplier for ordering. Use WhatsApp or copy the list.
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

      <div className="tools" style={{ flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search product or category…" value={restockSearch} onChange={e => setRestockSearch(e.target.value)} aria-label="Search restock items" />
        <select value={restockCategory} onChange={e => setRestockCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={restockSupplierFilter} onChange={e => setRestockSupplierFilter(e.target.value)} aria-label="Filter by supplier">
          <option value="">All suppliers</option>
          <option value="__none__">No supplier assigned</option>
          {(suppliers || []).filter(s=>s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={restockSort} onChange={e => setRestockSort(e.target.value)} aria-label="Sort">
          <option value="stock_asc">Lowest stock first</option>
          <option value="name_asc">Name A–Z</option>
          <option value="date_desc">Latest purchase date</option>
        </select>
      </div>

      {loadingBatches && <div className="pad">Loading purchase history...</div>}

      {items.length === 0 && !loadingBatches && (
        <div className="pad">
          Nothing needs restocking right now (default threshold is {DEFAULT_LOW_STOCK_THRESHOLD} units). Set custom low-stock levels below if needed.
        </div>
      )}
      {items.length > 0 && filteredItems.length === 0 && !loadingBatches && (
        <div className="pad">No items match your search/filter.</div>
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
                    <th>Threshold</th>
                    <th>Include</th>
                    <th>Order qty</th>
                    <th>Last rate</th>
                    <th>Last bought</th>
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
                      <td>{item.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!excludedRestockItems[item.productId]}
                          onChange={e => setExcludedRestockItems(current => ({ ...current, [item.productId]: !e.target.checked }))}
                          aria-label={`Include ${item.name} in restock order`}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          style={{ maxWidth: 110 }}
                          value={orderQtyDrafts[item.productId] ?? (item.suggestedQty ?? '')}
                          onChange={e => setOrderQtyDrafts(current => ({ ...current, [item.productId]: e.target.value }))}
                          aria-label={`Order quantity for ${item.name}`}
                        />
                      </td>
                      <td>{item.lastBuyPrice != null ? inr(item.lastBuyPrice) : '–'}</td>
                      <td>{item.lastPurchaseDate || '–'}{item.lastBatchNumber ? ` (batch ${item.lastBatchNumber})` : ''}{item.lastExpiryDate ? ` exp ${item.lastExpiryDate}` : ''}</td>
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
        A product joins the restock board when its stock is at or below this level (default is {DEFAULT_LOW_STOCK_THRESHOLD}). Leave empty to use the default.
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
