# Code Audit Report (Inspection Only)

**Date:** Mon Nov 16 2026  
**Repository:** expense-tracker (branch `main`, working tree clean at time of inspection)  
**Scope:** Recently pulled changes (commit `7ce5f86` “Add supplier, purchase batch and restock management (V2.3)”, merge `ad9ac29`) plus related existing code reviewed in context.  
**Tests run (read-only):** `npx react-scripts test --watchAll=false` — **2 suites passed, 21 tests passed** (warnings only: CRA/punycode deprecation, React Router v6 future flags).

> **Important:** This is an inspection/audit only. No application source code, migrations, or Supabase data were modified. Do not treat passing tests as proof of production safety for all flows (e.g. Supabase-dependent UI paths require manual verification with real data/RLS).

---

## 1. Executive Summary

- The V2.3 change set adds **Suppliers**, **Purchases (purchase_batches)**, **Restock board**, supporting SQL migration (`supabase/migrations/2026-11-16_suppliers_batches_restock.sql`), pure logic + tests (`src/services/restock.js`, `restock.test.js`), docs, and wires them into `AdminApp`.
- **What looks good:** Additive migration approach, `is_admin()` RLS pattern consistent with documented guidance, soft-archive pattern for suppliers, restock logic is unit-tested and mostly clear, `App.test.js` aligned to current UI, overall structure matches existing admin patterns.
- **Main risks to address:** (a) **Non-atomic stock updates** in Purchases (read-then-update) can race under concurrent admins; (b) **foreign key delete/restrict behavior** may block deleting products/suppliers in unexpected ways unless managed carefully (mitigated by soft archive for suppliers but not for product lifecycle); (c) **Restock loads up to 3000 recent purchase rows into memory** to derive “last batch per product” (scales poorly over time); (d) **Supabase error handling/UI feedback** is inconsistent in a few places (some failures swallowed silently beyond toasts/logs); (e) a few **data/validation edge cases** (e.g. `buy_price` empty string handling paths, phone normalization assumptions) should be hardened.
- **No secrets/API keys** were observed in the inspected diffs/files.

---

## 2. Git Changes Overview (from `git show --name-only 7ce5f86`)

**Commit:** `7ce5f86` (included in `ad9ac29` merge) — “Add supplier, purchase batch and restock management (V2.3)”

Changed/added files (per commit listing):
- `docs/SUPABASE_ADMIN_SETUP.md` (modified)
- `docs/SUPPLIERS_RESTOCK_SETUP.md` (added)
- `src/AdminApp.js` (modified)
- `src/App.css` (modified)
- `src/App.test.js` (modified)
- `src/admin/PurchasesSection.js` (added)
- `src/admin/RestockSection.js` (added)
- `src/admin/SuppliersSection.js` (added)
- `src/services/restock.js` (added)
- `src/services/restock.test.js` (added)
- `supabase/migrations/2026-11-16_suppliers_batches_restock.sql` (added)

**Working tree:** clean on `main` at inspection time.

---

## 3. Critical Issues

**None identified** from static inspection of the changed files and related code paths reviewed.

(If any exist in production data/RLS configuration not present in the repo, they would not be visible here; manual Supabase/RLS verification is recommended per docs.)

---

## 4. High-Priority Issues

### H1 — Non-atomic product stock increment in Purchases (“race condition” / lost updates)
- **Files:** `src/admin/PurchasesSection.js` (around save flow: reads `products.quantity` via `sb.from('products').select('id, quantity').eq('id', form.product_id).single()` then updates with `quantity: (Number(fresh.quantity)||0) + qty`), `docs/SUPPLIERS_RESTOCK_SETUP.md` (notes “read-then-update… Fine for a single admin…”)
- **Problem:** Stock is increased by reading the current row then writing `old+qty`. Two admins (or two tabs/actions in quick succession) can both read the same `quantity`, both compute new values, and the last write wins → **lost increments** (incorrect stock). Also the “fresh read” mitigates stale UI but does not prevent concurrent DB writes.
- **Why it matters:** Purchase recording is the primary path that should keep `Stock Ledger` accurate (`products.quantity`). Lost updates produce wrong inventory and wrong restock signals.
- **Impact:** Incorrect stock counts, misleading Restock board, financial/operational confusion; severity increases if more than one admin uses the app.
- **Recommended repair:** Use an atomic DB operation, e.g. Postgres RPC/function that does `update products set quantity = quantity + $qty ...` with proper auth checks, or use Supabase SQL with `rpc` and constraints. Alternatively enforce single-operator discipline temporarily but document risk. **Do not** “fix” by adding client-side locks alone.
- **Status:** **Confirmed (design/implementation risk)** in code; acknowledged in docs. Needs DB/RPC or transactional approach.

