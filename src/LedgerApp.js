
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb } from './lib/supabase';

const TYPE = { grocery: 'Grocery', restaurant: 'Restaurant' };

const DEFAULTS = {
  grocery_customer_charge: 25,
  restaurant_customer_charge: 30,
  grocery_partner_earning: 0,
  restaurant_partner_earning: 0
};

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const fmtDate = d => d
  ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '';
const ok = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

function calc(p) {
  const q = +p.quantity || 0;
  const buy = +p.buy_price || 0;
  const sell = +p.sell_price || 0;
  const hasMrp = p.mrp !== null && p.mrp !== '' && p.mrp !== undefined;
  const invested = buy * q;
  const sellValue = sell * q;
  const profit = sellValue - invested;

  return {
    invested,
    sellValue,
    profit,
    margin: invested ? profit / invested * 100 : 0,
    hasMrp,
    mrpValue: hasMrp ? +p.mrp * q : 0
  };
}

export default function LedgerApp() {
  const [tab, setTab] = useState('stock');
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productBrand, setProductBrand] = useState(null);
  const [productManufacturer, setProductManufacturer] = useState(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productDetailError, setProductDetailError] = useState('');
  const productDialogRef = useRef(null);

  const [dMonth, setDMonth] = useState(today().slice(0, 7));
  const [dFilter, setDFilter] = useState('');
  const [dStatus, setDStatus] = useState('');
  const [dLoaded, setDLoaded] = useState(false);
  const [D, setD] = useState({
    partners: [],
    records: [],
    payments: [],
    settings: { ...DEFAULTS }
  });

  const [dlg, setDlg] = useState(null);
  const [dlgErr, setDlgErr] = useState('');
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [delForm, setDelForm] = useState({
    partner_id: '',
    delivery_type: 'grocery',
    status: 'completed',
    delivery_date: today(),
    note: ''
  });

  const refresh = useCallback(async () => {
    setLoadingProducts(true);

    try {
      if (!sb) throw new Error('Supabase is not connected.');

      const data = await ok(
        sb.from('products')
          .select(`
            id,
            name,
            category,
            unit,
            buy_price,
            sell_price,
            mrp,
            quantity,
            pack_size,
            brand_id,
            brands (
              id,
              name,
              manufacturers (
                id,
                name,
                registered_address,
                customer_care,
                website
              )
            )
          `)
          .order('name')
      );

      setProducts(data || []);
      setStatus('');
    } catch (e) {
      setStatus('Could not load products: ' + (e.message || e));
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedProduct) {
      setProductBrand(null);
      setProductManufacturer(null);
      setProductDetailError('');
      setProductDetailLoading(false);
      return;
    }
    setProductDetailLoading(false);
    setProductDetailError('');
    const b = selectedProduct.brands || null;
    setProductBrand(b);
    setProductManufacturer(b?.manufacturers || null);
  }, [selectedProduct]);

  useEffect(() => {
    const dlg = productDialogRef.current;
    if (!dlg) return;
    if (selectedProduct) {
      try { dlg.showModal(); } catch (_) { /* ignore */ }
      document.body.style.overflow = 'hidden';
    } else {
      try { dlg.close(); } catch (_) { /* ignore */ }
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedProduct]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products;

    return products.filter(p =>
      `${p.name || ''} ${p.category || ''}`.toLowerCase().includes(term)
    );
  }, [products, q]);

  const totals = useMemo(() => {
    let inv = 0;
    let profit = 0;
    let mrp = 0;
    let noMrp = 0;

    products.forEach(p => {
      const c = calc(p);
      inv += c.invested;
      profit += c.profit;
      mrp += c.mrpValue;
      if (!c.hasMrp) noMrp++;
    });

    return { inv, profit, mrp, noMrp };
  }, [products]);

  const monthRange = useCallback(() => {
    const m = dMonth || today().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const next = mo === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(mo + 1).padStart(2, '0')}-01`;

    return { start: m + '-01', next };
  }, [dMonth]);

  const loadDelivery = useCallback(async () => {
    if (!sb) {
      setDStatus('Delivery Manager needs Supabase.');
      return;
    }

    const { start, next } = monthRange();

    try {
      const [partners, settings, records, payments] = await Promise.all([
        ok(sb.from('delivery_partners').select('*').order('created_at')),
        ok(sb.from('delivery_settings').select('*').eq('id', 1)),
        ok(
          sb.from('delivery_records')
            .select('*')
            .gte('delivery_date', start)
            .lt('delivery_date', next)
            .order('delivery_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(5000)
        ),
        ok(
          sb.from('delivery_payments')
            .select('*')
            .gte('payment_date', start)
            .lt('payment_date', next)
            .order('payment_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(5000)
        )
      ]);

      setD({
        partners,
        records,
        payments,
        settings: settings[0] || { ...DEFAULTS }
      });

      setDStatus('');
      setDLoaded(true);
    } catch (e) {
      setDStatus('Could not load delivery data: ' + (e.message || e));
    }
  }, [monthRange]);

  useEffect(() => {
    if (tab === 'delivery' && !dLoaded) loadDelivery();
  }, [tab, dLoaded, loadDelivery]);

  useEffect(() => {
    if (tab === 'delivery' && dLoaded) loadDelivery();
  }, [dMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const pName = id =>
    (D.partners.find(p => p.id === id) || {}).name || 'Unknown';

  const done = D.records.filter(r => r.status === 'completed');

  const dTotals = useMemo(() => {
    const charges = sum(done, r => r.customer_charge);
    const earn = sum(done, r => r.partner_earning);
    const paid = sum(D.payments, p => p.amount);
    const g = done.filter(r => r.delivery_type === 'grocery').length;

    return {
      done: done.length,
      g,
      r: done.length - g,
      charges,
      earn,
      paid,
      bal: earn - paid
    };
  }, [done, D.payments]);

  const filteredRecords = D.records.filter(
    r => !dFilter || r.partner_id === dFilter
  );

  const activePartners = D.partners.filter(p => p.active);

  function closeDlg() {
    setDlg(null);
    setDlgErr('');
    setSavingDelivery(false);
  }

  function needData() {
    if (!dLoaded) {
      setDStatus('Delivery data has not loaded yet.');
      return true;
    }
    return false;
  }

  async function submitDel(e) {
    e.preventDefault();

    if (savingDelivery) return;
    setSavingDelivery(true);

    try {
      if (!sb) throw new Error('Supabase is not connected.');
      if (!delForm.partner_id) throw new Error('Choose a delivery partner.');
      if (!delForm.delivery_date) throw new Error('Choose the delivery date.');

      const S = (
        await ok(sb.from('delivery_settings').select('*').eq('id', 1))
      )[0] || DEFAULTS;

      await ok(
        sb.from('delivery_records').insert({
          partner_id: delForm.partner_id,
          delivery_type: delForm.delivery_type,
          status: delForm.status,
          delivery_date: delForm.delivery_date,
          customer_charge: S[delForm.delivery_type + '_customer_charge'],
          partner_earning: S[delForm.delivery_type + '_partner_earning'],
          note: delForm.note.trim() || null
        })
      );

      closeDlg();
      await loadDelivery();
    } catch (er) {
      setDlgErr(er.message || String(er));
      setSavingDelivery(false);
    }
  }

  const barBase = Math.max(
    totals.mrp,
    totals.inv + Math.max(totals.profit, 0)
  ) || 1;

  const w = v => Math.max(v, 0) / barBase * 100;

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>Stock ledger</h1>
          <span className="mode">
            {sb ? 'Connected to Supabase · Read-only products' : 'Supabase not connected'}
          </span>
        </div>

        <Link to="/admin" className="btn ghost small">
          Admin Panel
        </Link>
      </header>

      <nav className="tabs" aria-label="Sections">
        <button
          className={`tab ${tab === 'stock' ? 'on' : ''}`}
          onClick={() => setTab('stock')}
          type="button"
        >
          Stock Ledger
        </button>

        <button
          className={`tab ${tab === 'delivery' ? 'on' : ''}`}
          onClick={() => setTab('delivery')}
          type="button"
        >
          Delivery
        </button>
      </nav>

      {tab === 'stock' && (
        <div id="tab-stock" className="panel">
          <section className="totals" aria-label="Totals">
            <div className="tot">
              <span>Total invested</span>
              <b>{inr(totals.inv)}</b>
            </div>

            <div className="tot profit">
              <span>Total profit (if all stock sells)</span>
              <b className={totals.profit < 0 ? 'neg' : ''}>
                {inr(totals.profit)}
              </b>
            </div>

            <div className="tot mrp">
              <span>Total stock MRP</span>
              <b>{inr(totals.mrp)}</b>
              <br />
              <small>
                {totals.noMrp
                  ? `${totals.noMrp} loose item${totals.noMrp > 1 ? 's' : ''} without MRP not counted`
                  : ''}
              </small>
            </div>
          </section>

          <div className="bar" role="img" aria-label="Split of stock MRP">
            <i style={{ width: `${w(totals.inv)}%`, background: 'var(--leaf)' }} />
            <i style={{ width: `${w(Math.max(totals.profit, 0))}%`, background: 'var(--gold)' }} />
            <i style={{ width: `${w(Math.max(barBase - totals.inv - Math.max(totals.profit, 0), 0))}%` }} />
          </div>

          <p className="barnote">
            Green is what you paid, gold is your profit, grey is the discount customers get against MRP.
          </p>

          <div className="tools">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              type="search"
              placeholder="Search product or category"
              aria-label="Search products"
            />

            <button
              className="btn ghost"
              type="button"
              onClick={refresh}
              disabled={loadingProducts}
            >
              {loadingProducts ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          <div className="status" role="alert">{status}</div>

          <div className="ledger-records">
            <div className="wrap ledger-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Buy</th>
                    <th>Sell</th>
                    <th>MRP</th>
                    <th>Invested</th>
                    <th>Sell value</th>
                    <th>Profit</th>
                    <th>MRP value</th>
                  </tr>
                </thead>

                <tbody>
                  {shown.map(p => {
                    const c = calc(p);
                    const cls = c.profit < 0 ? 'neg' : 'pos';

                    return (
                      <tr key={p.id}>
                        <td className="name">
                          <button
                            type="button"
                            className="product-name-button"
                            onClick={() => setSelectedProduct(p)}
                          >
                            {p.name}
                          </button>
                          <small>{p.category || 'Uncategorised'}</small>
                        </td>

                        <td>{+p.quantity} {p.unit}</td>
                        <td>{inr(p.buy_price)}</td>
                        <td>{inr(p.sell_price)}</td>
                        <td>{c.hasMrp ? inr(p.mrp) : '–'}</td>
                        <td>{inr(c.invested)}</td>
                        <td>{inr(c.sellValue)}</td>

                        <td className={cls}>
                          {inr(c.profit)}
                          <small> ({c.margin.toFixed(1)}%)</small>
                        </td>

                        <td>{c.hasMrp ? inr(c.mrpValue) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!loadingProducts && products.length === 0 && (
                <div className="empty">
                  <p>No products available.</p>
                  <p>Products can only be managed from the Admin Panel.</p>
                </div>
              )}

              {!loadingProducts && products.length > 0 && shown.length === 0 && (
                <div className="empty">
                  <p>No products match your search.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'delivery' && (
        <div id="tab-delivery" className="panel">
          <div className="tools dtools">
            <label>
              Month
              <input
                type="month"
                value={dMonth}
                onChange={e => setDMonth(e.target.value)}
              />
            </label>

            <button
              className="btn"
              type="button"
              onClick={() => {
                if (needData()) return;

                if (!activePartners.length) {
                  setDStatus('No active delivery partners. Add partners in Admin Panel.');
                  return;
                }

                setDelForm({
                  partner_id: activePartners[0].id,
                  delivery_type: 'grocery',
                  status: 'completed',
                  delivery_date: today(),
                  note: ''
                });

                setDlgErr('');
                setDlg('del');
              }}
            >
              Record delivery
            </button>

            <Link to="/admin" className="btn ghost">
              Manage partners & salary (Admin)
            </Link>
          </div>

          <p className="rates">
            {`Current rates. Grocery: customer pays ${inr(D.settings.grocery_customer_charge)}, partner earns ${inr(D.settings.grocery_partner_earning)}. Restaurant: customer pays ${inr(D.settings.restaurant_customer_charge)}, partner earns ${inr(D.settings.restaurant_partner_earning)}.`}
          </p>

          <div className="status" role="alert">{dStatus}</div>

          <section className="totals" aria-label="Delivery totals">
            <div className="tot">
              <span>Completed deliveries</span>
              <b>{dTotals.done}</b>
            </div>

            <div className="tot">
              <span>Grocery deliveries</span>
              <b>{dTotals.g}</b>
            </div>

            <div className="tot">
              <span>Restaurant deliveries</span>
              <b>{dTotals.r}</b>
            </div>

            <div className="tot profit">
              <span>Partner earnings payable</span>
              <b>{inr(dTotals.earn)}</b>
            </div>

            <div className="tot">
              <span>Payments already made</span>
              <b>{inr(dTotals.paid)}</b>
            </div>

            <div className="tot profit">
              <span>
                {dTotals.bal < 0 ? 'Overpaid (advance)' : 'Remaining balance'}
              </span>
              <b className={dTotals.bal < 0 ? 'neg' : ''}>
                {inr(Math.abs(dTotals.bal))}
              </b>
            </div>
          </section>

          <h2 className="sec">
            <span>Deliveries this month</span>

            <select
              value={dFilter}
              onChange={e => setDFilter(e.target.value)}
              aria-label="Filter by partner"
            >
              <option value="">All partners</option>
              {D.partners.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </h2>

          <div className="wrap dt">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Partner</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Customer charge</th>
                  <th>Partner earns</th>
                  <th>Note</th>
                </tr>
              </thead>

              <tbody>
                {filteredRecords.map(r => (
                  <tr
                    key={r.id}
                    className={r.status === 'cancelled' ? 'cx' : ''}
                  >
                    <td>{fmtDate(r.delivery_date)}</td>
                    <td>{pName(r.partner_id)}</td>
                    <td>{TYPE[r.delivery_type]}</td>

                    <td className="tgcell">
                      <span className={`tag ${r.status === 'completed' ? 'ok' : 'bad'}`}>
                        {r.status === 'completed' ? 'Completed' : 'Cancelled'}
                      </span>
                    </td>

                    <td>{inr(r.customer_charge)}</td>
                    <td>{inr(r.partner_earning)}</td>
                    <td>{r.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredRecords.length === 0 && (
              <div className="pad">
                No deliveries recorded for this month.
              </div>
            )}
          </div>

          <p className="hint">
            Partner management, salary/rates, payments, and detailed history are available in the Admin Panel.
          </p>
        </div>
      )}

      {/* Product details */}
      <dialog
        ref={productDialogRef}
        onClose={() => setSelectedProduct(null)}
        className="product-dialog"
      >
        {selectedProduct && (() => {
          const p = selectedProduct;
          const c = calc(p);
          const unit = p.unit || 'unit';
          const unitProfit = Number(p.sell_price || 0) - Number(p.buy_price || 0);
          const brandName = productBrand?.name || null;

          return (
            <div className="f">
              <h2>{p.name}</h2>
              <p className="hint">
                {p.category || 'Uncategorised'}
                {p.pack_size ? ` · ${p.pack_size}` : ''}
              </p>

              <div className="preview">
                <span>Purchase price / {unit}</span><b>{inr(p.buy_price)}</b>
                <span>Selling price / {unit}</span><b>{inr(p.sell_price)}</b>
                <span>Profit / {unit}</span><b className={unitProfit < 0 ? 'neg' : 'pos'}>{inr(unitProfit)}</b>
                <span>Remaining quantity</span><b>{Number(p.quantity) || 0} {unit}</b>
                <span>Investment in remaining stock</span><b>{inr(c.invested)}</b>
                <span>Potential selling value</span><b>{inr(c.sellValue)}</b>
                <span>Total projected gross profit</span><b className={c.profit < 0 ? 'neg' : 'pos'}>{inr(c.profit)}</b>
                {c.hasMrp && (<><span>MRP / {unit}</span><b>{inr(p.mrp)}</b><span>Total MRP value</span><b>{inr(c.mrpValue)}</b></>)}
              </div>

              <p className="hint">
                Projected profit assumes all remaining stock sells at the current selling price. It excludes overheads, discounts, taxes and losses.
              </p>

              <h3 style={{ margin: '16px 0 8px', fontSize: '1.05rem' }}>Brand &amp; Manufacturer</h3>
              {productDetailLoading && <p className="hint">Loading brand/manufacturer…</p>}
              {productDetailError && <p className="err">{productDetailError}</p>}
              {!productDetailLoading && !productDetailError && (
                <div className="preview">
                  <span>Brand</span>
                  <b>{p.brand_id ? (brandName || 'Brand not assigned') : 'Brand not assigned'}</b>
                  <span>Manufacturer name</span>
                  <b>{productManufacturer?.name || 'Manufacturer information unavailable'}</b>
                  <span>Registered address</span>
                  <b>{productManufacturer?.registered_address || 'Manufacturer information unavailable'}</b>
                  <span>Customer care</span>
                  <b>{productManufacturer?.customer_care || 'Manufacturer information unavailable'}</b>
                  <span>Website</span>
                  <b>{productManufacturer?.website ? <a href={productManufacturer.website} target="_blank" rel="noreferrer">{productManufacturer.website}</a> : 'Manufacturer information unavailable'}</b>
                </div>
              )}

              <div className="row">
                <button type="button" className="btn" onClick={() => setSelectedProduct(null)}>Close</button>
              </div>
            </div>
          );
        })()}
      </dialog>

      <dialog
        open={dlg === 'del'}
        onClose={closeDlg}
        onCancel={closeDlg}
      >
        {dlg === 'del' && (
          <form className="f" onSubmit={submitDel} noValidate>
            <h2>Record delivery</h2>

            <div className="grid">
              <label className="full">
                Delivery partner
                <select
                  value={delForm.partner_id}
                  onChange={e => setDelForm({
                    ...delForm,
                    partner_id: e.target.value
                  })}
                >
                  {activePartners.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Delivery type
                <select
                  value={delForm.delivery_type}
                  onChange={e => setDelForm({
                    ...delForm,
                    delivery_type: e.target.value
                  })}
                >
                  <option value="grocery">Grocery delivery</option>
                  <option value="restaurant">Restaurant food delivery</option>
                </select>
              </label>

              <label>
                Status
                <select
                  value={delForm.status}
                  onChange={e => setDelForm({
                    ...delForm,
                    status: e.target.value
                  })}
                >
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <label>
                Delivery date
                <input
                  value={delForm.delivery_date}
                  onChange={e => setDelForm({
                    ...delForm,
                    delivery_date: e.target.value
                  })}
                  type="date"
                  required
                />
              </label>

              <label>
                Order reference / note
                <input
                  value={delForm.note}
                  onChange={e => setDelForm({
                    ...delForm,
                    note: e.target.value
                  })}
                  maxLength={120}
                />
              </label>
            </div>

            <div className="preview">
              <span>Customer pays (saved with this delivery)</span>
              <b>{inr(D.settings[delForm.delivery_type + '_customer_charge'])}</b>

              <span>Partner earns (saved with this delivery)</span>
              <b>{inr(D.settings[delForm.delivery_type + '_partner_earning'])}</b>
            </div>

            <p className="err">{dlgErr}</p>

            <div className="row">
              <button
                type="button"
                className="btn ghost"
                onClick={closeDlg}
              >
                Cancel
              </button>

              <button className="btn" type="submit" disabled={savingDelivery}>
                {savingDelivery ? 'Saving...' : 'Save delivery'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </main>
  );
}
