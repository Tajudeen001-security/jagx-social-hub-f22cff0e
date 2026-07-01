-- =====================================================================
-- 2026-07-01 hot-fixes (round 2)
--
-- Symptoms reported:
--   • Sending a gift shows:
--       "Could not find the 'post_id' column of 'gifts' in the schema cache"
--   • Approving a coin purchase shows:
--       "column coin_balance does not exist"
--   • Investment page shows "Your balance: 0 JagX" even when the user has coins.
--
-- Root cause:
--   The wallet column on public.profiles is `jagx_coins`, not `coin_balance`.
--   Several SECURITY DEFINER RPCs written in the previous patches read/write
--   `coin_balance`, which aborts every call. The gift error is a stale
--   PostgREST schema cache — a NOTIFY reload fixes it.
--
-- Apply this whole file in the Supabase SQL editor.
-- =====================================================================

-- ---------- (0) Reload PostgREST schema cache (fixes gifts.post_id) ----
notify pgrst, 'reload schema';

-- ---------- (1) Investment submit / approve / reject use jagx_coins ----
create or replace function public.submit_investment_application(
  _project_id uuid,
  _amount_jagx numeric,
  _full_name text, _gov_id text, _email text, _phone text,
  _address text, _country text, _signature_data_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_shares bigint;
  v_equity numeric;
  v_equity_per_share numeric;
  v_balance int;
  v_app_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into p from public.investment_projects
    where id = _project_id and status='open' for update;
  if not found then raise exception 'Project not available'; end if;

  v_shares := floor(_amount_jagx / p.price_per_share_jagx);
  if v_shares <= 0 then raise exception 'Amount too small for one share'; end if;
  if v_shares > p.available_shares then raise exception 'Not enough shares remaining'; end if;
  v_equity_per_share := p.equity_total_pct / nullif(p.total_shares,0);
  v_equity := (v_shares::numeric / p.total_shares::numeric) * p.equity_total_pct;

  select coalesce(jagx_coins,0) into v_balance
    from public.profiles where user_id = auth.uid() for update;
  if v_balance < ceil(_amount_jagx) then raise exception 'Insufficient JagX balance'; end if;

  update public.profiles
     set jagx_coins = coalesce(jagx_coins,0) - ceil(_amount_jagx)::int
   where user_id = auth.uid();

  insert into public.investment_applications
    (user_id, project_id, amount_jagx, shares, equity_pct,
     price_snapshot_jagx, equity_per_share_snapshot, project_name_snapshot,
     full_name, gov_id, email, phone, address, country, signature_data_url)
  values (auth.uid(), _project_id, _amount_jagx, v_shares, v_equity,
          p.price_per_share_jagx, v_equity_per_share, p.name,
          _full_name, _gov_id, _email, _phone, _address, _country, _signature_data_url)
  returning id into v_app_id;

  insert into public.investment_ledger
    (application_id, user_id, project_id, amount_jagx, direction, reason)
  values (v_app_id, auth.uid(), _project_id, _amount_jagx, 'debit', 'escrow_submit');

  insert into public.notifications (user_id, from_user_id, type, content)
  values (auth.uid(), auth.uid(), 'general',
          'Investment application submitted for '||p.name
          ||' at '||p.price_per_share_jagx||' JagX/share — awaiting admin review.');

  return v_app_id;
end; $$;

grant execute on function public.submit_investment_application(
  uuid, numeric, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.reject_investment_application(_app_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admin only'; end if;
  select * into a from public.investment_applications
    where id=_app_id and status='pending' for update;
  if not found then raise exception 'Not found or already processed'; end if;

  update public.profiles
     set jagx_coins = coalesce(jagx_coins,0) + ceil(a.amount_jagx)::int
   where user_id = a.user_id;

  insert into public.investment_ledger
    (application_id, user_id, project_id, amount_jagx, direction, reason)
  values (_app_id, a.user_id, a.project_id, a.amount_jagx, 'credit', 'refund_reject');

  update public.investment_applications
    set status='rejected', admin_note=_reason, reviewed_by=auth.uid(), reviewed_at=now()
    where id=_app_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (a.user_id, auth.uid(), 'general',
          'Your investment application was rejected: '||coalesce(_reason,'(no reason)')||'. JagX refunded.');
end; $$;
grant execute on function public.reject_investment_application(uuid, text) to authenticated;

-- ---------- (2) Coin-purchase approve / reject use jagx_coins ----------
create or replace function public.approve_coin_purchase(_tx_id uuid, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admin only'; end if;
  select * into r from public.coin_transactions
    where id=_tx_id and transaction_type='purchase' and status='pending'
    for update;
  if not found then raise exception 'Purchase not found or already processed'; end if;

  update public.profiles
     set jagx_coins = coalesce(jagx_coins,0) + r.amount
   where user_id = r.user_id;

  update public.coin_transactions
     set status='approved',
         opay_reference = coalesce(opay_reference,'') || coalesce(' | '||_note,'')
   where id=_tx_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (r.user_id, auth.uid(), 'coin_tip',
          'Your purchase of '||r.amount||' JagX has been approved and credited.');
end; $$;

create or replace function public.reject_coin_purchase(_tx_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admin only'; end if;
  select * into r from public.coin_transactions
    where id=_tx_id and transaction_type='purchase' and status='pending' for update;
  if not found then raise exception 'Purchase not found or already processed'; end if;

  update public.coin_transactions
     set status='rejected',
         opay_reference = coalesce(opay_reference,'') || coalesce(' | rejected: '||_reason,'')
   where id=_tx_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (r.user_id, auth.uid(), 'general',
          'Your coin purchase of '||r.amount||' JagX was rejected'
          || coalesce(': '||_reason,'')||'.');
end; $$;

grant execute on function public.approve_coin_purchase(uuid, text) to authenticated;
grant execute on function public.reject_coin_purchase(uuid, text)  to authenticated;

-- ---------- (3) Instant JagX -> verification uses jagx_coins ----------
create or replace function public.redeem_verification_with_jagx(_cost int default 1000)
returns void language plpgsql security definer set search_path = public as $$
declare v_bal int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _cost <= 0 then raise exception 'Invalid cost'; end if;
  select coalesce(jagx_coins,0) into v_bal
    from public.profiles where user_id = auth.uid() for update;
  if v_bal < _cost then raise exception 'Insufficient JagX balance'; end if;

  update public.profiles
     set jagx_coins = coalesce(jagx_coins,0) - _cost,
         is_verified = true
   where user_id = auth.uid();

  insert into public.coin_transactions (user_id, amount, transaction_type, status, opay_reference)
  values (auth.uid(), _cost, 'verification_purchase', 'approved', 'jagx-instant');

  insert into public.notifications (user_id, from_user_id, type, content)
  values (auth.uid(), auth.uid(), 'general',
          'You are now verified. '||_cost||' JagX redeemed instantly.');
end; $$;

grant execute on function public.redeem_verification_with_jagx(int) to authenticated;

-- Reload one more time after all function updates
notify pgrst, 'reload schema';