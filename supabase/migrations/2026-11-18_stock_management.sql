-- Rack-aware inventory with an auditable movement ledger.
-- Existing products.quantity values are preserved and seeded into Unassigned.
-- Apply only after reviewing this migration in Supabase SQL Editor.

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint stock_locations_name_nonempty check (length(trim(name)) > 0)
);

create table if not exists public.stock_balances (
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening', 'add', 'set', 'reconciliation')),
  quantity_delta numeric not null,
  quantity_before numeric not null check (quantity_before >= 0),
  quantity_after numeric not null check (quantity_after >= 0),
  reason text not null check (length(trim(reason)) > 0),
  request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists stock_balances_location_idx
  on public.stock_balances(location_id, product_id);
create index if not exists stock_movements_product_created_idx
  on public.stock_movements(product_id, created_at desc);
create index if not exists stock_movements_location_created_idx
  on public.stock_movements(location_id, created_at desc);
drop index if exists public.stock_movements_request_product_uidx;
create unique index if not exists stock_movements_request_product_location_uidx
  on public.stock_movements(request_id, product_id, location_id)
  where request_id is not null;

insert into public.stock_locations(name, is_system)
values ('Unassigned', true)
on conflict (name) do update set is_system = true;

-- Carry forward the existing aggregate quantity without resetting or incrementing it.
insert into public.stock_balances(product_id, location_id, quantity)
select p.id, l.id, p.quantity
from public.products p
cross join public.stock_locations l
where l.name = 'Unassigned' and p.quantity > 0
on conflict (product_id, location_id) do nothing;

insert into public.stock_movements(
  product_id, location_id, movement_type, quantity_delta,
  quantity_before, quantity_after, reason
)
select b.product_id, b.location_id, 'opening', b.quantity,
       0, b.quantity, 'Opening balance carried forward from products.quantity'
from public.stock_balances b
join public.stock_locations l on l.id = b.location_id
where l.name = 'Unassigned'
  and not exists (
    select 1 from public.stock_movements m
    where m.product_id = b.product_id
      and m.location_id = b.location_id
      and m.movement_type = 'opening'
  );

-- Keep products.quantity as the aggregate compatibility field used by the public ledger.
update public.products p
set quantity = coalesce((
  select sum(b.quantity)
  from public.stock_balances b
  where b.product_id = p.id
), 0),
updated_at = now();

alter table public.stock_locations enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists stock_locations_authenticated_read on public.stock_locations;
create policy stock_locations_authenticated_read
  on public.stock_locations for select to authenticated using (true);

drop policy if exists stock_locations_admin_insert on public.stock_locations;
create policy stock_locations_admin_insert
  on public.stock_locations for insert to authenticated
  with check (public.is_admin());

drop policy if exists stock_balances_authenticated_read on public.stock_balances;
create policy stock_balances_authenticated_read
  on public.stock_balances for select to authenticated using (true);

drop policy if exists stock_balances_admin_insert on public.stock_balances;
create policy stock_balances_admin_insert
  on public.stock_balances for insert to authenticated
  with check (public.is_admin());

drop policy if exists stock_balances_admin_update on public.stock_balances;
create policy stock_balances_admin_update
  on public.stock_balances for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists stock_movements_authenticated_read on public.stock_movements;
create policy stock_movements_authenticated_read
  on public.stock_movements for select to authenticated using (true);

drop policy if exists stock_movements_admin_insert on public.stock_movements;
create policy stock_movements_admin_insert
  on public.stock_movements for insert to authenticated
  with check (public.is_admin());

-- Keep the stock RPC invoker-scoped; RLS remains active for every write.
grant select, insert on public.stock_locations to authenticated;
grant select, insert, update on public.stock_balances to authenticated;
grant select, insert on public.stock_movements to authenticated;

-- Align product quantity updates with the same trusted app_metadata admin helper.
drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- All stock writes go through this admin-only, atomic RPC. A single request may
-- reconcile many products, but each product may occur only once in that request.
create or replace function public.apply_stock_adjustments(
  p_request_id uuid,
  p_adjustments jsonb,
  p_reason text
)
returns table(
  product_id uuid,
  location_id uuid,
  quantity_before numeric,
  quantity_after numeric,
  total_product_quantity numeric
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_item record;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_total numeric;
  v_type text;
  v_exists boolean;
  v_unassigned_id uuid;
  v_source_before numeric;
  v_transfer numeric;
  v_location_name text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'Request ID is required' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_adjustments) is distinct from 'array'
     or jsonb_array_length(p_adjustments) = 0
     or jsonb_array_length(p_adjustments) > 1000 then
    raise exception 'Provide between 1 and 1000 stock adjustments' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_adjustments)
      as x(product_id uuid, location_id uuid, mode text, quantity numeric)
    group by x.product_id
    having count(*) > 1
  ) then
    raise exception 'A product can appear only once in a stock request' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_adjustments)
      as x(product_id uuid, location_id uuid, mode text, quantity numeric)
  loop
    if v_item.product_id is null or v_item.location_id is null
       or v_item.mode is null
       or v_item.mode not in ('add', 'set', 'reconcile')
       or v_item.quantity is null
       or v_item.quantity::text in ('NaN', 'Infinity', '-Infinity')
       or v_item.quantity < 0
       or (v_item.mode = 'add' and v_item.quantity = 0) then
      raise exception 'Invalid stock adjustment input' using errcode = '22023';
    end if;

    select exists (
      select 1 from public.stock_movements m
      where m.request_id = p_request_id and m.product_id = v_item.product_id
    ) into v_exists;

    if v_exists then
      continue;
    end if;

    perform 1 from public.products p
    where p.id = v_item.product_id
    for update;
    if not found then
      raise exception 'Product not found: %', v_item.product_id using errcode = 'P0002';
    end if;

    perform 1 from public.stock_locations l where l.id = v_item.location_id;
    if not found then
      raise exception 'Stock location not found: %', v_item.location_id using errcode = 'P0002';
    end if;

    insert into public.stock_balances(product_id, location_id, quantity)
    values (v_item.product_id, v_item.location_id, 0)
    on conflict (product_id, location_id) do nothing;

    select b.quantity into v_before
    from public.stock_balances b
    where b.product_id = v_item.product_id and b.location_id = v_item.location_id
    for update;

    if v_item.mode = 'add' then
      v_after := v_before + v_item.quantity;
      v_type := 'add';
    else
      v_after := v_item.quantity;
      v_type := case when v_item.mode = 'set' then 'set' else 'reconciliation' end;
    end if;

    v_delta := v_after - v_before;

    -- When a physical count increases a rack balance, move available opening
    -- stock out of Unassigned first. This prevents double-counting the opening
    -- balance when stock is physically placed onto a rack.
    if v_item.mode = 'reconcile' and v_delta > 0 then
      select l.id into v_unassigned_id
      from public.stock_locations l
      where l.name = 'Unassigned';

      if v_unassigned_id is not null and v_unassigned_id <> v_item.location_id then
        insert into public.stock_balances(product_id, location_id, quantity)
        values (v_item.product_id, v_unassigned_id, 0)
        on conflict (product_id, location_id) do nothing;

        select b.quantity into v_source_before
        from public.stock_balances b
        where b.product_id = v_item.product_id
          and b.location_id = v_unassigned_id
        for update;

        v_transfer := least(v_delta, v_source_before);
        if v_transfer > 0 then
          update public.stock_balances b
          set quantity = v_source_before - v_transfer, updated_at = now()
          where b.product_id = v_item.product_id
            and b.location_id = v_unassigned_id;

          select l.name into v_location_name
          from public.stock_locations l
          where l.id = v_item.location_id;

          insert into public.stock_movements(
            product_id, location_id, movement_type, quantity_delta,
            quantity_before, quantity_after, reason, request_id
          ) values (
            v_item.product_id, v_unassigned_id, 'reconciliation', -v_transfer,
            v_source_before, v_source_before - v_transfer,
            trim(p_reason) || ' (moved to ' || coalesce(v_location_name, 'rack') || ')',
            p_request_id
          );
        end if;
      end if;
    end if;

    update public.stock_balances b
    set quantity = v_after, updated_at = now()
    where b.product_id = v_item.product_id and b.location_id = v_item.location_id;

    select coalesce(sum(b.quantity), 0) into v_total
    from public.stock_balances b
    where b.product_id = v_item.product_id;

    update public.products p
    set quantity = v_total, updated_at = now()
    where p.id = v_item.product_id;

    insert into public.stock_movements(
      product_id, location_id, movement_type, quantity_delta,
      quantity_before, quantity_after, reason, request_id
    ) values (
      v_item.product_id, v_item.location_id, v_type, v_delta,
      v_before, v_after, trim(p_reason), p_request_id
    );

    return query select v_item.product_id, v_item.location_id, v_before, v_after, v_total;
  end loop;
