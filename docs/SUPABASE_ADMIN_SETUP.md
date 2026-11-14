# Supabase Admin Panel Setup (RLS & Auth)

This app uses **Supabase Auth** for admin login and expects **server-side enforcement via Row Level Security (RLS)** for all administrative operations. The frontend checks admin status for UX, but **RLS policies must be the source of truth**.

## 1. Authentication
- Enable Email/Password auth in Supabase Dashboard (Authentication → Providers).
- Create an admin user and mark them as admin, for example by setting `app_metadata`:
  - In Dashboard: Authentication → Users → select user → edit user metadata / raw app meta (or use SQL/Admin API).
  - Recommended: `app_metadata = {"role":"admin"}` (the app treats `role=admin` or `is_admin=true` in `app_metadata`/`user_metadata` as admin for UI access).

> Frontend admin gating is not sufficient alone; always enforce with RLS.

## 2. Database schema (existing, inspected from app usage)
The app expects these tables/columns (names inferred from current implementation):
- `products(id, name, category, unit, buy_price, sell_price, mrp, quantity, ...)`
- `delivery_partners(id, name, phone, active, created_at, ...)`
- `delivery_settings(id=1, grocery_customer_charge, grocery_partner_earning, restaurant_customer_charge, restaurant_partner_earning, updated_at)`
- `delivery_records(id, partner_id, delivery_type, status, delivery_date, customer_charge, partner_earning, note, created_at, ...)`
- `delivery_payments(id, partner_id, amount, payment_date, note, created_at, ...)`

**No destructive migrations required.** Partner "delete" in Admin is implemented as **soft delete/archive** (`active = false`) to preserve historical `delivery_records` and `delivery_payments`.

## 3. Helper: identify admin in SQL
Use a helper based on JWT claims, e.g.:
```sql
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'
    or (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    false
  );
$$;
```
(Adjust to match how you store admin claims.)

## 4. Example RLS policies (adapt to your current policies/schema)
Enable RLS on relevant tables and ensure policies match your access model. Below is a **reference** pattern; review against existing policies before applying.

### `delivery_partners`
- Public/anon/authenticated read (if ledger needs to show partner names): allow `select` as needed by app.
- Admin-only management:
```sql
alter table delivery_partners enable row level security;

-- example: allow reads for authenticated users (adjust if anon needed)
create policy "partners_select_authenticated"
on delivery_partners for select
to authenticated
using (true);

-- admin can insert/update (including soft-delete/archive via active=false)
create policy "partners_admin_write"
on delivery_partners for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
```

### `delivery_settings`
```sql
alter table delivery_settings enable row level security;
create policy "settings_select"
on delivery_settings for select to authenticated using (true);
create policy "settings_admin_write"
on delivery_settings for all to authenticated
using (public.is_admin()) with check (public.is_admin());
```

### `delivery_records` and `delivery_payments`
- Ledger may need to insert/select records depending on your workflow. Restrict admin-only operations (e.g. deleting payments, broad management) via `is_admin()` as appropriate. Example (restrict destructive/payment management to admin while allowing operational inserts if required):
```sql
alter table delivery_records enable row level security;
alter table delivery_payments enable row level security;

-- tune these to your app: allow operational reads/inserts as needed, but protect admin management
create policy "records_select" on delivery_records for select to authenticated using (true);
create policy "records_insert" on delivery_records for insert to authenticated with check (true);
create policy "records_admin_update_delete" on delivery_records for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "payments_select" on delivery_payments for select to authenticated using (true);
create policy "payments_admin_write" on delivery_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

### `products`
Keep existing product policies; do not weaken them. If none exist, add appropriate policies for your use case.

## 5. Security notes
- **Never expose** Supabase `service_role` key in frontend code. This app uses only the publishable/anon key.
- Unauthorized users must not bypass UI: ensure RLS denies admin writes when `is_admin()` is false.
- Test with a non-admin authenticated user and with anon key calls to confirm direct API access is blocked for protected operations.

## 6. Verification checklist
- [ ] Admin user can log in and access `/admin`
- [ ] Non-admin authenticated user is denied admin UI and RLS blocks admin writes
- [ ] Partner create/edit/archive works; historical records remain intact
- [ ] Rates update works and future deliveries snapshot new rates (existing behavior preserved)
- [ ] Payment create/delete (admin) works
- [ ] Ledger scrolling and core product/delivery recording still function