### H2 — Foreign key / deletion behavior can cause confusing errors (products/purchase history)
- **Files:** `supabase/migrations/2026-11-16_suppliers_batches_restock.sql` (`purchase_batches.product_id` is `references public.products(id)` with no `ON DELETE` specified → default **RESTRICT/NO ACTION**), `product_shelf_batches.product_id` similarly; `purchase_batches.supplier_id` nullable FK default RESTRICT behavior on delete of supplier row if referenced in some setups? (Postgres default is NO ACTION; also if referenced, deleting supplier fails unless handled)
- **Problem:** Deleting a product that has any `purchase_batches` (or related shelf batches) will fail with a DB error. The app currently offers product delete in Admin (per `AdminApp` `deleteProduct`) but does not surface guided behavior for this case; users may hit opaque failures. Suppliers use soft archive (good) but direct DB deletes could be problematic.
- **Why it matters:** Data integrity vs usability: prevents accidental loss but can block admin workflows without clear messaging.
- **Impact:** Admin actions fail unexpectedly; potential support burden.
- **Recommended repair:** Decide policy explicitly: e.g. `ON DELETE RESTRICT` with clear UI error copy (“Cannot delete product: purchase history exists. Archive/adjust workflow instead.”) or `ON DELETE SET NULL` only if business allows orphaning history (usually not desired). For `supplier_id` in `purchase_batches`, consider `ON DELETE SET NULL` if you want hard deletes later, or keep RESTRICT + soft archive (current UI does archive) — document and enforce. **Requires migration design approval (do not auto-apply).**
- **Status:** **Confirmed** from migration schema (defaults). Behavior depends on Postgres defaults and RLS; needs verification against live DB.

---

## 5. Medium-Priority Issues

### M1 — `RestockSection` loads up to 3000 purchase batch rows client-side to find “latest per product”
- **Files:** `src/admin/RestockSection.js` (`loadLastBatches` fetches `.limit(3000)`, orders by `purchase_date`/`created_at` desc, then keeps first per `product_id`)
- **Problem:** As history grows, this becomes expensive (network, memory, CPU) and can omit older “latest” logic if relevant rows fall outside the limit? No: it takes newest first then records first seen per product — but if the true latest for some product is beyond the 3000th scanned row in that ordered set in an unexpected way, it’s wrong. Also arbitrary cap hides scale issues.
- **Why it matters:** Restock “supplier from last purchase” / “last buy price” / “suggested qty from last batch” may become inaccurate or slow.
- **Impact:** Incorrect restock suggestions, performance degradation.
- **Recommended repair:** Use a DB view or RPC that returns the latest `purchase_batches` row per `product_id` (e.g. `distinct on (product_id)` in Postgres, or a materialized approach), or paginate/aggregate server-side. Revisit `limit(3000)`.
- **Status:** **Confirmed** from implementation.

### M2 — `PurchasesSection` product quantity update uses number arithmetic on possibly non-numeric/locale-mixed values; buy price parsing edge cases
- **Files:** `src/admin/PurchasesSection.js` (e.g. `Number(fresh.quantity) || 0`, `Number(form.buy_price)`, `Number(b.buy_price) * Number(b.quantity)` in table)
- **Problem:** If `quantity` or `buy_price` are stored as strings in unexpected forms, `Number(...)` can yield `NaN` in some cases? Also `buy_price === ''` is handled, but if user checks “update buy price” the code requires a truthy non-empty check path in practice only when set? It sets `productUpdate.buy_price = Number(form.buy_price)` only if `updateBuyPrice && form.buy_price !== ''` — so OK. However, `qty` is validated as `Number(form.quantity) > 0` after parse; non-numeric input can become `NaN` and fail the check (good). Table displays may show `NaN` if bad data exists (defensive display missing).
- **Why it matters:** Rare bad data or future schema changes could surface odd UI/values.
- **Impact:** Low-to-medium data display issues; core validation mostly guards input.
- **Recommended repair:** Validate parsed numbers are finite before submit in all numeric paths; consider `Number.isFinite` consistently. Optionally format defensively in UI (e.g. show `–` if `NaN`).
- **Status:** **Partially confirmed** (gaps in defensive parsing/display in a couple of spots).