end;
$function$;

revoke all on function public.apply_stock_adjustments(uuid, jsonb, text) from public, anon;
grant execute on function public.apply_stock_adjustments(uuid, jsonb, text) to authenticated;

-- Purchase records retain supplier-specific prices but never alter stock,
-- the product's global buy_price, or its preferred supplier.
create or replace function public.record_purchase(
  p_request_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_buy_price numeric default null,
  p_supplier_id uuid default null,
  p_purchase_date date default current_date,
  p_invoice_no text default null,
  p_batch_number text default null,
  p_manufacturing_date date default null,
  p_expiry_date date default null,
  p_note text default null
)
returns table(
  purchase_batch_id uuid,
  product_id uuid,
  stock_quantity numeric,
  replayed boolean
)
language plpgsql
set search_path = ''
as $function$
declare
  v_batch_id uuid;
  v_existing public.purchase_batches%rowtype;
  v_stock numeric;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_request_id is null or p_product_id is null then
    raise exception 'Request ID and product ID are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0
     or p_quantity::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Quantity must be a finite positive number' using errcode = '22023';
  end if;
  if p_buy_price is not null and (
    p_buy_price < 0 or p_buy_price::text in ('NaN', 'Infinity', '-Infinity')
  ) then
    raise exception 'Invalid purchase price' using errcode = '22023';
  end if;
  if p_manufacturing_date is not null and p_expiry_date is not null
     and p_expiry_date < p_manufacturing_date then
    raise exception 'Expiry date cannot precede manufacturing date' using errcode = '22023';
  end if;

  perform 1 from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  insert into public.purchase_batches(
    product_id, supplier_id, quantity, buy_price, purchase_date,
    invoice_no, batch_number, manufacturing_date, expiry_date, note, request_id
  ) values (
    p_product_id, p_supplier_id, p_quantity, p_buy_price, p_purchase_date,
    p_invoice_no, p_batch_number, p_manufacturing_date, p_expiry_date, p_note, p_request_id
  )
  on conflict (request_id) where request_id is not null
  do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select * into v_existing
    from public.purchase_batches
    where request_id = p_request_id;

    if not found then
      raise exception 'Unable to resolve purchase request';
    end if;

    if v_existing.product_id is distinct from p_product_id
       or v_existing.supplier_id is distinct from p_supplier_id
       or v_existing.quantity is distinct from p_quantity
       or v_existing.buy_price is distinct from p_buy_price
       or v_existing.purchase_date is distinct from p_purchase_date
       or v_existing.invoice_no is distinct from p_invoice_no
       or v_existing.batch_number is distinct from p_batch_number
       or v_existing.manufacturing_date is distinct from p_manufacturing_date
       or v_existing.expiry_date is distinct from p_expiry_date
       or v_existing.note is distinct from p_note then
      raise exception 'Request ID already used with different purchase details' using errcode = '22023';
    end if;

    select p.quantity into v_stock from public.products p where p.id = p_product_id;
    return query select v_existing.id, v_existing.product_id, v_stock, true;
    return;
  end if;

  select p.quantity into v_stock from public.products p where p.id = p_product_id;
  return query select v_batch_id, p_product_id, v_stock, false;
end;
$function$;

revoke all on function public.record_purchase(uuid, uuid, numeric, numeric, uuid, date, text, text, date, date, text) from public, anon;
grant execute on function public.record_purchase(uuid, uuid, numeric, numeric, uuid, date, text, text, date, date, text) to authenticated;
