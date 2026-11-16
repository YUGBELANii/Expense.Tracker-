// Pure restock-planning helpers. No Supabase calls here, so this file is
// fully unit-testable. All quantities/prices follow the app's existing
// convention (plain numbers in rupees).

export function normalizeWhatsAppPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return '91' + digits;            // Indian mobile
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits; // already international or unusual: use as entered
}

// 'out' = nothing left, 'low' = at/below the product's low-stock threshold.
export function stockState(product, defaultThreshold = 3) {
  const qty = Number(product?.quantity) || 0;
  if (qty <= 0) return 'out';
  const rawThr = product?.low_stock_threshold;
  const thr = (rawThr !== null && rawThr !== undefined && rawThr !== '') ? Number(rawThr) : Number(defaultThreshold);
  if (Number.isFinite(thr) && thr >= 0 && qty <= thr) return 'low';
  return 'ok';
}

// How much to ask the supplier for. Last purchase quantity wins; otherwise
// refill to twice the effective threshold; otherwise let the supplier suggest.
export function suggestedQuantity(product, lastBatch, defaultThreshold = 3) {
  const lastQty = Number(lastBatch?.quantity);
  if (lastQty > 0) return lastQty;
  const rawThr = product?.low_stock_threshold;
  const thr = (rawThr !== null && rawThr !== undefined && rawThr !== '') ? Number(rawThr) : Number(defaultThreshold);
  if (Number.isFinite(thr) && thr > 0) {
    const qty = Number(product?.quantity) || 0;
    return Math.max(Math.ceil(thr * 2 - qty), 1);
  }
  return null;
}

// Builds the flat list of items that need restocking, resolving
// brand -> manufacturer and the supplier to order from
// (preferred supplier on the product, else supplier of the last purchase).
export function buildRestockItems({ products = [], brands = [], manufacturers = [], lastBatchByProduct = {}, defaultThreshold = 3 }) {
  const brandById = Object.fromEntries(brands.map(b => [b.id, b]));
  const manufacturerById = Object.fromEntries(manufacturers.map(m => [m.id, m]));

  return products
    .map(product => ({ product, state: stockState(product, defaultThreshold) }))
    .filter(x => x.state !== 'ok')
    .map(({ product, state }) => {
      const brand = product.brand_id ? brandById[product.brand_id] : null;
      const manufacturer = brand && brand.manufacturer_id
        ? manufacturerById[brand.manufacturer_id]
        : null;
      const last = lastBatchByProduct[product.id] || null;
      const rawThr = product.low_stock_threshold;
      const effectiveThr = (rawThr !== null && rawThr !== undefined && rawThr !== '') ? Number(rawThr) : Number(defaultThreshold);

      return {
        productId: product.id,
        name: product.name || '',
        unit: product.unit || '',
        packSize: product.pack_size || '',
        category: product.category || '',
        quantity: Number(product.quantity) || 0,
        threshold: product.low_stock_threshold ?? null,
        effectiveThreshold: effectiveThr,
        state,
        brandName: brand ? brand.name : null,
        manufacturerName: manufacturer ? manufacturer.name : null,
        supplierId: product.preferred_supplier_id || (last ? last.supplier_id : null) || null,
        lastBuyPrice: last && last.buy_price != null ? Number(last.buy_price) : null,
        lastPurchaseDate: last ? last.purchase_date : null,
        lastBatchNumber: last ? last.batch_number : null,
        lastExpiryDate: last ? last.expiry_date : null,
        suggestedQty: suggestedQuantity(product, last, defaultThreshold)
      };
    })
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === 'out' ? -1 : 1; // out first
      return a.name.localeCompare(b.name);
    });
}

// Groups restock items per supplier; items without a known supplier go last.
export function groupBySupplier(items, suppliers = []) {
  const supplierById = Object.fromEntries(suppliers.map(s => [s.id, s]));
  const groups = new Map();

  items.forEach(item => {
    const supplier = item.supplierId ? supplierById[item.supplierId] : null;
    const key = supplier ? supplier.id : 'none';

    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: supplier ? supplier.id : null,
        supplierName: supplier ? supplier.name : 'No supplier assigned',
        phone: supplier ? supplier.phone : null,
        contactPerson: supplier ? supplier.contact_person : null,
        items: []
      });
    }
    groups.get(key).items.push(item);
  });

  return [...groups.values()].sort((a, b) => {
    if (!a.supplierId) return 1;
    if (!b.supplierId) return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });
}

// Plain-text order message, ready for WhatsApp or copy-paste.
export function buildRestockMessage(group, { storeName = 'Fattakse Quick, Tirora' } = {}) {
  const lines = [];
  const to = group.supplierId ? ` ${group.supplierName}` : '';
  lines.push(`Namaste${to}, restock order from ${storeName}:`);
  lines.push('');

  group.items.forEach((item, i) => {
    const brand = item.brandName ? ` (${item.brandName})` : '';
    const pack = item.packSize ? ` ${item.packSize}` : '';
    const need = item.suggestedQty
      ? `${item.suggestedQty}${item.unit ? ' ' + item.unit : ''}`
      : 'qty - please suggest';
    const left = item.state === 'out' ? 'OUT OF STOCK' : `only ${item.quantity} left`;
    lines.push(`${i + 1}. ${item.name}${brand}${pack} - need ${need} (${left})`);
  });

  lines.push('');
  lines.push('Please confirm availability, rate and delivery time. Dhanyavad.');
  return lines.join('\n');
}

export function buildWhatsAppLink(phone, text) {
  const normalized = normalizeWhatsAppPhone(phone);
  const encoded = encodeURIComponent(text);
  return normalized
    ? `https://wa.me/${normalized}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}
