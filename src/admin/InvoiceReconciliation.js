import React, { useMemo, useState } from 'react';

const money = value => '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\\s+/g, ' ');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = String(text || '').replace(/^\\uFEFF/, '');
  const firstLine = source.split(/\\r?\\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\\t') ? '\\t' : firstLine.includes('|') ? '|' : ',';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\\n' || ch === '\\r') && !quoted) {
      if (ch === '\\r' && source[i + 1] === '\\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('Add a header row and at least one invoice item.');

  const headers = rows.shift().map(norm);
  const find = names => headers.findIndex(header => names.includes(header));
  const productIndex = find(['product', 'product name', 'item', 'item name', 'description', 'particulars', 'name', 'stock item']);
  const qtyIndex = find(['qty', 'quantity', 'units', 'pcs']);
  const unitIndex = find(['unit', 'item unit', 'uom', 'unit of measure']);
  const rateIndex = find(['rate', 'unit price', 'price per unit', 'buy price', 'unit rate', 'purchase rate']);
  const totalIndex = find(['amount', 'total', 'line total', 'net amount', 'value', 'taxable value']);
  const barcodeIndex = find(['barcode', 'sku', 'item code', 'product code']);
  if (productIndex < 0 && barcodeIndex < 0) throw new Error('CSV needs an Item/Product column. Barcode can be included as an optional fallback.');
  if (rateIndex < 0 && totalIndex < 0) throw new Error('CSV needs a Unit Price/Rate or line Total/Amount column.');

  return rows.map((values, index) => {
    const rawQuantity = qtyIndex >= 0 ? String(values[qtyIndex] || '').replace(/[,₹ ]/g, '').trim() : '';
    const quantity = rawQuantity === '' ? null : Number(rawQuantity);
    const rateText = rateIndex >= 0 ? String(values[rateIndex] || '').replace(/[₹, ]/g, '') : '';
    const totalText = totalIndex >= 0 ? String(values[totalIndex] || '').replace(/[₹, ]/g, '') : '';
    const unitRate = rateText.trim() !== '' ? Number(rateText) : NaN;
    const lineTotal = totalText.trim() !== '' ? Number(totalText) : NaN;
    const rate = Number.isFinite(unitRate) && unitRate >= 0 ? unitRate :
      Number.isFinite(lineTotal) && Number.isFinite(quantity) && quantity > 0 ? lineTotal / quantity : NaN;
    return {
      rowId: index + 1,
      invoiceName: productIndex >= 0 ? (values[productIndex] || '').trim() : '',
      unit: unitIndex >= 0 ? (values[unitIndex] || '').trim() : '',
      barcode: barcodeIndex >= 0 ? (values[barcodeIndex] || '').trim() : '',
      quantity,
      quantityProvided: rawQuantity !== '',
      invoiceRate: rate,
      lineTotal: Number.isFinite(lineTotal) ? lineTotal : (Number.isFinite(rate) && Number.isFinite(quantity) && quantity > 0 ? rate * quantity : NaN),
      productId: ''
    };
  }).filter(item => item.invoiceName || item.barcode);
}

function findBarcodeProduct(products, barcode) {
  const key = String(barcode || '').trim();
  if (!key) return null;
  return products.find(product =>
    [product.barcode, product.raw_barcode].some(value => String(value || '').trim() === key)
  ) || null;
}

function toCsv(rows, products) {
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const header = ['Invoice item', 'Barcode', 'Unit', 'Matched product', 'Quantity', 'Invoice rate', 'Database buy price', 'Database sell price', 'Rate difference', 'Invoice line total', 'Potential gross margin if all invoice quantity sells at current price'];
  const lines = rows.map(row => {
    const product = products.find(item => item.id === row.productId);
    const db = product?.buy_price == null || product.buy_price === '' ? NaN : Number(product.buy_price);
    const sell = product?.sell_price == null || product.sell_price === '' ? NaN : Number(product.sell_price);
    return [
      row.invoiceName, row.barcode, row.unit, product?.name || 'Unmatched',
      row.quantity ?? '', Number.isFinite(row.invoiceRate) ? row.invoiceRate : '',
      Number.isFinite(db) ? db : '', Number.isFinite(sell) ? sell : '',
      Number.isFinite(db) && Number.isFinite(row.invoiceRate) ? row.invoiceRate - db : '',
      Number.isFinite(row.lineTotal) ? row.lineTotal : '',
      Number.isFinite(sell) && Number.isFinite(row.invoiceRate) && Number.isFinite(row.quantity) ? (sell - row.invoiceRate) * row.quantity : ''
    ].map(quote).join(',');
  });
  return [header.map(quote).join(','), ...lines].join('\\n');
}

export default function InvoiceReconciliation({ products = [] }) {
  const [rows, setRows] = useState([]);
  const [manualText, setManualText] = useState('');
  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [error, setError] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false);

  const productIndex = useMemo(() => {
    const map = new Map();
    products.forEach(product => {
      const key = norm(product.name);
      if (key && !map.has(key)) map.set(key, product.id);
    });
    return map;
  }, [products]);

  function loadText(text, label) {
    setError('');
    try {
      const parsed = parseCsv(text).map(item => {
        const barcodeMatch = findBarcodeProduct(products, item.barcode);
        return {
          ...item,
          productId: barcodeMatch?.id || productIndex.get(norm(item.invoiceName)) || ''
        };
      });
      if (!parsed.length) throw new Error('No invoice line items found.');
      setRows(parsed);
      setSourceName(label || 'Manual invoice text');
      setInvoiceLabel(label || 'Manual invoice');
      setManualText(text);
    } catch (e) { setError(e.message || 'Could not read invoice data.'); }
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file. Excel files must be saved as CSV first.');
      event.target.value = '';
      return;
    }
    setBusy(true);
    try { loadText(await file.text(), file.name); }
    catch (e) { setError('Could not read file: ' + (e.message || e)); }
    finally { setBusy(false); event.target.value = ''; }
  }

  const enriched = useMemo(() => rows.map(row => {
    const product = products.find(item => item.id === row.productId);
    const dbRate = product && product.buy_price != null && product.buy_price !== '' ? Number(product.buy_price) : NaN;
    const sellRate = product && product.sell_price != null && product.sell_price !== '' ? Number(product.sell_price) : NaN;
    const quantityValid = row.quantity == null || (Number.isFinite(row.quantity) && row.quantity > 0);
    const valid = quantityValid && Number.isFinite(row.invoiceRate) && row.invoiceRate >= 0;
    const hasQuantity = Number.isFinite(row.quantity) && row.quantity > 0;
    return {
      ...row, product, dbRate, sellRate, valid, hasQuantity,
      variance: Number.isFinite(dbRate) ? row.invoiceRate - dbRate : NaN,
      varianceTotal: Number.isFinite(dbRate) && hasQuantity ? (row.invoiceRate - dbRate) * row.quantity : NaN,
      estimatedMargin: Number.isFinite(sellRate) && hasQuantity ? (sellRate - row.invoiceRate) * row.quantity : NaN
    };
  }), [rows, products]);

  const summary = useMemo(() => {
    const valid = enriched.filter(row => row.valid);
    const matched = valid.filter(row => row.product);
    return {
      lines: valid.length,
      matched: matched.length,
      unmatched: valid.length - matched.length,
      invoiceTotal: valid.reduce((sum, row) => sum + (Number.isFinite(row.lineTotal) ? row.lineTotal : 0), 0),
      variance: valid.reduce((sum, row) => sum + (Number.isFinite(row.varianceTotal) ? row.varianceTotal : 0), 0),
      margin: valid.reduce((sum, row) => sum + (Number.isFinite(row.estimatedMargin) ? row.estimatedMargin : 0), 0),
      quantityMissing: valid.filter(row => !row.hasQuantity).length
    };
  }, [enriched]);

  function updateMatch(rowId, productId) {
    setRows(current => current.map(row => row.rowId === rowId ? { ...row, productId } : row));
  }

  function updateBarcode(rowId, barcode) {
    const match = findBarcodeProduct(products, barcode);
    setRows(current => current.map(row => row.rowId === rowId
      ? { ...row, barcode, productId: match?.id || '' }
      : row));
  }

  function exportReport() {
    const blob = new Blob([toCsv(enriched, products)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'invoice-database-reconciliation.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="admin-card admin-spaced-section">
      <h3 className="sec"><span>Invoice vs database audit</span></h3>
      <p className="hint">
        Import an actual supplier invoice and compare its item rates with current product prices. Item unit, quantity and barcode are optional. Products are matched by name first; use a barcode only when the name cannot identify the product.
      </p>
      <div className="grid">
        <label className="full">
          Invoice / bill reference
          <input value={invoiceLabel} onChange={e => setInvoiceLabel(e.target.value)} placeholder="e.g. Invoice 1042 · Supplier · Date" />
        </label>
        <label className="full">
          Upload invoice CSV
          <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
          <small>Required: Item/Product and Unit Price/Rate, or Amount/Total. Optional: Unit, Quantity and Barcode.</small>
        </label>
        <label className="full">
          Or paste invoice rows (CSV / tab / pipe-separated text with a header)
          <textarea rows={5} value={manualText} onChange={e => setManualText(e.target.value)} placeholder={'Item | Unit | Quantity | Unit Price | Barcode\\nDairy Milk | pcs | 10 | 20 |\\nFace Wash | | | 95 |'} />
        </label>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <button className="btn" type="button" onClick={() => loadText(manualText, invoiceLabel || 'Manual invoice')} disabled={!manualText.trim() || busy}>Compare pasted invoice</button>
        {rows.length > 0 && <button className="btn secondary" type="button" onClick={exportReport}>Export audit CSV</button>}
      </div>
      {error && <div className="notice bad">{error}</div>}
      {rows.length > 0 && (
        <>
          <div className="grid" style={{ marginTop: 14 }}>
            <div className="admin-card"><small>Invoice line value</small><h3>{money(summary.invoiceTotal)}</h3></div>
            <div className="admin-card"><small>Matched / total lines</small><h3>{summary.matched} / {summary.lines}</h3></div>
            <div className="admin-card"><small>Invoice cost vs DB buy price</small><h3>{money(summary.variance)}</h3><small>Quantity-weighted where quantity is provided</small></div>
            <div className="admin-card"><small>Potential gross margin*</small><h3>{money(summary.margin)}</h3><small>Only calculated for rows with quantity</small></div>
          </div>
          {summary.unmatched > 0 && <div className="notice bad">{summary.unmatched} line(s) are unmatched. Enter a barcode or select the product manually.</div>}
          {summary.quantityMissing > 0 && <div className="notice">{summary.quantityMissing} line(s) have no quantity. Per-unit comparison is available, but quantity-weighted totals and potential margin exclude those lines.</div>}
          <div className="wrap dt">
            <table>
              <thead><tr><th>Invoice item</th><th>Barcode fallback</th><th>Database product match</th><th>Unit</th><th>Qty</th><th>Invoice rate</th><th>DB buy rate</th><th>DB sell rate</th><th>Difference / unit</th><th>Total cost variance</th><th>Potential margin</th></tr></thead>
              <tbody>
                {enriched.map(row => (
                  <tr key={row.rowId}>
                    <td>{row.invoiceName || '—'}</td>
                    <td>
                      {!row.product ? (
                        <input value={row.barcode} onChange={e => updateBarcode(row.rowId, e.target.value)} placeholder="Enter barcode" aria-label={'Barcode for ' + (row.invoiceName || 'invoice row')} />
                      ) : (row.barcode || 'Not needed')}
                    </td>
                    <td>
                      <select value={row.productId} onChange={e => updateMatch(row.rowId, e.target.value)}>
                        <option value="">Unmatched — choose product</option>
                        {products.map(product => <option key={product.id} value={product.id}>{product.name}{product.pack_size ? ' · ' + product.pack_size : ''}</option>)}
                      </select>
                    </td>
                    <td>{row.unit || '—'}</td>
                    <td>{row.quantity ?? '—'}</td>
                    <td>{Number.isFinite(row.invoiceRate) ? money(row.invoiceRate) : 'Needs quantity or unit rate'}</td>
                    <td>{Number.isFinite(row.dbRate) ? money(row.dbRate) : '—'}</td>
                    <td>{Number.isFinite(row.sellRate) ? money(row.sellRate) : '—'}</td>
                    <td>{Number.isFinite(row.variance) ? (row.variance > 0 ? '+' : '') + money(row.variance) : '—'}</td>
                    <td>{Number.isFinite(row.varianceTotal) ? money(row.varianceTotal) : '—'}</td>
                    <td>{Number.isFinite(row.estimatedMargin) ? money(row.estimatedMargin) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {sourceName ? 'Source: ' + sourceName + '. ' : ''}This audit does not alter purchases, stock, product prices, or profit records. Potential gross margin is an estimate, not realized profit. Quantity-weighted totals require a valid quantity. Invoice and database rates must use the same unit/package basis.
          </p>
        </>
      )}
    </section>
  );
}
