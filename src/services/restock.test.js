import {
  normalizeWhatsAppPhone,
  stockState,
  suggestedQuantity,
  buildRestockItems,
  groupBySupplier,
  buildRestockMessage,
  buildWhatsAppLink
} from './restock';

describe('normalizeWhatsAppPhone', () => {
  test('adds 91 to a 10-digit Indian mobile', () => {
    expect(normalizeWhatsAppPhone('9876543210')).toBe('919876543210');
  });
  test('strips formatting characters', () => {
    expect(normalizeWhatsAppPhone('+91 98765-43210')).toBe('919876543210');
  });
  test('handles leading zero', () => {
    expect(normalizeWhatsAppPhone('09876543210')).toBe('919876543210');
  });
  test('keeps an existing 91 prefix', () => {
    expect(normalizeWhatsAppPhone('919876543210')).toBe('919876543210');
  });
  test('returns null for empty input', () => {
    expect(normalizeWhatsAppPhone('')).toBeNull();
    expect(normalizeWhatsAppPhone(null)).toBeNull();
    expect(normalizeWhatsAppPhone('abc')).toBeNull();
  });
});

describe('stockState', () => {
  test('out when quantity is zero or negative', () => {
    expect(stockState({ quantity: 0 })).toBe('out');
    expect(stockState({ quantity: -2 })).toBe('out');
  });
  test('low when at or below threshold', () => {
    expect(stockState({ quantity: 3, low_stock_threshold: 5 })).toBe('low');
    expect(stockState({ quantity: 5, low_stock_threshold: 5 })).toBe('low');
  });
  test('ok above threshold or without threshold', () => {
    expect(stockState({ quantity: 6, low_stock_threshold: 5 })).toBe('ok');
    expect(stockState({ quantity: 1 })).toBe('ok');
    expect(stockState({ quantity: 1, low_stock_threshold: null })).toBe('ok');
  });
});

describe('suggestedQuantity', () => {
  test('uses last purchase quantity first', () => {
    expect(suggestedQuantity({ quantity: 1, low_stock_threshold: 5 }, { quantity: 24 })).toBe(24);
  });
  test('refills to twice the threshold when no purchase history', () => {
    expect(suggestedQuantity({ quantity: 2, low_stock_threshold: 5 }, null)).toBe(8);
  });
  test('null when nothing to go on', () => {
    expect(suggestedQuantity({ quantity: 0 }, null)).toBeNull();
  });
});

const products = [
  { id: 'p1', name: 'Frooti 330ml', unit: 'piece', pack_size: '330 ml', quantity: 0, brand_id: 'b1', preferred_supplier_id: 's1' },
  { id: 'p2', name: 'Maggi Noodles', unit: 'piece', quantity: 2, low_stock_threshold: 5, brand_id: 'b2', preferred_supplier_id: null },
  { id: 'p3', name: 'Full Stock Soap', unit: 'piece', quantity: 50, low_stock_threshold: 5 }
];
const brands = [
  { id: 'b1', name: 'Frooti', manufacturer_id: 'm1' },
  { id: 'b2', name: 'Maggi', manufacturer_id: 'm2' }
];
const manufacturers = [
  { id: 'm1', name: 'Parle Agro' },
  { id: 'm2', name: 'Nestle India' }
];
const suppliers = [
  { id: 's1', name: 'Tirora Agencies', phone: '9876543210', contact_person: 'Ramesh' },
  { id: 's2', name: 'Gondia Distributors', phone: null }
];
const lastBatchByProduct = {
  p2: { supplier_id: 's2', quantity: 48, buy_price: 11.5, purchase_date: '2026-11-01' }
};

describe('buildRestockItems', () => {
  const items = buildRestockItems({ products, brands, manufacturers, lastBatchByProduct });

  test('includes only out/low items, out-of-stock first', () => {
    expect(items.map(i => i.productId)).toEqual(['p1', 'p2']);
    expect(items[0].state).toBe('out');
    expect(items[1].state).toBe('low');
  });
  test('resolves brand and manufacturer chain', () => {
    expect(items[0].brandName).toBe('Frooti');
    expect(items[0].manufacturerName).toBe('Parle Agro');
    expect(items[1].manufacturerName).toBe('Nestle India');
  });
  test('preferred supplier wins, else last purchase supplier', () => {
    expect(items[0].supplierId).toBe('s1');
    expect(items[1].supplierId).toBe('s2');
  });
  test('carries last purchase info and suggested quantity', () => {
    expect(items[1].lastBuyPrice).toBe(11.5);
    expect(items[1].suggestedQty).toBe(48);
  });
});

describe('groupBySupplier', () => {
  test('groups items per supplier and puts unassigned last', () => {
    const items = buildRestockItems({
      products: [...products, { id: 'p4', name: 'Loose Rice', quantity: 0 }],
      brands,
      manufacturers,
      lastBatchByProduct
    });
    const groups = groupBySupplier(items, suppliers);

    expect(groups.map(g => g.supplierName)).toEqual([
      'Gondia Distributors', 'Tirora Agencies', 'No supplier assigned'
    ]);
    expect(groups[1].phone).toBe('9876543210');
    expect(groups[2].supplierId).toBeNull();
    expect(groups[2].items.map(i => i.productId)).toEqual(['p4']);
  });
});

describe('buildRestockMessage', () => {
  const items = buildRestockItems({ products, brands, manufacturers, lastBatchByProduct });
  const groups = groupBySupplier(items, suppliers);
  const tirora = groups.find(g => g.supplierId === 's1');

  test('message names supplier, store, items and urgency', () => {
    const text = buildRestockMessage(tirora);
    expect(text).toContain('Namaste Tirora Agencies');
    expect(text).toContain('Fattakse Quick, Tirora');
    expect(text).toContain('1. Frooti 330ml (Frooti) 330 ml');
    expect(text).toContain('OUT OF STOCK');
    expect(text).toContain('Dhanyavad');
  });
  test('asks supplier to suggest quantity when unknown', () => {
    const text = buildRestockMessage(tirora);
    expect(text).toContain('qty - please suggest');
  });
});

describe('buildWhatsAppLink', () => {
  test('builds a wa.me link with +91 number and encoded text', () => {
    const link = buildWhatsAppLink('9876543210', 'Namaste, order');
    expect(link).toBe('https://wa.me/919876543210?text=Namaste%2C%20order');
  });
  test('falls back to number-less share link', () => {
    expect(buildWhatsAppLink(null, 'hi')).toBe('https://wa.me/?text=hi');
  });
});
