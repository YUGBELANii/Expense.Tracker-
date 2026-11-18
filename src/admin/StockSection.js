import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../lib/supabase';

const ok = async query => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const makeRequestId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const number = value => Number(value || 0);

const requestForPayload = (ref, payload) => {
  const signature = JSON.stringify(payload);
  if (!ref.current || ref.current.signature !== signature) {
    ref.current = { id: makeRequestId(), signature };
  }
  return ref.current.id;
};

export default function StockSection({ products = [], onChanged }) {
  const [locations, setLocations] = useState([]);
  const [balances, setBalances] = useState([]);
  const [movements, setMovements] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [productId, setProductId] = useState('');
  const [operation, setOperation] = useState('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [rackName, setRackName] = useState('');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState({});
  const [countSearch, setCountSearch] = useState('');
  const [categoryTarget, setCategoryTarget] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('unassigned');
  const [categorySelectedIds, setCategorySelectedIds] = useState(new Set());
  const [categorySaving, setCategorySaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const adjustmentRequestRef = useRef(null);
  const reconciliationRequestRef = useRef(null);

  const load = useCallback(async () => {
    if (!sb) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [locationRows, balanceRows, movementRows] = await Promise.all([
        ok(sb.from('stock_locations').select('*').order('name')),
        ok(sb.from('stock_balances').select('product_id, location_id, quantity')),
        ok(sb.from('stock_movements')
          .select('id, product_id, location_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_at, products(name), stock_locations(name)')
          .order('created_at', { ascending: false })
          .limit(100))
      ]);
      setLocations(locationRows || []);
      setBalances(balanceRows || []);
      setMovements(movementRows || []);
      setLocationId(current => current && locationRows.some(row => row.id === current)
        ? current
        : (locationRows.find(row => row.name === 'Unassigned') || locationRows[0])?.id || '');
    } catch (e) {
      setError('Could not load stock data. Apply the stock-management migration first. ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedProduct = products.find(product => product.id === productId) || null;

  function changeLocation(nextLocationId) {
    const hasDraft = Object.values(counts).some(value => value !== '');
    if (hasDraft && !window.confirm('Changing location will clear the unsaved physical counts. Continue?')) return;
    if (hasDraft) setCounts({});
    setLocationId(nextLocationId);
  }
  const locationById = useMemo(() => Object.fromEntries(locations.map(row => [row.id, row])), [locations]);
  const balanceByKey = useMemo(() => {
    const map = {};
    balances.forEach(row => { map[row.product_id + ':' + row.location_id] = number(row.quantity); });
    return map;
  }, [balances]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(product => !term || `${product.name || ''} ${product.category || ''} ${product.barcode || ''}`.toLowerCase().includes(term));
  }, [products, search]);

  const availableCategories = useMemo(() => [...new Set(
    products.map(product => (product.category || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b)), [products]);

  const categoryProducts = useMemo(() => {
    const term = categorySearch.trim().toLowerCase();
    return products.filter(product => {
      const category = (product.category || '').trim();
      if (categoryFilter === 'unassigned' && category) return false;
      if (categoryFilter === 'assigned' && !category) return false;
      return !term || `${product.name || ''} ${category}`.toLowerCase().includes(term);
    });
  }, [products, categorySearch, categoryFilter]);

  const countProducts = useMemo(() => {
    const term = countSearch.trim().toLowerCase();
    return products.filter(product => !term || `${product.name || ''} ${product.category || ''}`.toLowerCase().includes(term));
  }, [products, countSearch]);

  const totalStock = products.reduce((sum, product) => sum + number(product.quantity), 0);
  const selectedLocationTotal = balances
    .filter(row => row.location_id === locationId)
    .reduce((sum, row) => sum + number(row.quantity), 0);

  const countSummary = useMemo(() => {
    const entered = products.filter(product =>
      Object.prototype.hasOwnProperty.call(counts, product.id) && counts[product.id] !== ''
    );
    const systemTotal = entered.reduce(
      (sum, product) => sum + number(balanceByKey[product.id + ':' + locationId]),
      0
    );
    const physicalTotal = entered.reduce(
      (sum, product) => sum + Number(counts[product.id]),
      0
    );
    return {
      products: entered.length,
      systemTotal,
      physicalTotal,
      difference: physicalTotal - systemTotal
    };
  }, [products, counts, balanceByKey, locationId]);

  function toggleCategoryProduct(productId) {
    setCategorySelectedIds(current => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function assignCategory(e) {
    e.preventDefault();
    const category = categoryTarget.trim();
    const ids = [...categorySelectedIds];
    if (!category) {
      setError('Choose or enter a category first.');
      return;
    }
    if (!ids.length) {
      setError('Select at least one product to assign.');
      return;
    }
    setCategorySaving(true);
    setError('');
    setMessage('');
    try {
      await ok(sb.from('products').update({ category }).in('id', ids));
      setCategorySelectedIds(new Set());
      setMessage(`Assigned "${category}" to ${ids.length} product(s).`);
      if (onChanged) await onChanged();
    } catch (e2) {
      setError('Could not assign category: ' + (e2.message || e2));
    } finally {
      setCategorySaving(false);
    }
  }

  async function createLocation(e) {
    e.preventDefault();
    const name = rackName.trim();
    if (!name) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const created = await ok(sb.from('stock_locations').insert({ name }).select('*').single());
      setLocations(rows => [...rows, created].sort((a, b) => a.name.localeCompare(b.name)));
      setLocationId(created.id);
      setRackName('');
      setMessage('Rack/location created.');
    } catch (e2) {
      setError('Could not create rack: ' + (e2.message || e2));
    } finally {
      setSaving(false);
    }
  }

  async function saveAdjustment(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const amount = Number(quantity);
    if (!productId || !locationId) return setError('Choose a product and location.');
    if (!Number.isFinite(amount) || amount < 0 || (operation === 'add' && amount <= 0)) {
      return setError(operation === 'add' ? 'Enter an amount greater than zero.' : 'Enter a valid non-negative stock quantity.');
    }
    if (!reason.trim()) return setError('A reason is required for the stock history.');
    setSaving(true);
    try {
      const adjustments = [{ product_id: productId, location_id: locationId, mode: operation === 'set' ? 'reconcile' : 'add', quantity: amount }];
      await ok(sb.rpc('apply_stock_adjustments', {
        p_request_id: requestForPayload(adjustmentRequestRef, { adjustments, reason: reason.trim() }),
        p_adjustments: adjustments,
        p_reason: reason.trim()
      }));
      adjustmentRequestRef.current = null;
      setQuantity('');
      setReason('');
      setMessage('Stock updated and movement recorded.');
      try {
        await load();
        if (onChanged) await onChanged();
      } catch (refreshError) {
        setError('Stock was saved, but the product list could not be refreshed: ' + (refreshError.message || refreshError));
      }
    } catch (e2) {
      setError('Stock update failed: ' + (e2.message || e2));
    } finally {
      setSaving(false);
    }
  }

  async function saveReconciliation() {
    setError('');
    setMessage('');
    if (!locationId) return setError('Choose a location to reconcile.');
    const adjustments = products
      .filter(product => Object.prototype.hasOwnProperty.call(counts, product.id) && counts[product.id] !== '')
      .map(product => ({
        product_id: product.id,
        location_id: locationId,
        mode: 'reconcile',
        quantity: Number(counts[product.id])
      }));
    if (!adjustments.length) return setError('Enter at least one physical count. Blank rows are ignored.');
    if (adjustments.some(item => !Number.isFinite(item.quantity) || item.quantity < 0)) {
      return setError('Physical counts must be valid non-negative numbers.');
    }
    const confirmed = window.confirm(
      `Apply physical counts for ${adjustments.length} product(s) in ${locationById[locationId]?.name || 'this location'}? This will change stock quantities and write movement history.`
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      await ok(sb.rpc('apply_stock_adjustments', {
        p_request_id: requestForPayload(reconciliationRequestRef, { adjustments, reason: 'Physical stock reconciliation' }),
        p_adjustments: adjustments,
        p_reason: 'Physical stock reconciliation'
      }));
      reconciliationRequestRef.current = null;
      setCounts({});
      setMessage(`Reconciled ${adjustments.length} product(s). Stock history has been updated.`);
      try {
        await load();
        if (onChanged) await onChanged();
      } catch (refreshError) {
        setError('Counts were saved, but the product list could not be refreshed: ' + (refreshError.message || refreshError));
      }
    } catch (e2) {
      setError('Reconciliation failed; no partial changes were saved. ' + (e2.message || e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-card admin-spaced-section">
      <h2 className="sec"><span>Stock Management</span></h2>
      <p className="hint">
        Rack-level stock control. Existing inventory is carried into <b>Unassigned</b> during the migration; move it into physical racks using reconciliation. Purchases are records only and do not change stock.
      </p>

      {message && <div className="notice ok">{message}</div>}
      {error && <div className="notice bad">{error}</div>}
      {loading && <div className="notice">Loading stock locations and movement history…</div>}

      <section className="totals" aria-label="Stock summary">
        <div className="tot"><span>Products</span><b>{products.length}</b></div>
        <div className="tot"><span>Total units (all locations)</span><b>{totalStock.toLocaleString('en-IN')}</b></div>
        <div className="tot profit"><span>{locationById[locationId]?.name || 'Selected location'} quantity</span><b>{selectedLocationTotal.toLocaleString('en-IN')}</b></div>
      </section>

      <div className="admin-card category-assigner">
        <div className="category-assigner-heading">
          <div>
            <h3>Category Assigner</h3>
            <p className="hint">Bulk-assign products to an existing or new category. Changes are saved to each product record.</p>
          </div>
          <span className="category-count">{products.length} products</span>
        </div>
        <form className="category-assigner-form" onSubmit={assignCategory}>
          <label>
            Category
            <input
              list="stock-category-options"
              value={categoryTarget}
              onChange={e => setCategoryTarget(e.target.value)}
              placeholder="Choose or type a category"
              maxLength={80}
              required
            />
            <datalist id="stock-category-options">
              {availableCategories.map(category => <option key={category} value={category} />)}
            </datalist>
          </label>
          <div className="category-assigner-filters">
            <input
              type="search"
              value={categorySearch}
              onChange={e => setCategorySearch(e.target.value)}
              placeholder="Search products…"
              aria-label="Search products for category assignment"
            />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Filter category assignment products">
              <option value="unassigned">Unassigned only</option>
              <option value="assigned">Already categorised</option>
              <option value="all">All products</option>
            </select>
          </div>
          <div className="category-assigner-selection">
            <span>{categorySelectedIds.size} selected · {categoryProducts.length} shown</span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setCategorySelectedIds(new Set(categoryProducts.map(product => product.id)))}
              disabled={!categoryProducts.length || categorySaving}
            >
              Select shown
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setCategorySelectedIds(new Set())}
              disabled={!categorySelectedIds.size || categorySaving}
            >
              Clear selection
            </button>
          </div>
          <div className="category-assigner-list">
            {categoryProducts.map(product => (
              <label className="category-product-option" key={product.id}>
                <input
                  type="checkbox"
                  checked={categorySelectedIds.has(product.id)}
                  onChange={() => toggleCategoryProduct(product.id)}
                  disabled={categorySaving}
                />
                <span className="category-product-name">{product.name}</span>
                <span className={product.category ? 'category-current' : 'category-current is-empty'}>
                  {product.category || 'Unassigned'}
                </span>
              </label>
            ))}
            {!categoryProducts.length && (
              <p className="empty">No products match this filter.</p>
            )}
          </div>
          <div className="row category-assigner-actions">
            <button className="btn" type="submit" disabled={categorySaving || !categoryTarget.trim() || !categorySelectedIds.size}>
              {categorySaving ? 'Assigning…' : `Assign category to ${categorySelectedIds.size} product(s)`}
            </button>
          </div>
        </form>
      </div>

      <div className="admin-card">
        <h3 style={{ marginTop: 0 }}>Locations / racks</h3>
        <div className="tools">
          <select value={locationId} onChange={e => changeLocation(e.target.value)} aria-label="Selected stock location">
            <option value="">Select location</option>
            {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <form onSubmit={createLocation} style={{ display: 'flex', gap: 8, flex: '1 1 260px' }}>
            <input value={rackName} onChange={e => setRackName(e.target.value)} placeholder="New rack name (e.g. Rack A)" aria-label="New rack name" />
            <button className="btn" type="submit" disabled={saving || !rackName.trim()}>Add rack</button>
          </form>
        </div>
        <p className="hint">Unassigned is the safe holding location for stock that has not been physically counted into a rack. Locations are archived by leaving them unused; they are not deleted.</p>
      </div>

      <div className="admin-card">
        <h3 style={{ marginTop: 0 }}>Manual stock operation</h3>
        <form className="f" onSubmit={saveAdjustment}>
          <div className="grid">
            <label className="full">Product
              <select value={productId} onChange={e => setProductId(e.target.value)} required>
                <option value="">Select product</option>
                {products.map(product => <option key={product.id} value={product.id}>{product.name} · current total {number(product.quantity)} {product.unit}</option>)}
              </select>
            </label>
            <label>Location
              <select value={locationId} onChange={e => changeLocation(e.target.value)} required>
                <option value="">Select location</option>
                {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label>Operation
              <select value={operation} onChange={e => setOperation(e.target.value)}>
                <option value="add">Add stock (increase)</option>
                <option value="set">Set physical quantity (reconcile Unassigned stock)</option>
              </select>
            </label>
            <label>Quantity {operation === 'add' ? 'to add' : 'to set'}
              <input type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} required />
            </label>
            <label>Reason
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Initial rack placement / damaged goods" maxLength={300} required />
            </label>
          </div>
          {selectedProduct && locationId && (
            <p className="hint">
              Current in {locationById[locationId]?.name}: {balanceByKey[selectedProduct.id + ':' + locationId] || 0} {selectedProduct.unit}. Total product stock: {number(selectedProduct.quantity)}. Setting a physical quantity reconciles the rack and moves available Unassigned stock first.
            </p>
          )}
          <div className="row"><button className="btn" type="submit" disabled={saving || loading}>{saving ? 'Saving…' : 'Save stock operation'}</button></div>
        </form>
      </div>

      <div className="admin-card">
        <h3 style={{ marginTop: 0 }}>Physical count & reconciliation</h3>
        <p className="hint">Enter physical quantities for the selected location. Blank rows are ignored. If a rack count is higher than its current balance, the increase is first transferred from Unassigned stock (so opening inventory is not double-counted). Any remaining excess increases total stock. A shortage reduces stock. The entire reconciliation is atomic.</p>
        <div className="tools">
          <input type="search" value={countSearch} onChange={e => setCountSearch(e.target.value)} placeholder="Filter products to count…" aria-label="Search products for reconciliation" />
        </div>
        <div className="wrap dt" style={{ maxHeight: 440, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Product</th><th>System quantity</th><th>Physical count</th><th>Difference</th></tr></thead>
            <tbody>
              {countProducts.map(product => {
                const system = balanceByKey[product.id + ':' + locationId] || 0;
                const raw = counts[product.id];
                const difference = raw === undefined || raw === '' ? null : Number(raw) - system;
                return (
                  <tr key={product.id}>
                    <td>{product.name}<small>{product.category || 'Uncategorised'}</small></td>
                    <td>{system} {product.unit}</td>
                    <td><input type="number" min="0" step="any" value={raw ?? ''} onChange={e => setCounts(current => ({ ...current, [product.id]: e.target.value }))} aria-label={`Physical count for ${product.name}`} /></td>
                    <td className={difference === null ? '' : difference < 0 ? 'neg' : difference > 0 ? 'pos' : ''}>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${difference} ${product.unit}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {countSummary.products > 0 && (
          <div className="totals" aria-live="polite">
            <div className="tot"><span>Products counted</span><b>{countSummary.products}</b></div>
            <div className="tot"><span>System total</span><b>{countSummary.systemTotal.toLocaleString('en-IN')}</b></div>
            <div className="tot"><span>Physical total</span><b>{countSummary.physicalTotal.toLocaleString('en-IN')}</b></div>
            <div className="tot"><span>Net difference</span><b className={countSummary.difference < 0 ? 'neg' : countSummary.difference > 0 ? 'pos' : ''}>{countSummary.difference > 0 ? '+' : ''}{countSummary.difference.toLocaleString('en-IN')}</b></div>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" type="button" onClick={() => setCounts({})} disabled={saving}>Clear draft</button>
          <button className="btn" type="button" onClick={saveReconciliation} disabled={saving || !Object.values(counts).some(value => value !== '')}>{saving ? 'Applying…' : `Review & apply counts (${Object.values(counts).filter(value => value !== '').length})`}</button>
        </div>
      </div>

      <div className="admin-card">
        <h3 style={{ marginTop: 0 }}>Current stock by location</h3>
        <div className="tools"><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…" aria-label="Search stock balances" /></div>
        <div className="wrap dt">
          <table>
            <thead><tr><th>Product</th><th>Location</th><th>Quantity</th><th>Product total</th></tr></thead>
            <tbody>
              {filteredProducts.map(product => {
                const rows = locations.map(location => ({
                  location,
                  quantity: balanceByKey[product.id + ':' + location.id] || 0
                })).filter(row => row.quantity > 0 || row.location.id === locationId);
                return rows.map(row => (
                  <tr key={product.id + ':' + row.location.id}>
                    <td>{product.name}</td><td>{row.location.name}</td>
                    <td>{row.quantity} {product.unit}</td><td>{number(product.quantity)} {product.unit}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card">
        <h3 style={{ marginTop: 0 }}>Recent stock movements</h3>
        <div className="wrap dt">
          <table>
            <thead><tr><th>When</th><th>Product</th><th>Location</th><th>Type</th><th>Change</th><th>Before → after</th><th>Reason</th></tr></thead>
            <tbody>
              {movements.map(movement => (
                <tr key={movement.id}>
                  <td>{new Date(movement.created_at).toLocaleString('en-IN')}</td>
                  <td>{movement.products?.name || 'Product'}</td>
                  <td>{movement.stock_locations?.name || locationById[movement.location_id]?.name || '—'}</td>
                  <td>{movement.movement_type}</td>
                  <td className={number(movement.quantity_delta) < 0 ? 'neg' : 'pos'}>{number(movement.quantity_delta) > 0 ? '+' : ''}{movement.quantity_delta}</td>
                  <td>{movement.quantity_before} → {movement.quantity_after}</td>
                  <td>{movement.reason}</td>
                </tr>
              ))}
              {movements.length === 0 && <tr><td colSpan={7} className="empty">No stock movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