### M3 — `PurchasesSection` does not prevent duplicate/conflicting submissions beyond button disabling in practice? (double submit)
- **Files:** `src/admin/PurchasesSection.js` (`saving` state disables button, but rapid double actions or network retries could still be risky in theory; no idempotency key)
- **Problem:** `saving` flag is set; however, if the user triggers submit twice very quickly in some UIs or if logic allows re-entry, rare duplication could occur. More importantly, there is no server-side idempotency (e.g. invoice+batch unique constraints) enforced in the migration shown.
- **Why it matters:** Duplicate purchase batches can inflate stock if “add to stock” is checked twice for the same physical receipt.
- **Impact:** Incorrect inventory and financial records.
- **Recommended repair:** Add unique constraints where business-appropriate (e.g. per supplier+invoice_no when present) in a reviewed migration, and/or client-side guard + clear error handling. Document operational guidance.
- **Status:** **Potential risk** (not confirmed as exploited, but plausible).

### M4 — `SuppliersSection` edit allows toggling `active` including reactivating, but UI only shows checkbox when `form.id` is set (edit mode) — behavior is fine; however archived suppliers remain in lists elsewhere?
- **Files:** `src/admin/SuppliersSection.js`, `src/admin/PurchasesSection.js` (filters to `activeSuppliers` for new purchase dropdown), `src/admin/RestockSection.js` (filters `suppliers.filter(s=>s.active)` for grouping/assignment UI in places shown)
- **Problem:** Archived suppliers disappear from active pickers, which is usually desired. But historical `purchase_batches` reference them (and Restock can still show `group.supplierName` from joined data in some views? In Purchases history they join `suppliers(name)` and show it even if archived? Yes — history shows `b.suppliers?.name`. In Restock, grouping uses `groupBySupplier` with `suppliers` list passed in; `RestockSection` passes `(suppliers||[]).filter(s=>s.active)` into `groupBySupplier(items, activeSuppliers)`) — so restock groups for items whose `supplierId` points to an archived supplier will fall into **“No supplier assigned”** group because the supplier is not in the active list used for lookup. That can be misleading (history knows the supplier, but restock UI hides them).
- **Why it matters:** Operational confusion: you may want to reorder from a previously used (now archived) supplier? Or at least see the association.
- **Impact:** Medium usability/data clarity issue in restock planning.
- **Recommended repair:** Consider including inactive suppliers in restock grouping lookup (or show supplier name from last batch/joined context) while still excluding them from “assign new preferred supplier” active pickers as appropriate. Clarify product behavior.
- **Status:** **Confirmed** from code paths in `RestockSection` and `groupBySupplier` usage.

### M5 — `RestockSection` uses `window.prompt` fallback for clipboard copy; `navigator.clipboard.writeText` may fail in insecure contexts or some browsers without permissions — fallback is acceptable but UX is clunky
- **Files:** `src/admin/RestockSection.js` (`copyMessage`)
- **Problem:** No functional bug in modern secure contexts in practice, but behavior varies. Not a security flaw.
- **Impact:** Low usability annoyance in edge browsers/contexts.
- **Recommended repair:** Optional: show the message in a modal/text area for manual copy when clipboard API fails.
- **Status:** **Low/confirmable** behavior.

### M6 — `PurchasesSection` allows `expiry_date < manufacturing_date` check only if both set (good). However date inputs are plain text/date fields; no timezone nuance beyond `en-CA` in `today()` elsewhere — consistency is minor.
- **Files:** `src/admin/PurchasesSection.js`
- **Problem:** Client-side validation is present; server-side check constraints are not shown in migration for shelf-like date ordering on `purchase_batches` (migration only checks `quantity > 0`, `buy_price >= 0`). Invalid ranges could be inserted if bypassing UI.
- **Impact:** Low data quality risk.
- **Recommended repair:** Optional DB `check (expiry_date is null or manufacturing_date is null or expiry_date >= manufacturing_date)` in a future migration if desired.
- **Status:** **Minor gap** (UI-only validation).

## 6. Low-Priority Improvements

