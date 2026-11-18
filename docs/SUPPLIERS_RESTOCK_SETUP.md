# Suppliers, Purchases & Restock — Setup and Usage

New admin sections (V2.3): **Suppliers**, **Purchases** and **Restock**. Together they answer:
*"What did we buy, from which supplier and manufacturer, what is running out, and who do we
message right now to restock it?"*

## 1. One-time database setup

Run `supabase/migrations/2026-11-16_suppliers_batches_restock.sql` in the Supabase SQL editor
(Dashboard → SQL). It is **additive only** — it creates:

- `suppliers` — supplier master (name, WhatsApp phone, contact person, address, note, active)
- `purchase_batches` — every purchase: product, supplier, quantity, per-unit buy price,
  purchase date, invoice no., batch number, manufacturing/expiry dates
- `product_shelf_batches` — the table the existing **Shelf Life** section always expected
  but which did not exist in the database (its Save button failed before this)
- two new nullable columns on `products`: `low_stock_threshold` and `preferred_supplier_id`
- RLS: authenticated users read, only admins (per `is_admin()`) write — the same pattern as
  `docs/SUPABASE_ADMIN_SETUP.md`

Until the SQL is run, the new tabs show a clear "run the migration" error and the rest of the
app keeps working.

## 2. Daily flow

1. **Suppliers tab** — create each supplier once. Save the WhatsApp number
   (10-digit Indian numbers get +91 automatically). Delete = archive, history is preserved.
2. **Purchases tab** — when stock arrives, record the batch. Checkboxes:
   - *Add this quantity to product stock* (on by default) — keeps the Stock Ledger correct.
   - *Also update the product's buy price* (off by default).
   - *Remember this supplier as the product's restock supplier* (on by default) — powers the
     Restock board grouping.
3. **Restock tab** — shows every product that is **out of stock** or at/below its
   **low-stock level**, grouped by supplier, with brand and manufacturer shown.
   - **WhatsApp order**: opens wa.me with a ready order message (suggested quantity = last
     purchase quantity, else refill to twice the threshold).
   - **Copy list**: copies the same message for any other channel.
   - *Set levels*: set each product's low-stock level so items appear **before** they run out.
     Empty level = alert only when fully out.
   - Items whose supplier is unknown appear under "No supplier assigned" with an inline
     assign control.

## 3. Where supplier/manufacturer data comes from

- **Manufacturer** is resolved through the existing chain
  `products.brand_id → brands.manufacturer_id → manufacturers` (manage in the
  Manufacturer Assigner / Manufacturers tabs).
- **Supplier** for restock = the saved `products.preferred_supplier_id` when present; otherwise
  the lowest latest recorded purchase rate for that same product, falling back to the supplier of
  the most recent purchase batch when no priced supplier history exists. The Restock board lets you
  compare each active supplier's latest recorded rate for the same product, switch the order
  destination, and save that choice as the preferred supplier. These are historical rates, not live quotes.
- The old free-text `products.supplier` / `invoice` / `purchase_date` columns are untouched;
  purchase batches are the structured replacement going forward.

## 4. Notes and limits

- Stock increment is a read-then-update (not atomic). Fine for a single admin; if several
  admins record purchases at the same second, use a Postgres function later.
- Quantities/prices are plain numeric rupees, consistent with the rest of this app. This tool
  is a management ledger — it must not drive automated money movement.
- Verification checklist after running the SQL:
  - [ ] Suppliers tab: create, edit, archive a supplier
  - [ ] Purchases tab: save a purchase; product stock increases; it appears in Recent purchases
  - [ ] Restock tab: set a low-stock level above current stock; item appears; WhatsApp link
        opens with the correct +91 number and message; Copy list works
  - [ ] Shelf Life tab: saving a batch now succeeds (table exists)
  - [ ] A non-admin authenticated user cannot write to the new tables (RLS)
