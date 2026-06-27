-- Phase 5: JagX Marketplace
-- Apply this in your Supabase SQL editor.
-- Adds profile contact fields, marketplace_listings, marketplace_orders,
-- and an atomic order RPC that debits JagX coins buyer -> seller, decrements
-- stock, inserts the order, and notifies the seller in real time.

-- 1) Profile contact/address extensions (idempotent)
alter table public.profiles
  add column if not exists phone text,
  add column if not exists delivery_address text,
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision;

-- 2) Listings
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  category text,
  price_coins integer not null check (price_coins >= 0),
  stock integer not null default 1 check (stock >= 0),
  image_url text,
  pickup_address text,
  lat double precision,
  lng double precision,
  delivery_fee_per_km integer not null default 1,
  max_delivery_km integer not null default 50,
  status text not null default 'active', -- active | sold_out | archived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_listings_seller_idx
  on public.marketplace_listings(seller_id);
create index if not exists marketplace_listings_status_created_idx
  on public.marketplace_listings(status, created_at desc);

grant select on public.marketplace_listings to anon, authenticated;
grant insert, update, delete on public.marketplace_listings to authenticated;
grant all on public.marketplace_listings to service_role;

alter table public.marketplace_listings enable row level security;

drop policy if exists "listings public read" on public.marketplace_listings;
create policy "listings public read"
  on public.marketplace_listings for select using (true);

drop policy if exists "sellers insert own listings" on public.marketplace_listings;
create policy "sellers insert own listings"
  on public.marketplace_listings for insert to authenticated
  with check (auth.uid() = seller_id);

drop policy if exists "sellers update own listings" on public.marketplace_listings;
create policy "sellers update own listings"
  on public.marketplace_listings for update to authenticated
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

drop policy if exists "sellers delete own listings" on public.marketplace_listings;
create policy "sellers delete own listings"
  on public.marketplace_listings for delete to authenticated
  using (auth.uid() = seller_id);

-- 3) Orders
create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_coins integer not null,
  delivery_fee_coins integer not null default 0,
  total_coins integer not null,
  distance_km numeric(10, 2),
  buyer_name text,
  buyer_phone text,
  buyer_address text not null,
  buyer_lat double precision,
  buyer_lng double precision,
  note text,
  status text not null default 'pending', -- pending | accepted | out_for_delivery | delivered | cancelled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_orders_buyer_idx on public.marketplace_orders(buyer_id);
create index if not exists marketplace_orders_seller_idx on public.marketplace_orders(seller_id);

grant select, insert, update on public.marketplace_orders to authenticated;
grant all on public.marketplace_orders to service_role;

alter table public.marketplace_orders enable row level security;

drop policy if exists "orders parties read" on public.marketplace_orders;
create policy "orders parties read"
  on public.marketplace_orders for select to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

drop policy if exists "buyer creates order" on public.marketplace_orders;
create policy "buyer creates order"
  on public.marketplace_orders for insert to authenticated
  with check (auth.uid() = buyer_id);

drop policy if exists "parties update order" on public.marketplace_orders;
create policy "parties update order"
  on public.marketplace_orders for update to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id)
  with check (auth.uid() = buyer_id or auth.uid() = seller_id);

-- 4) Atomic checkout RPC
create or replace function public.place_marketplace_order(
  _listing_id uuid,
  _quantity integer,
  _buyer_name text,
  _buyer_phone text,
  _buyer_address text,
  _buyer_lat double precision,
  _buyer_lng double precision,
  _note text
) returns public.marketplace_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.marketplace_listings%rowtype;
  v_distance_km numeric(10, 2);
  v_delivery integer := 0;
  v_subtotal integer;
  v_total integer;
  v_buyer_coins integer;
  v_order public.marketplace_orders%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if _quantity is null or _quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  select * into v_listing from public.marketplace_listings
    where id = _listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if v_listing.status <> 'active' then raise exception 'Listing not active'; end if;
  if v_listing.stock < _quantity then raise exception 'Insufficient stock'; end if;
  if v_listing.seller_id = v_uid then raise exception 'You cannot order your own listing'; end if;

  if v_listing.lat is not null and v_listing.lng is not null
     and _buyer_lat is not null and _buyer_lng is not null then
    v_distance_km := round((
      2 * 6371 * asin(sqrt(
        sin(radians((_buyer_lat - v_listing.lat) / 2))^2 +
        cos(radians(v_listing.lat)) * cos(radians(_buyer_lat)) *
        sin(radians((_buyer_lng - v_listing.lng) / 2))^2
      ))
    )::numeric, 2);
    if v_distance_km > v_listing.max_delivery_km then
      raise exception 'Delivery distance exceeds seller limit (% km)', v_listing.max_delivery_km;
    end if;
    v_delivery := ceil(v_distance_km * v_listing.delivery_fee_per_km)::integer;
  end if;

  v_subtotal := v_listing.price_coins * _quantity;
  v_total := v_subtotal + v_delivery;

  select jagx_coins into v_buyer_coins from public.profiles where user_id = v_uid for update;
  if v_buyer_coins is null then raise exception 'Buyer profile missing'; end if;
  if v_buyer_coins < v_total then raise exception 'Insufficient JagX coins'; end if;

  update public.profiles set jagx_coins = jagx_coins - v_total where user_id = v_uid;
  update public.profiles set jagx_coins = jagx_coins + v_total where user_id = v_listing.seller_id;

  update public.marketplace_listings
    set stock = stock - _quantity,
        status = case when stock - _quantity <= 0 then 'sold_out' else status end,
        updated_at = now()
    where id = _listing_id;

  insert into public.marketplace_orders (
    listing_id, buyer_id, seller_id, quantity,
    unit_price_coins, delivery_fee_coins, total_coins, distance_km,
    buyer_name, buyer_phone, buyer_address, buyer_lat, buyer_lng, note
  ) values (
    _listing_id, v_uid, v_listing.seller_id, _quantity,
    v_listing.price_coins, v_delivery, v_total, v_distance_km,
    _buyer_name, _buyer_phone, _buyer_address, _buyer_lat, _buyer_lng, _note
  ) returning * into v_order;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (
    v_listing.seller_id, v_uid, 'order',
    'New order for "' || v_listing.title || '" — ' || v_total || ' JagX'
  );

  return v_order;
end;
$$;

grant execute on function public.place_marketplace_order(
  uuid, integer, text, text, text, double precision, double precision, text
) to authenticated;

-- 5) Realtime
do $$ begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin
      execute 'alter publication supabase_realtime add table public.marketplace_listings';
    exception when duplicate_object then null; end;
    begin
      execute 'alter publication supabase_realtime add table public.marketplace_orders';
    exception when duplicate_object then null; end;
  end if;
end $$;