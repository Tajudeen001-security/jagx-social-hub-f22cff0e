-- Admin approval flow for JagX coin purchases.
-- coin_transactions(transaction_type='purchase', status='pending'|'approved'|'rejected')
-- already exists. Add SECURITY DEFINER RPCs so admins can credit/refund safely.

create or replace function public.approve_coin_purchase(_tx_id uuid, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Admin only';
  end if;
  select * into r from public.coin_transactions
    where id = _tx_id and transaction_type='purchase' and status='pending'
    for update;
  if not found then raise exception 'Purchase not found or already processed'; end if;

  update public.profiles set coin_balance = coin_balance + r.amount where user_id = r.user_id;
  update public.coin_transactions
    set status='approved', opay_reference = coalesce(opay_reference, '') || coalesce(' | '||_note,'')
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

  update public.coin_transactions set status='rejected',
    opay_reference = coalesce(opay_reference,'') || coalesce(' | rejected: '||_reason,'')
    where id=_tx_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (r.user_id, auth.uid(), 'general',
          'Your coin purchase of '||r.amount||' JagX was rejected'
          || coalesce(': '||_reason,'')||'.');
end; $$;

grant execute on function public.approve_coin_purchase(uuid, text) to authenticated;
grant execute on function public.reject_coin_purchase(uuid, text)  to authenticated;

-- Realtime: ensure the user's own pending purchases stream updates.
alter publication supabase_realtime add table public.coin_transactions;