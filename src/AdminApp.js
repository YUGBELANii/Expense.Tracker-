
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { sb, isAdminUser } from './lib/supabase';
import SuppliersSection from './admin/SuppliersSection';
import PurchasesSection from './admin/PurchasesSection';
import RestockSection from './admin/RestockSection';

const TARGET_MIN = 8000;
const TARGET_MAX = 10000;

const TYPE = { grocery: 'Grocery', restaurant: 'Restaurant' };

const DEFAULTS = {
  grocery_customer_charge: 25,
  restaurant_customer_charge: 30,
  grocery_partner_earning: 0,
  restaurant_partner_earning: 0
};

const inr = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2
  });

const today = () => new Date().toLocaleDateString('en-CA');

const sum = (a, f) =>
  a.reduce((s, x) => s + (Number(f(x)) || 0), 0);

const fmtDate = d =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : '';

const ok = async q => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const emptyProduct = () => ({
  id: null,
  name: '',
  category: '',
  unit: 'piece',
  buy_price: '',
  sell_price: '',
  mrp: '',
  quantity: '',
  barcode: '',
  raw_barcode: '',
  pack_size: '',
  entered_by: '',
  supplier: '',
  invoice: '',
  purchase_date: today(),
  notes: '',
  brand_id: '',
  preferred_supplier_id: ''
});

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();

    if (!sb) return setErr('Supabase is not configured.');

    setErr('');
    setLoading(true);

    try {
      const { error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
    } catch (er) {
      setErr(er.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-shell">
      <div className="admin-card login-card">
        <h1>Admin Login</h1>
        <p className="hint">
          Sign in with an authorized Supabase administrator account.
        </p>

        <form className="f" onSubmit={submit}>
          <div className="grid">
            <label className="full">
              Email
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="full">
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </label>
          </div>

          {err && <p className="err">{err}</p>}

          <div className="row">
            <Link to="/" className="btn ghost">Back to Ledger</Link>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function AdminApp() {
  const { section: sectionParam } = useParams();
  const navigate = useNavigate();
  const section = sectionParam || 'partners';
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Delivery management
  const [partners, setPartners] = useState([]);
  const [records, setRecords] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settings, setSettings] = useState({ ...DEFAULTS });

  const [month, setMonth] = useState(today().slice(0, 7));
  const [selectedPartner, setSelectedPartner] = useState('');

  const [partnerForm, setPartnerForm] = useState({
    id: null,
    name: '',
    phone: '',
    active: true
  });

  const [payForm, setPayForm] = useState({
    partner_id: '',
    payment_date: today(),
    amount: '',
    note: ''
  });

  const [ratesForm, setRatesForm] = useState({ ...DEFAULTS });

  const [history, setHistory] = useState({
    partner_id: '',
    rows: [],
    loading: false,
    note: ''
  });

  // Product management
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productForm, setProductForm] = useState(emptyProduct());
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [brands, setBrands] = useState([]);

  // Manufacturer assigner
  const [maManufacturerId, setMaManufacturerId] = useState('');
  const [maBrandId, setMaBrandId] = useState('');
  const [maProductSearch, setMaProductSearch] = useState('');
  const [maStatusFilter, setMaStatusFilter] = useState('all');
  const [maSelectedIds, setMaSelectedIds] = useState(new Set());
  const [maSaving, setMaSaving] = useState(false);
  const [maPreviewOpen, setMaPreviewOpen] = useState(false);
  const [maNewBrandName, setMaNewBrandName] = useState('');
  const [maCreatingBrand, setMaCreatingBrand] = useState(false);

  // Shelf-life calculator / batches
  const [shelfForm, setShelfForm] = useState({
    productId: '',
    batchNo: '',
    mfd: '',
    exp: ''
  });
  const [shelfResult, setShelfResult] = useState(null);
  const [shelfError, setShelfError] = useState('');
  const [shelfSaving, setShelfSaving] = useState(false);
  const [shelfBatches, setShelfBatches] = useState([]);
  const [shelfBatchesLoading, setShelfBatchesLoading] = useState(false);
  const [shelfBatchSearch, setShelfBatchSearch] = useState('');

  // Suppliers (restock / purchases)
  const [suppliers, setSuppliers] = useState([]);

  // Manufacturers
  const [manufacturers, setManufacturers] = useState([]);
  const [manufacturerForm, setManufacturerForm] = useState({ id: null, name: '', registered_address: '', customer_care: '', website: '' });
  const [manufacturerSaving, setManufacturerSaving] = useState(false);

  // Authentication
  useEffect(() => {
    if (!sb) {
      setAuthReady(true);
      return;
    }

    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const user = session?.user;
  const allowed = !!session && isAdminUser(user);

  const loadShelfBatches = useCallback(async () => {
    if (!sb || !allowed) return;
    setShelfBatchesLoading(true);
    try {
      const data = await ok(
        sb.from('product_shelf_batches')
          .select('id, product_id, batch_number, manufacturing_date, expiry_date, total_shelf_life_days, created_at, updated_at, products(name)')
          .order('created_at', { ascending: false })
          .limit(2000)
      );
      setShelfBatches(data || []);
    } catch (e) {
      setShelfBatches([]);
    } finally {
      setShelfBatchesLoading(false);
    }
  }, [allowed]);

  // Load all admin data
  const loadAll = useCallback(async () => {
    if (!sb || !allowed) return;

    setLoading(true);
    setErr('');

    const m = month || today().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);

    const start = m + '-01';

    const next =
      mo === 12
        ? `${y + 1}-01-01`
        : `${y}-${String(mo + 1).padStart(2, '0')}-01`;

    try {
      const [ps, ss, rs, pays, productRows] = await Promise.all([
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
        ),
        ok(sb.from('products').select('*').order('name'))
      ]);

      setPartners(ps);
      setSettings(ss[0] || { ...DEFAULTS });
      setRatesForm(ss[0] || { ...DEFAULTS });
      setRecords(rs);
      setPayments(pays);
      setProducts(productRows || []);

      if (!selectedPartner && ps.length) {
        setSelectedPartner(ps[0].id);
      }
      await loadShelfBatches();
      try {
        const mans = await ok(sb.from('manufacturers').select('*').order('name'));
        setManufacturers(mans || []);
      } catch (_e) {
        setManufacturers([]);
      }
      try {
        const brs = await ok(sb.from('brands').select('id,name,manufacturer_id').order('name'));
        setBrands(brs || []);
      } catch (_e) {
        setBrands([]);
      }
      try {
        const sups = await ok(sb.from('suppliers').select('*').order('name'));
        setSuppliers(sups || []);
      } catch (_e) {
        // Table missing until the suppliers/batches SQL migration is run.
        setSuppliers([]);
      }
    } catch (e) {
      setErr(
        e.message ||
        'Failed to load admin data. Check Supabase auth/RLS policies.'
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, month, selectedPartner, loadShelfBatches]);

  useEffect(() => {
    if (allowed) loadAll();
  }, [allowed, month]); // eslint-disable-line

  async function signOut() {
    if (sb) await sb.auth.signOut();
  }

  function flash(text) {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  }

  const pName = id =>
    (partners.find(p => p.id === id) || {}).name || 'Unknown';

  // ---------------------------------
  // PRODUCT MANAGEMENT
  // ---------------------------------

  function openProductForm(product = null) {
    if (product) {
      setProductForm({
        id: product.id,
        name: product.name || '',
        category: product.category || '',
        unit: product.unit || 'piece',
        buy_price: product.buy_price ?? '',
        sell_price: product.sell_price ?? '',
        mrp: product.mrp ?? '',
        quantity: product.quantity ?? '',
        barcode: product.barcode || '',
        raw_barcode: product.raw_barcode || '',
        pack_size: product.pack_size || '',
        entered_by: product.entered_by || '',
        supplier: product.supplier || '',
        invoice: product.invoice || '',
        purchase_date: product.purchase_date || '',
        notes: product.notes || '',
        brand_id: product.brand_id || '',
        preferred_supplier_id: product.preferred_supplier_id || ''
      });
    } else {
      setProductForm(emptyProduct());
    }

    setProductFormOpen(true);
    setErr('');
    setMsg('');
  }

  function closeProductForm() {
    setProductFormOpen(false);
    setProductForm(emptyProduct());
  }

  async function saveProduct(e) {
    e.preventDefault();

    if (productSaving) return;

    setErr('');

    const f = productForm;

    const buy = Number(f.buy_price);
    const sell = Number(f.sell_price);
    const quantity = Number(f.quantity);
    const mrp = f.mrp === '' ? null : Number(f.mrp);

    if (!f.name.trim()) {
      setErr('Enter a product name.');
      return;
    }

    if (
      f.buy_price === '' ||
      f.sell_price === '' ||
      f.quantity === '' ||
      !Number.isFinite(buy) ||
      !Number.isFinite(sell) ||
      !Number.isFinite(quantity) ||
      buy < 0 ||
      sell < 0 ||
      quantity < 0
    ) {
      setErr('Enter valid non-negative prices and quantity.');
      return;
    }

    if (mrp !== null && (!Number.isFinite(mrp) || mrp < 0)) {
      setErr('Enter a valid MRP.');
      return;
    }

    if (mrp !== null && sell > mrp) {
      setErr('Selling price cannot be higher than MRP.');
      return;
    }

    if (
      sell < buy &&
      !window.confirm(
        'Selling price is below buying price. You will lose money on every unit. Save anyway?'
      )
    ) {
      return;
    }

    const payload = {
      name: f.name.trim(),
      category: f.category.trim() || null,
      unit: f.unit || 'piece',
      buy_price: buy,
      sell_price: sell,
      mrp,
      quantity,
      barcode: f.barcode.trim() || null,
      raw_barcode: f.raw_barcode.trim() || null,
      pack_size: f.pack_size.trim() || null,
      entered_by: f.entered_by.trim() || null,
      supplier: f.supplier.trim() || null,
      invoice: f.invoice.trim() || null,
      purchase_date: f.purchase_date || null,
      notes: f.notes.trim() || null,
      brand_id: f.brand_id || null,
      preferred_supplier_id: f.preferred_supplier_id || null
    };

    setProductSaving(true);

    try {
      if (!sb) throw new Error('Supabase is not configured.');

      if (f.id) {
        await ok(
          sb.from('products')
            .update(payload)
            .eq('id', f.id)
        );

        flash('Product updated successfully.');
      } else {
        await ok(
          sb.from('products').insert(payload)
        );

        flash('Product added successfully.');
      }

      closeProductForm();
      await loadAll();
    } catch (er) {
      setErr('Could not save product: ' + (er.message || er));
    } finally {
      setProductSaving(false);
    }
  }

  async function deleteProduct(product) {
    if (
      !window.confirm(
        `Delete "${product.name}" permanently? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await ok(
        sb.from('products')
          .delete()
          .eq('id', product.id)
      );

      setProducts(old => old.filter(p => p.id !== product.id));
      flash('Product deleted.');
    } catch (er) {
      setErr('Could not delete product: ' + (er.message || er));
    }
  }

  const categories = useMemo(() => {
    return [...new Set(
      products
        .map(p => p.category)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();

    return products.filter(p => {
      const matchesCategory =
        !productCategory || p.category === productCategory;

      const searchable = [
        p.name,
        p.category,
        p.barcode,
        p.raw_barcode,
        p.supplier,
        p.invoice
      ].join(' ').toLowerCase();

      return matchesCategory && searchable.includes(term);
    });
  }, [products, productSearch, productCategory]);

  const productTotals = useMemo(() => {
    let quantity = 0;
    let invested = 0;
    let sellValue = 0;
    let profit = 0;

    products.forEach(p => {
      const q = Number(p.quantity) || 0;
      const buy = Number(p.buy_price) || 0;
      const sell = Number(p.sell_price) || 0;

      quantity += q;
      invested += q * buy;
      sellValue += q * sell;
      profit += q * (sell - buy);
    });

    return { quantity, invested, sellValue, profit };
  }, [products]);

  // ---------------------------------
  // DELIVERY MANAGEMENT
  // ---------------------------------

  async function savePartner(e) {
    e.preventDefault();
    setErr('');

    if (!partnerForm.name.trim()) {
      return setErr('Enter partner name.');
    }

    try {
      if (partnerForm.id) {
        await ok(
          sb.from('delivery_partners')
            .update({
              name: partnerForm.name.trim(),
              phone: partnerForm.phone.trim() || null,
              active: partnerForm.active
            })
            .eq('id', partnerForm.id)
        );

        flash('Partner updated.');
      } else {
        await ok(
          sb.from('delivery_partners').insert({
            name: partnerForm.name.trim(),
            phone: partnerForm.phone.trim() || null,
            active: true
          })
        );

        flash('Partner created.');
      }

      setPartnerForm({
        id: null,
        name: '',
        phone: '',
        active: true
      });

      await loadAll();
    } catch (er) {
      setErr(er.message || 'Failed to save partner.');
    }
  }

  async function softDeletePartner(p) {
    if (
      !window.confirm(
        `Archive/delete partner "${p.name}"? This will deactivate them but keep all historical delivery and salary records.`
      )
    ) {
      return;
    }

    try {
      await ok(
        sb.from('delivery_partners')
          .update({ active: false })
          .eq('id', p.id)
      );

      flash('Partner archived. Historical records preserved.');
      await loadAll();
    } catch (er) {
      setErr(er.message || 'Failed to archive partner.');
    }
  }

  async function saveRates(e) {
    e.preventDefault();
    setErr('');

    try {
      const row = {
        id: 1,
        updated_at: new Date().toISOString()
      };

      for (const k in DEFAULTS) {
        const v = Number(ratesForm[k]);

        if (ratesForm[k] === '' || !(v >= 0)) {
          throw new Error(
            'Enter a valid amount (0 or more) for every rate.'
          );
        }

        row[k] = v;
      }

      await ok(sb.from('delivery_settings').upsert(row));

      flash(
        'Delivery rates/salary rates saved. New rates apply to future deliveries only.'
      );

      await loadAll();
    } catch (er) {
      setErr(er.message || 'Failed to save rates.');
    }
  }

  async function savePayment(e) {
    e.preventDefault();
    setErr('');

    const amount = Number(payForm.amount);

    if (!payForm.partner_id) return setErr('Choose a partner.');
    if (!payForm.payment_date) return setErr('Choose payment date.');
    if (!(amount > 0)) return setErr('Enter amount greater than zero.');

    try {
      await ok(
        sb.from('delivery_payments').insert({
          partner_id: payForm.partner_id,
          amount,
          payment_date: payForm.payment_date,
          note: payForm.note.trim() || null
        })
      );

      setPayForm(f => ({
        ...f,
        amount: '',
        note: ''
      }));

      flash('Payment recorded.');
      await loadAll();
    } catch (er) {
      setErr(er.message || 'Failed to record payment.');
    }
  }

  async function deletePayment(id) {
    if (
      !window.confirm(
        'Delete this payment entry? Use only to fix a mistake.'
      )
    ) {
      return;
    }

    try {
      await ok(
        sb.from('delivery_payments')
          .delete()
          .eq('id', id)
      );

      flash('Payment deleted.');
      await loadAll();
    } catch (er) {
      setErr(er.message || 'Failed to delete payment.');
    }
  }

  async function loadHistory(partner_id) {
    setHistory({
      partner_id,
      rows: [],
      payments: [],
      loading: true,
      note: 'Loading...'
    });

    try {
      const rows = await ok(
        sb.from('delivery_records')
          .select('*')
          .eq('partner_id', partner_id)
          .order('delivery_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1000)
      );

      const done = rows.filter(r => r.status === 'completed');

      const payRows = await ok(
        sb.from('delivery_payments')
          .select('*')
          .eq('partner_id', partner_id)
          .order('payment_date', { ascending: false })
          .limit(1000)
      );

      setHistory({
        partner_id,
        rows,
        payments: payRows,
        loading: false,
        note:
          `${done.length} completed of ${rows.length} deliveries (latest 1000). ` +
          `Lifetime earnings: ${inr(sum(done, r => r.partner_earning))}, ` +
          `lifetime payments: ${inr(sum(payRows, p => p.amount))}.`
      });
    } catch (er) {
      setHistory(h => ({
        ...h,
        loading: false,
        note: 'Failed to load history: ' + (er.message || er)
      }));
    }
  }

  useEffect(() => {
    if (section === 'history' && selectedPartner) {
      loadHistory(selectedPartner);
    }
  }, [section, selectedPartner]); // eslint-disable-line

  const monthRecords = records;
  const monthPayments = payments;
  const done = monthRecords.filter(r => r.status === 'completed');

  const shelfBatchesFiltered = (() => {
    const term = (shelfBatchSearch || '').trim().toLowerCase();
    return shelfBatches.filter(b => {
      const pname = (b.products?.name || (products.find(p => String(p.id) === String(b.product_id)) || {}).name || '').toLowerCase();
      const bno = (b.batch_number || '').toLowerCase();
      const matchesTerm = !term || pname.includes(term) || bno.includes(term);
      const matchesSelected = !shelfForm.productId || String(b.product_id) === String(shelfForm.productId);
      return matchesTerm && matchesSelected;
    });
  })();

  function shelfBatchStatus(expiryDate) {
    const exp = new Date(String(expiryDate) + 'T00:00:00');
    const t = new Date(today() + 'T00:00:00');
    const msPerDay = 1000 * 60 * 60 * 24;
    const rem = Math.round((exp - t) / msPerDay);
    if (rem < 0) return { label: 'Expired', rem };
    if (rem <= 30) return { label: 'Expiring Soon', rem };
    return { label: 'Valid', rem };
  }

  const maBrands = useMemo(() => {
    if (!maManufacturerId) return [];
    return brands.filter(b => String(b.manufacturer_id || '') === String(maManufacturerId));
  }, [brands, maManufacturerId]);

  const maProductsFiltered = useMemo(() => {
    const term = (maProductSearch || '').trim().toLowerCase();
    return products.filter(p => {
      if (term && !(p.name || '').toLowerCase().includes(term)) return false;
      if (maStatusFilter === 'unassigned' && p.brand_id) return false;
      if (maStatusFilter === 'assignedToSelected' && String(p.brand_id || '') !== String(maBrandId || '')) return false;
      if (maStatusFilter === 'assignedOther' && (!p.brand_id || String(p.brand_id) === String(maBrandId || ''))) return false;
      return true;
    });
  }, [products, maProductSearch, maStatusFilter, maBrandId]);

  // ---------------------------------
  // AUTHORIZATION SCREENS
  // ---------------------------------

  if (!authReady) {
    return (
      <main className="admin-shell">
        <div className="admin-card">Loading...</div>
      </main>
    );
  }

  if (!sb) {
    return (
      <main className="admin-shell">
        <div className="admin-card">
          <h1>Admin Panel</h1>
          <p className="err">Supabase is not configured in this app.</p>
          <Link to="/" className="btn ghost">Back</Link>
        </div>
      </main>
    );
  }

  if (!session) return <Login />;

  if (!allowed) {
    return (
      <main className="admin-shell">
        <div className="admin-card">
          <h1>Access denied</h1>

          <p>
            You are signed in as <b>{user?.email}</b> but this account is not
            authorized as an administrator.
          </p>

          <p className="hint">
            Admin access requires an authorized account with
            {' '}<code>app_metadata.role = "admin"</code> and matching
            Supabase RLS policies.
          </p>

          <div className="row">
            <Link to="/" className="btn ghost">Back to Ledger</Link>
            <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  // ---------------------------------
  // SHELF-LIFE CALCULATOR
  // ---------------------------------
  function extractBrand(name) {
    return (name || '').trim().split(/\s+/)[0] || '';
  }

  function calcShelfLife(e) {
    e.preventDefault();
    setShelfError('');
    setShelfResult(null);

    const prod = products.find(p => String(p.id) === String(shelfForm.productId));
    if (!prod) {
      setShelfError('Please select a valid existing product.');
      return;
    }
    const batchNo = (shelfForm.batchNo || '').trim();
    if (!batchNo) {
      setShelfError('Batch number is required.');
      return;
    }
    if (!shelfForm.mfd) {
      setShelfError('Manufacturing date (MFD) is required.');
      return;
    }
    if (!shelfForm.exp) {
      setShelfError('Expiry date (EXP) is required.');
      return;
    }

    const mfdDate = new Date(shelfForm.mfd + 'T00:00:00');
    const expDate = new Date(shelfForm.exp + 'T00:00:00');
    const todayDate = new Date(today() + 'T00:00:00');

    if (Number.isNaN(mfdDate.getTime()) || Number.isNaN(expDate.getTime())) {
      setShelfError('Invalid date value.');
      return;
    }
    if (mfdDate > todayDate) {
      setShelfError('Manufacturing date cannot be in the future.');
      return;
    }
    if (expDate < mfdDate) {
      setShelfError('Expiry date cannot be earlier than manufacturing date.');
      return;
    }

    const msPerDay = 1000 * 60 * 60 * 24;
    const totalDays = Math.round((expDate - mfdDate) / msPerDay);
    const remainingDays = Math.round((expDate - todayDate) / msPerDay);

    let status = 'Valid';
    if (remainingDays < 0) status = 'Expired';
    else if (remainingDays <= 30) status = 'Expiring Soon';

    const brand = extractBrand(prod.name);
    const result = {
      productId: prod.id,
      productName: prod.name || '',
      brand,
      batchNo,
      mfd: shelfForm.mfd,
      exp: shelfForm.exp,
      totalShelfLifeDays: totalDays,
      remainingShelfLifeDays: remainingDays,
      status
    };
    setShelfResult(result);
  }

  async function saveShelfBatch() {
    setShelfError('');
    if (!shelfResult) {
      setShelfError('Calculate shelf life first before saving.');
      return;
    }
    setShelfSaving(true);
    try {
      if (!sb) throw new Error('Supabase is not configured.');
      await ok(
        sb.from('product_shelf_batches').insert({
          product_id: shelfResult.productId,
          batch_number: shelfResult.batchNo,
          manufacturing_date: shelfResult.mfd,
          expiry_date: shelfResult.exp,
          total_shelf_life_days: shelfResult.totalShelfLifeDays
        })
      );
      setMsg('Batch saved successfully.');
      setTimeout(() => setMsg(''), 3000);
      await loadShelfBatches();
    } catch (er) {
      const msgText = (er && er.message) ? er.message : String(er);
      if (msgText.includes('duplicate key') || msgText.includes('unique') || er?.code === '23505') {
        setShelfError('Duplicate batch: this batch number already exists for the selected product.');
      } else {
        setShelfError('Failed to save batch: ' + msgText);
      }
    } finally {
      setShelfSaving(false);
    }
  }

  async function saveManufacturer(e) {
    e.preventDefault();
    setErr('');
    if (!manufacturerForm.name.trim()) {
      setErr('Manufacturer name is required.');
      return;
    }
    setManufacturerSaving(true);
    try {
      const payload = {
        name: manufacturerForm.name.trim(),
        registered_address: manufacturerForm.registered_address.trim() || null,
        customer_care: manufacturerForm.customer_care.trim() || null,
        website: manufacturerForm.website.trim() || null
      };
      if (manufacturerForm.id) {
        await ok(sb.from('manufacturers').update(payload).eq('id', manufacturerForm.id));
        setMsg('Manufacturer updated.');
      } else {
        await ok(sb.from('manufacturers').insert(payload));
        setMsg('Manufacturer created.');
      }
      setTimeout(() => setMsg(''), 3000);
      setManufacturerForm({ id: null, name: '', registered_address: '', customer_care: '', website: '' });
      const mans = await ok(sb.from('manufacturers').select('*').order('name'));
      setManufacturers(mans || []);
    } catch (er) {
      setErr('Failed to save manufacturer: ' + (er.message || er));
    } finally {
      setManufacturerSaving(false);
    }
  }

  async function createMaBrand() {
    setErr('');
    const name = (maNewBrandName || '').trim();
    if (!maManufacturerId) { setErr('Select a manufacturer first.'); return; }
    if (!name) { setErr('Enter a brand name.'); return; }
    setMaCreatingBrand(true);
    try {
      const { data, error } = await sb.from('brands').insert({ name, manufacturer_id: maManufacturerId }).select('id,name,manufacturer_id').single();
      if (error) throw error;
      setBrands(prev => [...prev, data].sort((a,b) => (a.name||'').localeCompare(b.name||'')));
      setMaBrandId(data.id);
      setMaNewBrandName('');
      setMsg('Brand created and selected.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setErr('Failed to create brand: ' + (e.message || e));
    } finally {
      setMaCreatingBrand(false);
    }
  }

  function openMaPreview() {
    setErr('');
    if (!maManufacturerId) { setErr('Select a manufacturer first.'); return; }
    if (maSelectedIds.size === 0) { setErr('Select at least one product to assign.'); return; }
    setMaPreviewOpen(true);
  }

  async function applyManufacturerAssignments() {
    if (maSaving) return;
    const ids = Array.from(maSelectedIds);
    if (ids.length === 0) { setErr('No products selected.'); return; }
    setMaSaving(true);
    setErr('');
    let okCount = 0;
    let failCount = 0;
    try {
      let targetBrandId = maBrandId || null;
      if (!targetBrandId && maManufacturerId) {
        // Find or create a default brand for this manufacturer
        const m = manufacturers.find(x => String(x.id) === String(maManufacturerId));
        const defaultName = m?.name ? `${m.name} (Default)` : 'Default Brand';
        let existing = brands.find(b => String(b.manufacturer_id || '') === String(maManufacturerId) && (b.name || '').toLowerCase() === defaultName.toLowerCase());
        if (!existing) {
          // try any brand with same name as manufacturer
          existing = brands.find(b => String(b.manufacturer_id || '') === String(maManufacturerId) && (b.name || '').toLowerCase() === (m?.name || '').toLowerCase());
        }
        if (existing) {
          targetBrandId = existing.id;
        } else {
          const { data: newBrand, error: be } = await sb.from('brands').insert({ name: defaultName, manufacturer_id: maManufacturerId }).select('id,name,manufacturer_id').single();
          if (be) throw be;
          targetBrandId = newBrand.id;
          // refresh brands list locally
          setBrands(prev => [...prev, newBrand].sort((a,b) => (a.name||'').localeCompare(b.name||'')));
        }
      }
      for (const pid of ids) {
        try {
          await ok(sb.from('products').update({ brand_id: targetBrandId }).eq('id', pid));
          okCount++;
        } catch (_e) {
          failCount++;
        }
      }
      setMsg(targetBrandId ? `Assigned ${okCount} product(s) (brand set). Failed: ${failCount}.` : `Unassigned ${okCount} product(s). Failed: ${failCount}.`);
      setTimeout(() => setMsg(''), 4000);
      setMaSelectedIds(new Set());
      setMaPreviewOpen(false);
      await loadAll();
    } catch (e) {
      setErr('Bulk assignment failed: ' + (e.message || e));
    } finally {
      setMaSaving(false);
    }
  }

  // ---------------------------------
  // AUTHORIZATION SCREENS
  // ---------------------------------

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>Admin Panel</h1>
          <span className="mode">Signed in as {user.email}</span>
        </div>

        <div className="row">
          <button
            className="btn ghost small"
            onClick={loadAll}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>

          <button className="btn small" onClick={signOut}>
            Logout
          </button>
        </div>
      </header>

      {msg && <div className="notice ok">{msg}</div>}
      {err && <div className="notice bad">{err}</div>}
      {loading && <div className="notice">Loading data...</div>}

      {/* PRODUCTS - intentionally unchanged */}

      {section === 'products' && (
        <section className="admin-card">
          <h2 className="sec">
            <span>Product Management</span>
          </h2>

          <section className="totals">
            <div className="tot">
              <span>Total products</span>
              <b>{products.length}</b>
            </div>

            <div className="tot">
              <span>Total stock quantity</span>
              <b>{productTotals.quantity.toLocaleString('en-IN')}</b>
            </div>

            <div className="tot">
              <span>Total invested</span>
              <b>{inr(productTotals.invested)}</b>
            </div>

            <div className="tot profit">
              <span>Potential profit</span>
              <b className={productTotals.profit < 0 ? 'neg' : ''}>
                {inr(productTotals.profit)}
              </b>
            </div>
          </section>

          <div className="tools">
            <input
              type="search"
              placeholder="Search name, barcode, supplier, invoice..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              aria-label="Search products"
            />

            <select
              value={productCategory}
              onChange={e => setProductCategory(e.target.value)}
              aria-label="Filter category"
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <button
              className="btn"
              type="button"
              onClick={() => openProductForm()}
            >
              + Add product
            </button>
          </div>

          {productFormOpen && (
            <form
              className="f"
              onSubmit={saveProduct}
              style={{
                marginBottom: 24,
                border: '1px solid var(--line, #ddd)',
                borderRadius: 12
              }}
            >
              <h3>
                {productForm.id ? 'Edit product' : 'Add new product'}
              </h3>

              <div className="grid">
                <label className="full">
                  Product name *
                  <input
                    value={productForm.name}
                    onChange={e => setProductForm({
                      ...productForm,
                      name: e.target.value
                    })}
                    maxLength={150}
                    required
                  />
                </label>

                <label>
                  Category
                  <input
                    list="product-categories"
                    value={productForm.category}
                    onChange={e => setProductForm({
                      ...productForm,
                      category: e.target.value
                    })}
                    placeholder="e.g. Grocery"
                  />
                </label>

                <label>
                  Brand (optional)
                  <select
                    value={productForm.brand_id || ''}
                    onChange={e => setProductForm({ ...productForm, brand_id: e.target.value })}
                  >
                    <option value="">— No brand —</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>

                <label>
                  Preferred supplier (optional)
                  <select
                    value={productForm.preferred_supplier_id || ''}
                    onChange={e => setProductForm({ ...productForm, preferred_supplier_id: e.target.value })}
                  >
                    <option value="">— None —</option>
                    {(suppliers || []).filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>

                <label>
                  Unit
                  <select
                    value={productForm.unit}
                    onChange={e => setProductForm({
                      ...productForm,
                      unit: e.target.value
                    })}
                  >
                    <option value="piece">Piece</option>
                    <option value="pcs">Pcs</option>
                    <option value="kg">Kg</option>
                    <option value="g">Gram</option>
                    <option value="pack">Pack</option>
                    <option value="litre">Litre</option>
                    <option value="ml">ML</option>
                    <option value="dozen">Dozen</option>
                    <option value="box">Box</option>
                  </select>
                </label>

                <datalist id="product-categories">
                  {categories.map(c => <option key={c} value={c} />)}
                  <option value="Rice & grains" />
                  <option value="Pulses" />
                  <option value="Oil & ghee" />
                  <option value="Spices" />
                  <option value="Snacks" />
                  <option value="Vegetables" />
                  <option value="Dairy" />
                </datalist>

                <label>
                  Buy price (₹) *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.buy_price}
                    onChange={e => setProductForm({
                      ...productForm,
                      buy_price: e.target.value
                    })}
                    required
                  />
                </label>

                <label>
                  Sell price (₹) *
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.sell_price}
                    onChange={e => setProductForm({
                      ...productForm,
                      sell_price: e.target.value
                    })}
                    required
                  />
                </label>

                <label>
                  MRP (₹)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.mrp}
                    onChange={e => setProductForm({
                      ...productForm,
                      mrp: e.target.value
                    })}
                  />
                </label>

                <label>
                  Quantity *
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={productForm.quantity}
                    onChange={e => setProductForm({
                      ...productForm,
                      quantity: e.target.value
                    })}
                    required
                  />
                </label>

                <label>
                  Barcode
                  <input
                    value={productForm.barcode}
                    onChange={e => setProductForm({
                      ...productForm,
                      barcode: e.target.value
                    })}
                  />
                </label>

                <label>
                  Raw barcode
                  <input
                    value={productForm.raw_barcode}
                    onChange={e => setProductForm({
                      ...productForm,
                      raw_barcode: e.target.value
                    })}
                  />
                </label>

                <label>
                  Pack size
                  <input
                    value={productForm.pack_size}
                    onChange={e => setProductForm({
                      ...productForm,
                      pack_size: e.target.value
                    })}
                    placeholder="e.g. 500g"
                  />
                </label>

                <label>
                  Supplier
                  <input
                    value={productForm.supplier}
                    onChange={e => setProductForm({
                      ...productForm,
                      supplier: e.target.value
                    })}
                  />
                </label>

                <label>
                  Invoice number
                  <input
                    value={productForm.invoice}
                    onChange={e => setProductForm({
                      ...productForm,
                      invoice: e.target.value
                    })}
                  />
                </label>

                <label>
                  Purchase date
                  <input
                    type="date"
                    value={productForm.purchase_date}
                    onChange={e => setProductForm({
                      ...productForm,
                      purchase_date: e.target.value
                    })}
                  />
                </label>

                <label>
                  Entered by
                  <input
                    value={productForm.entered_by}
                    onChange={e => setProductForm({
                      ...productForm,
                      entered_by: e.target.value
                    })}
                  />
                </label>

                <label className="full">
                  Notes
                  <textarea
                    value={productForm.notes}
                    onChange={e => setProductForm({
                      ...productForm,
                      notes: e.target.value
                    })}
                    rows={3}
                  />
                </label>
              </div>

              <div className="preview">
                <span>Investment</span>
                <b>
                  {inr(
                    (Number(productForm.buy_price) || 0) *
                    (Number(productForm.quantity) || 0)
                  )}
                </b>

                <span>Potential selling value</span>
                <b>
                  {inr(
                    (Number(productForm.sell_price) || 0) *
                    (Number(productForm.quantity) || 0)
                  )}
                </b>

                <span>Potential profit</span>
                <b>
                  {inr(
                    (
                      (Number(productForm.sell_price) || 0) -
                      (Number(productForm.buy_price) || 0)
                    ) * (Number(productForm.quantity) || 0)
                  )}
                </b>
              </div>

              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={closeProductForm}
                  disabled={productSaving}
                >
                  Cancel
                </button>

                <button
                  className="btn"
                  type="submit"
                  disabled={productSaving}
                >
                  {productSaving
                    ? 'Saving...'
                    : productForm.id
                      ? 'Update product'
                      : 'Save product'}
                </button>
              </div>
            </form>
          )}

          <div className="wrap dt">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Buy</th>
                  <th>Sell</th>
                  <th>MRP</th>
                  <th>Investment</th>
                  <th>Potential profit</th>
                  <th>Supplier</th>
                  <th>Invoice</th>
                  <th>Purchase date</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(p => {
                  const quantity = Number(p.quantity) || 0;
                  const buy = Number(p.buy_price) || 0;
                  const sell = Number(p.sell_price) || 0;
                  const investment = buy * quantity;
                  const profit = (sell - buy) * quantity;

                  return (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name}</b>
                        <small>{p.category || 'Uncategorised'}</small>
                        {p.barcode && <small>Barcode: {p.barcode}</small>}
                      </td>

                      <td>{quantity} {p.unit}</td>
                      <td>{inr(buy)}</td>
                      <td>{inr(sell)}</td>
                      <td>{p.mrp == null ? '–' : inr(p.mrp)}</td>
                      <td>{inr(investment)}</td>

                      <td className={profit < 0 ? 'neg' : 'pos'}>
                        {inr(profit)}
                      </td>

                      <td>{p.supplier || '–'}</td>
                      <td>{p.invoice || '–'}</td>
                      <td>{fmtDate(p.purchase_date) || '–'}</td>

                      <td>
                        <div className="act">
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => openProductForm(p)}
                          >
                            Edit
                          </button>

                          <button
                            className="btn ghost small danger"
                            type="button"
                            onClick={() => deleteProduct(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredProducts.length === 0 && (
              <div className="pad">
                {products.length === 0
                  ? 'No products available. Add your first product above.'
                  : 'No products match your search or category filter.'}
              </div>
            )}
          </div>

          <p className="hint">
            Product changes are saved directly to Supabase. The public Stock
            Ledger can view products but does not provide product editing.
          </p>
        </section>
      )}

      {/* PARTNERS */}

      {section === 'brandAssignment' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec"><span>Manufacturer Assigner</span></h2>
          <p className="hint">Workflow: select a manufacturer → choose one of its brands → search/select existing products → preview and confirm. Only <code>products.brand_id</code> is updated.</p>

          <div className="grid" style={{ maxWidth: 900 }}>
            <label className="full">
              Manufacturer (primary)
              <select value={maManufacturerId} onChange={e => { setMaManufacturerId(e.target.value); setMaBrandId(''); setMaSelectedIds(new Set()); setMaPreviewOpen(false); }}>
                <option value="">— Select manufacturer —</option>
                {manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {maManufacturerId && (() => {
              const m = manufacturers.find(x => String(x.id) === String(maManufacturerId));
              return m ? (
                <div className="full hint" style={{ marginTop: -8 }}>
                  {m.registered_address && <div><b>Address:</b> {m.registered_address}</div>}
                  {m.customer_care && <div><b>Customer care:</b> {m.customer_care}</div>}
                  {m.website && <div><b>Website:</b> {m.website}</div>}
                </div>
              ) : null;
            })()}
            <label className="full">
              Brand (optional). If none selected, a default brand will be created/used under this manufacturer.
              <select value={maBrandId} onChange={e => { setMaBrandId(e.target.value); setMaSelectedIds(new Set()); setMaPreviewOpen(false); }} disabled={!maManufacturerId}>
                <option value="">— Use/create default brand under manufacturer —</option>
                {maBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {maManufacturerId && (
              <div className="full" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" placeholder="New brand name for this manufacturer" value={maNewBrandName} onChange={e => setMaNewBrandName(e.target.value)} style={{ flex: '1 1 220px', padding: 8 }} />
                <button type="button" className="btn ghost small" onClick={createMaBrand} disabled={maCreatingBrand || !maNewBrandName.trim()}>{maCreatingBrand ? 'Creating…' : 'Create brand'}</button>
              </div>
            )}
            {maManufacturerId && maBrands.length === 0 && <p className="hint full">No brands linked yet — you can create one above.</p>}
          </div>

          <div className="tools" style={{ flexWrap: 'wrap', marginTop: 16 }}>
            <input type="search" placeholder="Search products by name…" value={maProductSearch} onChange={e => setMaProductSearch(e.target.value)} aria-label="Search products" />
            <select value={maStatusFilter} onChange={e => setMaStatusFilter(e.target.value)}>
              <option value="all">All products</option>
              <option value="unassigned">Unassigned (no brand)</option>
              <option value="assignedToSelected">Assigned to selected brand</option>
              <option value="assignedOther">Assigned to other brand</option>
            </select>
          </div>

          <div className="wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table>
              <thead><tr><th></th><th style={{ textAlign: 'left' }}>Product</th><th>Current brand</th></tr></thead>
              <tbody>
                {maProductsFiltered.length === 0 && <tr><td colSpan={3} className="empty">No products match filters.</td></tr>}
                {maProductsFiltered.map(p => {
                  const currentBrandName = brands.find(b => String(b.id) === String(p.brand_id))?.name || 'Unassigned';
                  return (
                    <tr key={p.id}>
                      <td><input type="checkbox" checked={maSelectedIds.has(p.id)} onChange={e => {
                        const next = new Set(maSelectedIds);
                        if (e.target.checked) next.add(p.id); else next.delete(p.id);
                        setMaSelectedIds(next);
                      }} /></td>
                      <td style={{ textAlign: 'left' }}>{p.name}</td>
                      <td>{currentBrandName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {maPreviewOpen && (
            <div className="admin-card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Preview (confirm before saving)</h3>
              <p className="hint">Set brand for <b>{maSelectedIds.size}</b> product(s) to <b>{maBrandId ? (brands.find(b => String(b.id) === String(maBrandId))?.name || 'selected brand') : `a default brand under the selected manufacturer (created if needed)`}</b>. Only <code>brand_id</code> will change.</p>
              <ul style={{ maxHeight: 200, overflow: 'auto' }}>
                {Array.from(maSelectedIds).slice(0, 200).map(id => {
                  const p = products.find(x => String(x.id) === String(id));
                  return <li key={id}>{p?.name || id}</li>;
                })}
                {maSelectedIds.size > 200 && <li>…and {maSelectedIds.size - 200} more</li>}
              </ul>
              <div className="row">
                <button className="btn ghost" type="button" onClick={() => setMaPreviewOpen(false)}>Cancel</button>
                <button className="btn" type="button" disabled={maSaving} onClick={applyManufacturerAssignments}>{maSaving ? 'Saving…' : 'Confirm & assign'}</button>
              </div>
            </div>
          )}

          {!maPreviewOpen && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="button" disabled={maSaving} onClick={openMaPreview}>Preview assignment ({maSelectedIds.size} selected)</button>
            </div>
          )}
          <p className="hint" style={{ marginTop: 8 }}>No automatic name-based assignment. You manually select manufacturer → brand → products, then confirm.</p>
        </section>
      )}

      {section === 'shelfLife' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec"><span>Product Shelf-Life Calculator</span></h2>
          <p className="hint">Select an existing product, enter batch details and dates. Click <b>Calculate</b> to compute (no save). Click <b>Save to database</b> to store the calculated batch (requires <code>product_shelf_batches</code> table).</p>
          <form className="f" onSubmit={calcShelfLife} style={{ maxWidth: 720 }}>
            {shelfError && <div className="notice bad">{shelfError}</div>}
            <div className="grid">
              <label className="full">
                Product (existing) *
                <select
                  value={shelfForm.productId}
                  onChange={e => { setShelfForm({ ...shelfForm, productId: e.target.value }); setShelfResult(null); }}
                  required
                >
                  <option value="">-- Select product --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Batch number *
                <input
                  type="text"
                  value={shelfForm.batchNo}
                  onChange={e => { setShelfForm({ ...shelfForm, batchNo: e.target.value }); setShelfResult(null); }}
                  placeholder="e.g. BATCH-001"
                  required
                />
              </label>
              <label>
                Manufacturing date (MFD) *
                <input
                  type="date"
                  value={shelfForm.mfd}
                  onChange={e => { setShelfForm({ ...shelfForm, mfd: e.target.value }); setShelfResult(null); }}
                  required
                />
              </label>
              <label>
                Expiry date (EXP) *
                <input
                  type="date"
                  value={shelfForm.exp}
                  onChange={e => { setShelfForm({ ...shelfForm, exp: e.target.value }); setShelfResult(null); }}
                  required
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn" type="submit">Calculate</button>
              <button className="btn" type="button" onClick={saveShelfBatch} disabled={shelfSaving || !shelfResult}>
                {shelfSaving ? 'Saving...' : 'Save to database'}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => { setShelfForm({ productId: '', batchNo: '', mfd: '', exp: '' }); setShelfResult(null); setShelfError(''); }}
              >
                Reset
              </button>
            </div>
          </form>

          {shelfResult && (
            <div className="admin-card" style={{ marginTop: 16, maxWidth: 720 }}>
              <h3 style={{ marginTop: 0 }}>Calculated result</h3>
              <div className="st">
                <span>Product name</span><b>{shelfResult.productName}</b>
                <span>Brand (prefix)</span><b>{shelfResult.brand || '(none)'}</b>
                <span>Batch number</span><b>{shelfResult.batchNo}</b>
                <span>MFD</span><b>{fmtDate(shelfResult.mfd)}</b>
                <span>EXP</span><b>{fmtDate(shelfResult.exp)}</b>
                <span>Total shelf life</span><b>{shelfResult.totalShelfLifeDays} days</b>
                <span>Remaining shelf life (now)</span><b>{shelfResult.remainingShelfLifeDays} days</b>
                <span>Current status</span>
                <b className={shelfResult.status === 'Expired' ? 'neg' : shelfResult.status === 'Expiring Soon' ? '' : 'pos'}>
                  {shelfResult.status}
                </b>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <h3>Saved batches</h3>
            <div className="tools">
              <input
                type="search"
                placeholder="Search by product name or batch number..."
                value={shelfBatchSearch}
                onChange={e => setShelfBatchSearch(e.target.value)}
                aria-label="Search batches"
              />
              <button className="btn ghost small" type="button" onClick={loadShelfBatches} disabled={shelfBatchesLoading}>
                {shelfBatchesLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <p className="hint">Showing batches {shelfForm.productId ? 'for selected product (plus search filter)' : 'matching search (all products)'}.</p>
            <div className="wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch #</th>
                    <th>MFD</th>
                    <th>EXP</th>
                    <th>Total (days)</th>
                    <th>Remaining (days)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shelfBatchesFiltered.length === 0 && (
                    <tr><td colSpan={7} className="empty">No batches found. (Table may not exist yet until migration is applied.)</td></tr>
                  )}
                  {shelfBatchesFiltered.map(b => {
                    const st = shelfBatchStatus(b.expiry_date);
                    const pname = b.products?.name || (products.find(p => String(p.id) === String(b.product_id)) || {}).name || '(unknown)';
                    return (
                      <tr key={b.id}>
                        <td style={{ textAlign: 'left' }}>{pname}</td>
                        <td>{b.batch_number}</td>
                        <td>{fmtDate(b.manufacturing_date)}</td>
                        <td>{fmtDate(b.expiry_date)}</td>
                        <td>{b.total_shelf_life_days}</td>
                        <td>{st.rem}</td>
                        <td className={st.label === 'Expired' ? 'neg' : st.label === 'Expiring Soon' ? '' : 'pos'}>{st.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {section === 'partners' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec"><span>Delivery Partners</span></h2>

          <form
            className="f"
            onSubmit={savePartner}
            style={{ marginBottom: 16 }}
          >
            <h3 style={{ margin: '0 0 8px' }}>
              {partnerForm.id ? 'Edit partner' : 'Create new partner'}
            </h3>

            <div className="grid">
              <label>
                Name
                <input
                  value={partnerForm.name}
                  onChange={e => setPartnerForm({
                    ...partnerForm,
                    name: e.target.value
                  })}
                  required
                />
              </label>

              <label>
                Phone
                <input
                  value={partnerForm.phone}
                  onChange={e => setPartnerForm({
                    ...partnerForm,
                    phone: e.target.value
                  })}
                />
              </label>

              {partnerForm.id && (
                <label className="full">
                  <span style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center'
                  }}>
                    <input
                      type="checkbox"
                      checked={partnerForm.active}
                      onChange={e => setPartnerForm({
                        ...partnerForm,
                        active: e.target.checked
                      })}
                    />
                    Active
                  </span>
                </label>
              )}
            </div>

            <div className="row">
              <button className="btn" type="submit">
                {partnerForm.id ? 'Save changes' : 'Create partner'}
              </button>

              {partnerForm.id && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setPartnerForm({
                    id: null,
                    name: '',
                    phone: '',
                    active: true
                  })}
                >
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
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {partners.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.phone || '–'}</td>

                    <td>
                      <span className={`tag ${p.active ? 'ok' : ''}`}>
                        {p.active ? 'Active' : 'Archived'}
                      </span>
                    </td>

                    <td>
                      <div className="act">
                        <button
                          className="btn ghost small"
                          onClick={() => setPartnerForm({
                            id: p.id,
                            name: p.name || '',
                            phone: p.phone || '',
                            active: !!p.active
                          })}
                        >
                          Edit
                        </button>

                        <button
                          className="btn ghost small"
                          onClick={() => {
                            setSelectedPartner(p.id);
                            navigate('/admin/history');
                          }}
                        >
                          View records
                        </button>

                        {p.active && (
                          <button
                            className="btn ghost small danger"
                            onClick={() => softDeletePartner(p)}
                          >
                            Archive/Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {partners.length === 0 && (
              <div className="pad">No partners found.</div>
            )}
          </div>

          <p className="hint">
            Deleting a partner archives them (soft delete) so historical
            delivery and salary records are preserved.
          </p>
        </section>
      )}

      {/* SALARY AND RATES */}

      {section === 'manufacturers' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec"><span>Manufacturers</span></h2>
          <p className="hint">Manage manufacturer profiles (name, address, customer care, website). Use these when associating brands to manufacturers (per your DB schema/migrations).</p>
          <form className="f" onSubmit={saveManufacturer} style={{ maxWidth: 720 }}>
            <div className="grid">
              <label className="full">Name *<input value={manufacturerForm.name} onChange={e => setManufacturerForm({ ...manufacturerForm, name: e.target.value })} required /></label>
              <label className="full">Registered / business address<textarea value={manufacturerForm.registered_address} onChange={e => setManufacturerForm({ ...manufacturerForm, registered_address: e.target.value })} rows={2} style={{ width: '100%' }} /></label>
              <label className="full">Customer care (phone/email)<input value={manufacturerForm.customer_care} onChange={e => setManufacturerForm({ ...manufacturerForm, customer_care: e.target.value })} /></label>
              <label className="full">Website<input value={manufacturerForm.website} onChange={e => setManufacturerForm({ ...manufacturerForm, website: e.target.value })} placeholder="https://..." /></label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="submit" disabled={manufacturerSaving}>{manufacturerSaving ? 'Saving...' : (manufacturerForm.id ? 'Update' : 'Add')} manufacturer</button>
              {manufacturerForm.id && <button className="btn ghost" type="button" onClick={() => setManufacturerForm({ id: null, name: '', registered_address: '', customer_care: '', website: '' })}>Cancel</button>}
            </div>
          </form>
          <div className="wrap" style={{ marginTop: 16 }}>
            <table>
              <thead><tr><th style={{ textAlign: 'left' }}>Name</th><th>Website</th><th>Updated</th><th></th></tr></thead>
              <tbody>
                {manufacturers.length === 0 && <tr><td colSpan={4} className="empty">No manufacturers found (or <code>manufacturers</code> table not created yet).</td></tr>}
                {manufacturers.map(m => (
                  <tr key={m.id}>
                    <td style={{ textAlign: 'left' }}>{m.name}</td>
                    <td>{m.website || '—'}</td>
                    <td>{m.updated_at ? fmtDate(String(m.updated_at).slice(0,10)) : '—'}</td>
                    <td><button className="btn small ghost" type="button" onClick={() => setManufacturerForm({ id: m.id, name: m.name || '', registered_address: m.registered_address || '', customer_care: m.customer_care || '', website: m.website || '' })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === 'salary' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec">
            <span>Delivery Rates (Salary per delivery)</span>
          </h2>

          <p className="hint">
            New rates apply only to deliveries recorded after saving.
            Past deliveries keep saved rates.
          </p>

          <form className="f" onSubmit={saveRates}>
            <div className="grid">
              <label>
                Grocery: customer pays (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.grocery_customer_charge}
                  onChange={e => setRatesForm({
                    ...ratesForm,
                    grocery_customer_charge: e.target.value
                  })}
                  required
                />
              </label>

              <label>
                Grocery: partner earns (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.grocery_partner_earning}
                  onChange={e => setRatesForm({
                    ...ratesForm,
                    grocery_partner_earning: e.target.value
                  })}
                  required
                />
              </label>

              <label>
                Restaurant: customer pays (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.restaurant_customer_charge}
                  onChange={e => setRatesForm({
                    ...ratesForm,
                    restaurant_customer_charge: e.target.value
                  })}
                  required
                />
              </label>

              <label>
                Restaurant: partner earns (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ratesForm.restaurant_partner_earning}
                  onChange={e => setRatesForm({
                    ...ratesForm,
                    restaurant_partner_earning: e.target.value
                  })}
                  required
                />
              </label>
            </div>

            <div className="row">
              <button className="btn" type="submit">Save rates</button>
            </div>
          </form>

          <h3 className="sec" style={{ marginTop: 24 }}>
            <span>Monthly salary progress tracker ({month})</span>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </h3>
          <p className="hint">Target ₹8,000/month. Earnings use saved <code>partner_earning</code> from completed deliveries (historical rates preserved). Estimates use ₹25/grocery and ₹40/food (alternatives).</p>
          <div className="pcards">
            {partners.map(p => {
              const pr = done.filter(r => r.partner_id === p.id);
              const groceryCount = pr.filter(r => r.delivery_type === 'grocery').length;
              const foodCount = pr.filter(r => r.delivery_type === 'restaurant').length;
              const earn = sum(pr, r => r.partner_earning);
              const target = 8000;
              const remaining = Math.max(target - earn, 0);
              const pct = target > 0 ? Math.min(100, (earn / target) * 100) : 0;
              const addGrocery = remaining > 0 ? Math.ceil(remaining / 25) : 0;
              const addFood = remaining > 0 ? Math.ceil(remaining / 40) : 0;
              return (
                <div className="pcard" key={p.id}>
                  <div className="ph">
                    <b>{p.name}</b>
                    <span className={`tag ${p.active ? 'ok' : ''}`}>{p.active ? 'Active' : 'Archived'}</span>
                  </div>
                  <div className="st">
                    <span>Target (monthly)</span><b>{inr(target)}</b>
                    <span>Completed (Grocery / Food)</span><b>{groceryCount} / {foodCount} ({pr.length} total)</b>
                    <span>Earnings (completed)</span><b>{inr(earn)}</b>
                    <span>Remaining to target</span><b>{inr(remaining)}</b>
                    <span>Progress</span><b>{pct.toFixed(1)}%</b>
                  </div>
                  <div className="pb" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
                  <div className="st" style={{ marginTop: 10 }}>
                    <span>Est. more grocery (@₹25)</span><b>{remaining > 0 ? `${addGrocery} deliveries` : 'Target reached'}</b>
                    <span>Est. more food (@₹40)</span><b>{remaining > 0 ? `${addFood} deliveries` : 'Target reached'}</b>
                  </div>
                  {!p.active && pr.length === 0 && <p className="hint">Archived with no deliveries this month.</p>}
                </div>
              );
            })}
          </div>

          <h3 className="sec" style={{ marginTop: 24 }}>
            <span>Monthly salary summary ({month})</span>
          </h3>

          <div className="pcards">
            {partners.map(p => {
              const pr = done.filter(r => r.partner_id === p.id);
              const pg = pr.filter(r => r.delivery_type === 'grocery').length;
              const e = sum(pr, r => r.partner_earning);
              const pd = sum(
                monthPayments.filter(x => x.partner_id === p.id),
                x => x.amount
              );
              const b = e - pd;

              const bar = (t, cls) => {
                const pct = Math.min(e / t * 100, 100);

                return (
                  <div className="tg">
                    <div className="tgl">
                      <span>Target {inr(t)}</span>
                      <span>{pct.toFixed(0)}%</span>
                    </div>

                    <div className={`pb ${cls}`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              };

              return (
                <div className="pcard" key={p.id}>
                  <div className="ph">
                    <b>{p.name}</b>
                    <span className={`tag ${p.active ? 'ok' : ''}`}>
                      {p.active ? 'Active' : 'Archived'}
                    </span>
                  </div>

                  <div className="st">
                    <span>Completed</span>
                    <b>{pr.length} (G {pg} / R {pr.length - pg})</b>

                    <span>Earnings</span>
                    <b>{inr(e)}</b>

                    <span>Paid</span>
                    <b>{inr(pd)}</b>

                    <span className="big">Balance</span>
                    <b className={`big ${b < 0 ? 'neg' : 'pos'}`}>
                      {inr(Math.abs(b))}
                      {b < 0 ? ' (advance)' : ''}
                    </b>
                  </div>

                  {e === 0 &&
                  !+settings.grocery_partner_earning &&
                  !+settings.restaurant_partner_earning ? (
                    <p className="note">Partner earning rates are ₹0.</p>
                  ) : (
                    <>
                      {bar(TARGET_MIN, '')}
                      {bar(TARGET_MAX, 'gold')}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SUPPLIERS, PURCHASES AND RESTOCK */}

      {section === 'suppliers' && (
        <SuppliersSection suppliers={suppliers} products={products} onChanged={loadAll} />
      )}

      {section === 'purchases' && (
        <PurchasesSection
          products={products}
          suppliers={suppliers}
          onChanged={loadAll}
        />
      )}

      {section === 'restock' && (
        <RestockSection
          products={products}
          suppliers={suppliers}
          brands={brands}
          manufacturers={manufacturers}
          onChanged={loadAll}
        />
      )}

      {/* PAYMENTS */}

      {section === 'payments' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec">
            <span>Record payment / salary payout</span>
          </h2>

          <form
            className="f"
            onSubmit={savePayment}
            style={{ marginBottom: 16 }}
          >
            <div className="grid">
              <label className="full">
                Partner
                <select
                  value={payForm.partner_id}
                  onChange={e => setPayForm({
                    ...payForm,
                    partner_id: e.target.value
                  })}
                >
                  <option value="">Select partner</option>
                  {partners.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Payment date
                <input
                  type="date"
                  value={payForm.payment_date}
                  onChange={e => setPayForm({
                    ...payForm,
                    payment_date: e.target.value
                  })}
                  required
                />
              </label>

              <label>
                Amount (₹)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payForm.amount}
                  onChange={e => setPayForm({
                    ...payForm,
                    amount: e.target.value
                  })}
                  required
                />
              </label>

              <label className="full">
                Note
                <input
                  value={payForm.note}
                  onChange={e => setPayForm({
                    ...payForm,
                    note: e.target.value
                  })}
                />
              </label>
            </div>

            <div className="row">
              <button className="btn" type="submit">Record payment</button>
            </div>
          </form>

          <h3 className="sec">
            <span>Payments ({month})</span>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </h3>

          <div className="wrap dt">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Partner</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {monthPayments.map(p => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.payment_date)}</td>
                    <td>{pName(p.partner_id)}</td>
                    <td>{inr(p.amount)}</td>
                    <td>{p.note || ''}</td>

                    <td>
                      <div className="act">
                        <button
                          className="btn ghost small danger"
                          onClick={() => deletePayment(p.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {monthPayments.length === 0 && (
              <div className="pad">No payments recorded for this month.</div>
            )}
          </div>
        </section>
      )}

      {/* RECORDS AND HISTORY */}

      {section === 'history' && (
        <section className="admin-card admin-spaced-section">
          <h2 className="sec">
            <span>Individual partner records & history</span>
          </h2>

          <div className="tools history-tools">
            <label>
              Partner
              <select
                value={selectedPartner}
                onChange={e => setSelectedPartner(e.target.value)}
              >
                <option value="">Select partner</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>

          {history.loading && (
            <div className="notice">Loading history...</div>
          )}

          {selectedPartner && !history.loading && (
            <>
              <p className="hint">{history.note}</p>

              <h3>Delivery records</h3>

              <div className="wrap dt">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Customer charge</th>
                      <th>Partner earns</th>
                      <th>Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(history.rows || []).map(r => (
                      <tr
                        key={r.id}
                        className={r.status === 'cancelled' ? 'cx' : ''}
                      >
                        <td>{fmtDate(r.delivery_date)}</td>
                        <td>{TYPE[r.delivery_type]}</td>

                        <td>
                          <span className={`tag ${r.status === 'completed' ? 'ok' : 'bad'}`}>
                            {r.status}
                          </span>
                        </td>

                        <td>{inr(r.customer_charge)}</td>
                        <td>{inr(r.partner_earning)}</td>
                        <td>{r.note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {(history.rows || []).length === 0 && (
                  <div className="pad">No delivery records.</div>
                )}
              </div>

              <h3 className="history-subheading">Salary/payment history</h3>

              <div className="wrap dt">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(history.payments || []).map(p => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.payment_date)}</td>
                        <td>{inr(p.amount)}</td>
                        <td>{p.note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {(history.payments || []).length === 0 && (
                  <div className="pad">No payment history.</div>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
