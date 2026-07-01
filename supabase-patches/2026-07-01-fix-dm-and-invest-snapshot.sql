-- =========================================================
-- 2026-07-01 hot-fixes:
-- 1) Direct messages failing to send — the fan-out trigger
--    referenced new.recipient_id, but public.messages uses
--    receiver_id. The failing NEW-field lookup aborted every
--    insert. Rewrite the trigger to use receiver_id.
-- 2) Investment applications: lock the price-per-share and
--    equity-per-share at submit time so the admin-issued
--    certificate always matches what the buyer signed.
-- 3) Instant JagX -> verification badge redemption
--    (buy "coin/verification" with JagX in real time).
-- Apply in the Supabase SQL editor.
-- =========================================================

-- ---- (1) Fix direct-message notification trigger ----
drop trigger if exists on_message_insert_notify on public.messages;

create or replace function public.notify_on_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_recipient uuid := new.receiver_id;
begin
  if v_recipient is null or v_recipient = new.sender_id then
    return new;
  end if;
  select username into v_username from public.profiles where user_id = new.sender_id;
  insert into public.notifications (user_id, from_user_id, type, content)
  values (v_recipient, new.sender_id, 'message',
          coalesce('@'||v_username||' sent you a message', 'New message'));
  return new;
exception when others then
  -- never block the message insert if notifications fan-out fails
  return new;
end; $$;

create trigger on_message_insert_notify
  after insert on public.messages
  for each row execute function public.notify_on_direct_message();

-- ---- (2) Investment price snapshot ----
alter table public.investment_applications
  add column if not exists price_snapshot_jagx    numeric(18,4),
  add column if not exists equity_per_share_snapshot numeric(12,8),
  add column if not exists project_name_snapshot text;

-- Backfill any existing rows
update public.investment_applications a
   set price_snapshot_jagx = p.price_per_share_jagx,
       equity_per_share_snapshot = (p.equity_total_pct / nullif(p.total_shares,0)),
       project_name_snapshot = p.name
  from public.investment_projects p
 where a.project_id = p.id
   and a.price_snapshot_jagx is null;

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

  -- Snapshot the price at submit time — admin approval must honor this quote.
  v_shares := floor(_amount_jagx / p.price_per_share_jagx);
  if v_shares <= 0 then raise exception 'Amount too small for one share'; end if;
  if v_shares > p.available_shares then raise exception 'Not enough shares remaining'; end if;
  v_equity_per_share := p.equity_total_pct / nullif(p.total_shares,0);
  v_equity := (v_shares::numeric / p.total_shares::numeric) * p.equity_total_pct;

  select coin_balance into v_balance from public.profiles where user_id = auth.uid() for update;
  if v_balance < ceil(_amount_jagx) then raise exception 'Insufficient JagX balance'; end if;

  update public.profiles set coin_balance = coin_balance - ceil(_amount_jagx)::int
    where user_id = auth.uid();

  insert into public.investment_applications
    (user_id, project_id, amount_jagx, shares, equity_pct,
     price_snapshot_jagx, equity_per_share_snapshot, project_name_snapshot,
     full_name, gov_id, email, phone, address, country, signature_data_url)
  values (auth.uid(), _project_id, _amount_jagx, v_shares, v_equity,
          p.price_per_share_jagx, v_equity_per_share, p.name,
          _full_name, _gov_id, _email, _phone, _address, _country, _signature_data_url)
  returning id into v_app_id;

  insert into public.investment_ledger (application_id, user_id, project_id, amount_jagx, direction, reason)
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

-- ---- (3) Instant JagX redemption for verification ("buy coin with JagX") ----
create or replace function public.redeem_verification_with_jagx(_cost int default 1000)
returns void language plpgsql security definer set search_path = public as $$
declare v_bal int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _cost <= 0 then raise exception 'Invalid cost'; end if;
  select coin_balance into v_bal from public.profiles where user_id = auth.uid() for update;
  if v_bal is null or v_bal < _cost then raise exception 'Insufficient JagX balance'; end if;

  update public.profiles
     set coin_balance = coin_balance - _cost,
         is_verified  = true
   where user_id = auth.uid();

  insert into public.coin_transactions (user_id, amount, transaction_type, status, opay_reference)
  values (auth.uid(), _cost, 'verification_purchase', 'approved', 'jagx-instant');

  insert into public.notifications (user_id, from_user_id, type, content)
  values (auth.uid(), auth.uid(), 'general',
          'You are now verified. '||_cost||' JagX redeemed instantly.');
end; $$;

grant execute on function public.redeem_verification_with_jagx(int) to authenticated;