- **L1 — `AdminApp.js` size/growth:** New sections added (Suppliers/Purchases/Restock) alongside existing large component; consider extracting more sections to modules (already started for the three new ones — good). Continues to be a maintainability concern (not introduced by this commit alone but amplified).
- **L2 — Error messages:** Several `catch (er) { ... (er.message || er) }` patterns are fine; some raw error strings may leak internal details in UI in edge cases — low risk if messages are generic Supabase errors, but review periodically.
- **L3 — `RestockSection` `useMemo`/deps:** Dependencies look reasonable; `thresholdDrafts` / `supplierDrafts` are local state maps edited inline — behavior is fine but could be simplified.
- **L4 — `SuppliersSection` phone input:** Placeholder and docs mention “10-digit Indian…” normalization is in `normalizeWhatsAppPhone` (used in Restock messages/links). Purchases/Suppliers do not enforce format; that’s acceptable but could confuse users.
- **L5 — `App.css` changes:** Only additions/context shown in the full file read earlier included existing styles; the commit modified `App.css` (per git) — visual review recommended on small screens for new tables/forms (tables use `min-width` in places; wrapping behavior should be spot-checked manually).
- **L6 — Tests:** `restock.test.js` covers core helpers well. No component/integration tests added for new admin sections or Supabase flows (expected given CRA setup), but consider future smoke tests with mocked Supabase if test harness is expanded.

---

## 7. Database & Supabase Review

### Migration: `supabase/migrations/2026-11-16_suppliers_batches_restock.sql`
- **Additive:** Uses `create table if not exists`, `add column if not exists`, `create index if not exists`, `drop policy if exists` then create — low risk of clobbering existing objects if names match.
- **Extensions:** `create extension if not exists pgcrypto;` (appropriate for `gen_random_uuid()` usage patterns in this repo style).
- **Tables/columns (observed):**
  - `suppliers`: `active boolean not null default true`, timestamps — matches UI soft-archive model.
  - `purchase_batches`: `quantity numeric not null check (quantity > 0)`, `buy_price numeric check (buy_price >= 0)`, `purchase_date date not null default current_date`, FKs to `products(id)`, `suppliers(id)` (nullable). No `ON DELETE` specified → default FK behavior (typically RESTRICT/NO ACTION). No check ensuring `expiry_date >= manufacturing_date`.
  - `product_shelf_batches`: unique `(product_id, batch_number)`, not null dates, `total_shelf_life_days integer not null` — aligns with Admin Shelf Life expectations noted in docs.
  - `products.low_stock_threshold numeric`, `products.preferred_supplier_id uuid references suppliers(id)` — nullable, optional.
- **RLS:** Enables RLS on the three new tables. Policies: `select` for `authenticated` using `(true)`, `all` for `authenticated` using/checking `public.is_admin()`. This matches the documented pattern in `docs/SUPABASE_ADMIN_SETUP.md`. **Note:** `public.is_admin()` is defined in this migration (creates/replaces function). If the function already exists with different semantics elsewhere, this is a deliberate alignment — but ensure it matches your production JWT claim strategy.
- **Not changed:** `products` policies untouched (per comments). Purchases flow updates `products.quantity`, `buy_price`, `preferred_supplier_id` — requires that existing admin UPDATE policy on `products` permits those columns/rows; **not verifiable from repo alone** (must be confirmed in Supabase).

### Docs
- `docs/SUPPLIERS_RESTOCK_SETUP.md` is clear about running SQL, flow, RLS summary, and operational notes (non-atomic stock updates, limits). Good.
- `docs/SUPABASE_ADMIN_SETUP.md` updated to reference new tables/columns and the setup doc/migration — consistent.

### Data model notes (non-blocking but important)
- No `updated_at` trigger shown for `suppliers` in the migration SQL shown (table has `updated_at` default `now()`; app sets it on update in `SuppliersSection` — fine). `purchase_batches` has no `updated_at` (immutable-style record in practice) — acceptable.
- Consider indexes on `purchase_batches.purchase_date` if you query by date ranges later (current indexes cover product/supplier + date desc composites) — probably sufficient for current usage.

---

## 8. Security Review

- **Secrets:** No API keys, service-role keys, or credentials found in inspected source/docs/migration files. Supabase client usage follows existing patterns (`sb` from `lib/supabase`).
- **Authorization model:** Relies on Supabase Auth + RLS with `is_admin()` helper; frontend gates are UX only (consistent with project docs). New tables have RLS enabled with admin-only writes and authenticated reads — aligns with stated policy intent. **Risk:** If `is_admin()` is misconfigured in production (wrong claim path) or policies not applied, exposure/denial could occur; this is an ops/config risk, not a code bug in the files shown.
- **Input handling:** User inputs are sent to Supabase client queries/inserts/updates via the JS client (parameterized by the client library in normal use). No raw SQL string concatenation from user input in app code observed in the reviewed files. Phone normalization strips non-digits and builds `wa.me` links — `encodeURIComponent` is used for message text (good). No `dangerouslySetInnerHTML` observed in new components.
- **XSS:** React escapes by default; message text is placed into `href` via `buildWhatsAppLink` with `encodeURIComponent` — appropriate.
- **Clipboard:** Uses `navigator.clipboard.writeText` with fallback `window.prompt` (user action context) — low risk.
- **Least privilege / data exposure:** Authenticated users can **read** `suppliers`, `purchase_batches`, `product_shelf_batches` per RLS (`using true`). That may be intentional for operational visibility but means any authenticated user (non-admin) could read these tables directly if they have a session — verify this matches business requirements (docs say “authenticated users can read…” in migration comments/UI hints; confirm intended audience).

