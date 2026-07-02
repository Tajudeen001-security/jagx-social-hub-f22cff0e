-- Manual (non-JagX) payment option for marketplace orders + a public order-receipts
-- bucket so both buyer and seller can view the uploaded proof.

alter table public.marketplace_orders
  add column if not exists payment_method text not null default 'jagx',
  -- 'jagx' | 'manual'
  add column if not exists payment_currency text,
  -- 'USD' | 'GBP' | 'EUR' | 'USDC-BEP20' | 'USDT-BEP20' | 'USDT-TRC20' (freeform)
  add column if not exists payment_amount text,
  add column if not exists receipt_url text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz;

-- Public bucket for order receipts (readable by anyone with the URL —
-- buyer + seller need to view it; keys are UUID-scoped).
insert into storage.buckets (id, name, public)
values ('order-receipts', 'order-receipts', true)
on conflict (id) do nothing;

drop policy if exists "order_receipts_upload_own" on storage.objects;
create policy "order_receipts_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "order_receipts_read_public" on storage.objects;
create policy "order_receipts_read_public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'order-receipts');

-- Place a manual-payment order: reserves stock, does NOT debit JagX.
-- Status starts at 'awaiting_payment' until buyer uploads receipt and
-- seller confirms.
create or replace function public.place_manual_marketplace_order(
  _listing_id uuid,
  _quantity integer,
  _buyer_name text,
  _buyer_phone text,
  _buyer_address text,
  _buyer_lat double precision,
  _buyer_lng double precision,
  _note text,
  _payment_currency text,
  _payment_amount text
) returns public.marketplace_orders
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.marketplace_listings%rowtype;
  v_distance_km numeric(10, 2);
  v_delivery integer := 0;
  v_subtotal integer;
  v_total integer;
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

  -- reserve stock but do not close listing yet; if seller rejects we restore
  update public.marketplace_listings
    set stock = stock - _quantity,
        status = case when stock - _quantity <= 0 then 'sold_out' else status end,
        updated_at = now()
    where id = _listing_id;

  insert into public.marketplace_orders (
    listing_id, buyer_id, seller_id, quantity,
    unit_price_coins, delivery_fee_coins, total_coins, distance_km,
    buyer_name, buyer_phone, buyer_address, buyer_lat, buyer_lng, note,
    status, payment_method, payment_currency, payment_amount
  ) values (
    _listing_id, v_uid, v_listing.seller_id, _quantity,
    v_listing.price_coins, v_delivery, v_total, v_distance_km,
    _buyer_name, _buyer_phone, _buyer_address, _buyer_lat, _buyer_lng, _note,
    'awaiting_payment', 'manual', _payment_currency, _payment_amount
  ) returning * into v_order;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (
    v_listing.seller_id, v_uid, 'order',
    'New manual-payment order for "' || v_listing.title || '" ('||coalesce(_payment_currency,'?')||') — awaiting buyer receipt.'
  );

  return v_order;
end; $$;

grant execute on function public.place_manual_marketplace_order(
  uuid, integer, text, text, text, double precision, double precision, text, text, text
) to authenticated;

-- Buyer uploads/updates the receipt URL then flips to 'awaiting_confirmation'.
create or replace function public.submit_manual_order_receipt(_order_id uuid, _receipt_url text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.marketplace_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into o from public.marketplace_orders where id = _order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.buyer_id <> auth.uid() then raise exception 'Only the buyer can submit a receipt'; end if;
  if o.payment_method <> 'manual' then raise exception 'Not a manual order'; end if;

  update public.marketplace_orders
    set receipt_url = _receipt_url,
        receipt_uploaded_at = now(),
        status = 'awaiting_confirmation',
        updated_at = now()
    where id = _order_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (
    o.seller_id, auth.uid(), 'order',
    'Buyer uploaded a payment receipt — please confirm to release the order.'
  );
end; $$;
grant execute on function public.submit_manual_order_receipt(uuid, text) to authenticated;

-- Seller confirms they received manual payment → flips to 'accepted' (Paid stage).
create or replace function public.confirm_manual_order_payment(_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.marketplace_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into o from public.marketplace_orders where id = _order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.seller_id <> auth.uid() then raise exception 'Only the seller can confirm payment'; end if;
  if o.payment_method <> 'manual' then raise exception 'Not a manual order'; end if;

  update public.marketplace_orders
    set status = 'accepted',
        payment_confirmed_at = now(),
        updated_at = now()
    where id = _order_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (
    o.buyer_id, auth.uid(), 'order',
    'Seller confirmed your payment — your order is now paid and being prepared.'
  );
end; $$;
grant execute on function public.confirm_manual_order_payment(uuid) to authenticated;

notify pgrst, 'reload schema';