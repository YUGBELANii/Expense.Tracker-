import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';
import InvoiceReconciliation from './InvoiceReconciliation';

const ok = async query => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const inr = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function PriceComparisonSection({ products = [] }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const loadBatches = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    setError('');
    try {
      const allRows = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const page = await ok(
          sb.from('purchase_batches')
            .select('id, product_id, supplier_id, quantity, buy_price, purchase_date, created_at, products(name, unit, pack_size), suppliers(name)')
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
      setError('Could not load purchase history. ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);

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

    return [...byProduct.values()].flatMap(rows => {
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
    }).sort((a, b) => a.productName.localeCompare(b.productName) || a.price - b.price);
  }, [batches]);

  const visibleRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return supplierPriceRows.filter(row =>
      !term || `${row.productName} ${row.packSize} ${row.supplierName}`.toLowerCase().includes(term)
    );
  }, [supplierPriceRows, query]);

  const comparableProductCount = useMemo(
    () => new Set(supplierPriceRows.filter(row => row.comparable).map(row => row.productId)).size,
    [supplierPriceRows]
  );

  return (
    <div className="admin-spaced-section">
      <section className="admin-card">
        <h2 className="sec"><span>Price Comparison</span></h2>
        <p className="hint">
          Compare supplier purchase rates and audit invoice prices against the prices stored in your product database.
        </p>
        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
          <button className="btn ghost small" type="button" onClick={loadBatches} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh purchase history'}
          </button>
        </div>
        {error && <div className="notice bad">{error}</div>}
      </section>

      <InvoiceReconciliation products={products} />

      <section className="admin-card">
        <h3 className="sec"><span>Supplier Price Comparison</span></h3>
        <p className="hint">
          Compares each supplier's latest recorded purchase rate for the same product, using the complete purchase history. Unit and package details are shown to avoid misleading comparisons. These are historical rates, not live quotes.
        </p>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '14px 0' }}>
          <strong>{comparableProductCount} products with multiple supplier rates</strong>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search product, package or supplier"
            aria-label="Search supplier price comparisons"
            style={{ maxWidth: 340 }}
          />
        </div>
        <div className="wrap dt">
          <table>
            <thead>
              <tr><th>Product / pack</th><th>Supplier</th><th>Latest rate</th><th>Purchase date</th><th>Difference vs lowest</th><th>Comparison</th></tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={row.productId + ':' + row.supplierId}>
                  <td>{row.productName}<br /><small>{row.packSize ? row.packSize + ' · ' : ''}{row.unit}</small></td>
                  <td>{row.supplierName}</td>
                  <td>{inr(row.price)} / {row.unit}</td>
                  <td>{row.purchaseDate || '—'}</td>
                  <td>
                    {row.lowest ? '—' : '+' + inr(row.difference) + ' / ' + row.unit}
                    {!row.lowest && row.differencePercent !== null ? <small> ({row.differencePercent.toFixed(1)}%)</small> : null}
                  </td>
                  <td>
                    {!row.comparable ? 'Only one supplier recorded' : row.lowest ? <span className="tag ok">Lowest recorded</span> : 'Higher recorded rate'}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><td colSpan={6} className="empty">
                  {loading ? 'Loading complete purchase history…' : 'No supplier comparisons yet. Record purchases with a supplier and a buy price; products need at least two suppliers to compare.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
