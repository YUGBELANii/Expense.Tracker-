-- Suppliers, purchase batches and restock support + the missing shelf-life table.
-- Run this once in the Supabase SQL editor (Dashboard > SQL).
-- Additive only: no existing table, column or row is modified or dropped.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 1. Suppliers (who we buy from: distributor / wholesaler / direct)
-- ---------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,              -- WhatsApp number, 10-digit Indian or +91
  contact_person text,
  address text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. Purchase batches: which items we bought from which supplier
-- ---------------------------------------------------------------
create table if not exists public.purchase_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  supplier_id uuid references public.suppliers(id),
  quantity numeric not null check (quantity > 0),
  buy_price numeric check (buy_price >= 0),   -- per-unit price at purchase time (snapshot)
  purchase_date date not null default current_date,
  invoice_no text,
  batch_number text,
  manufacturing_date date,
  expiry_date date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_batches_product_idx
  on public.purchase_batches (product_id, purchase_date desc);
create index if not exists purchase_batches_supplier_idx
  on public.purchase_batches (supplier_id, purchase_date desc);

-- ---------------------------------------------------------------
-- 3. Shelf-life table the existing Admin > Shelf Life section
--    already expects (it did not exist in the database yet)
-- ---------------------------------------------------------------
create table if not exists public.product_shelf_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  batch_number text not null,
  manufacturing_date date not null,
  expiry_date date not null,
  total_shelf_life_days integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, batch_number)
);

-- ---------------------------------------------------------------
-- 4. Restock columns on products (additive, nullable)
-- ---------------------------------------------------------------
alter table public.products add column if not exists low_stock_threshold numeric;
alter table public.products add column if not exists preferred_supplier_id uuid references public.suppliers(id);

-- ---------------------------------------------------------------
-- 5. Row Level Security
--    Same pattern as docs/SUPABASE_ADMIN_SETUP.md:
--    authenticated users can read, only admins can write.
-- ---------------------------------------------------------------
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

alter table public.suppliers enable row level security;
alter table public.purchase_batches enable row level security;
alter table public.product_shelf_batches enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated using (true);
drop policy if exists suppliers_admin_write on public.suppliers;
create policy suppliers_admin_write on public.suppliers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists purchase_batches_select on public.purchase_batches;
create policy purchase_batches_select on public.purchase_batches
  for select to authenticated using (true);
drop policy if exists purchase_batches_admin_write on public.purchase_batches;
create policy purchase_batches_admin_write on public.purchase_batches
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists shelf_batches_select on public.product_shelf_batches;
create policy shelf_batches_select on public.product_shelf_batches
  for select to authenticated using (true);
drop policy if exists shelf_batches_admin_write on public.product_shelf_batches;
create policy shelf_batches_admin_write on public.product_shelf_batches
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Products policies are intentionally untouched (see SUPABASE_ADMIN_SETUP.md).
-- The Purchases screen updates products.quantity, products.buy_price and
-- products.preferred_supplier_id, so the existing admin update policy on
-- products must allow those updates (it already does if Products CRUD works).