---

## 9. Potential Regressions

- **`App.test.js` updated** to assert “Stock ledger” heading and “Admin Panel” link — matches current `LedgerApp`/`App` behavior. Test passes.
- **Admin tab set expanded** (Suppliers, Purchases, Restock added). Existing tabs/flows unchanged in structure; risk is mainly runtime (missing migration tables → code catches and sets empty arrays / shows errors) which is handled with try/catch and user-facing hints in UI — **graceful degradation present**, but could confuse users if migration not run.
- **Product model:** New nullable columns `low_stock_threshold`, `preferred_supplier_id` added via migration; existing product reads/writes in other parts of app are unaffected unless they assume strict schemas — no evidence of breaks in reviewed files.
- **Shelf Life:** Migration adds `product_shelf_batches` (and Admin previously expected it) — aligns with prior audit notes; this should reduce/resolve the earlier “save may fail if table missing” issue *after* migration is applied.
- **Restock grouping when supplier archived:** As noted in M4, archived suppliers no longer appear in active supplier lists for assignment/grouping in the same way, which can change what admins see (items may appear under “No supplier assigned”). This is a **behavioral change in UX/data presentation**, not a crash — verify it matches intended workflow.

---

## 10. Recommended Repair Order

1. **H1 (High):** Implement atomic stock increment for purchases (DB function/RPC + client call), with error handling and tests/verification plan. **Coordinate DB migration/RLS review.**
2. **H2 (High):** Formalize FK delete policy for `purchase_batches`/`product_shelf_batches` (and document product deletion rules). Add clear UI error messaging if deletes are blocked; consider migration only with approval.
3. **M4 (Medium):** Decide and implement restock behavior for archived/inactive suppliers (include in lookup for grouping display vs assignment rules) to avoid misleading “No supplier assigned”.
4. **M1 (Medium):** Replace unbounded “latest batch per product” client scan with server-side aggregation (view/RPC) or bounded strategy.
5. **M3 (Medium):** Consider idempotency/uniqueness strategy for purchase batches if duplicates are observed in practice (migration + UX).
6. **M2, M6, L-items:** Address incrementally (numeric parsing hardening, optional DB date check, clipboard UX polish, maintainability splits).

---

## 11. Overall Codebase Assessment

**Working well (evidence-based):**
- V2.3 changes are cohesive: migration + services + UI + docs + unit tests for restock logic.
- `restock.js` helpers are pure and covered by tests (21 passing). `App.test.js` reflects current landing UI.
- RLS direction matches documented admin model; new tables are protected with admin-write policies.
- Graceful handling when optional tables/columns may be missing in some environments (try/catch + user hints) reduces hard crashes.

**Needs attention before relying on at scale / multi-admin:**
- Purchase stock updates are **not atomic** (H1). This is the most important technical risk in the new feature set.
- Data retention/integrity policies around FKs and deletes need explicit decisions (H2).
- Restock “last batch” computation will not scale well as history grows (M1).

**Needs further investigation (not confirmed bugs):**
- Live Supabase: confirm `products` UPDATE RLS allows the fields modified by Purchases; confirm `is_admin()` claims in your project match the migration’s function; confirm whether authenticated non-admin read on new tables is intended.
- Manual QA: Purchases save with “add to stock” + “update buy price” + “remember supplier” combinations; Restock grouping with mixed archived suppliers; WhatsApp link behavior on mobile; large product lists performance in Purchases/Restock filters.

**Overall:** The pull introduces a substantial, well-documented feature set with good test coverage for core logic. The main blockers for confident production use in concurrent/multi-admin or long-lived data scenarios are **atomicity of stock updates** and **FK/delete policy clarity**; other items are important improvements but not immediate application-breaking defects from static review alone.

*End of report.*
