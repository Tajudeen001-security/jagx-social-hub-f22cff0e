-- JagX / JRILICENSE investment marketplace.

-- 'investor' role
do $$ begin
  if not exists (select 1 from pg_type where typname='app_role') then
    create type public.app_role as enum ('admin','moderator','user','investor');
  else
    begin alter type public.app_role add value if not exists 'investor'; exception when others then null; end;
  end if;
end $$;

create table if not exists public.investment_projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  cover_url text,
  equity_total_pct numeric(6,3) not null,         -- e.g. 100
  equity_available_pct numeric(6,3) not null,     -- e.g. 10 / 5 / 1
  total_shares bigint not null,                   -- e.g. 100000
  available_shares bigint not null,
  price_per_share_jagx numeric(18,4) not null,    -- in JagX coins
  suggested_price_jagx numeric(18,4),
  status text not null default 'open',            -- open | closed
  created_at timestamptz not null default now()
);
grant select on public.investment_projects to anon, authenticated;
grant all on public.investment_projects to service_role;
alter table public.investment_projects enable row level security;
drop policy if exists "invest_projects_read" on public.investment_projects;
create policy "invest_projects_read" on public.investment_projects
  for select to anon, authenticated using (true);
drop policy if exists "invest_projects_admin_write" on public.investment_projects;
create policy "invest_projects_admin_write" on public.investment_projects
  for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table if not exists public.investment_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.investment_projects(id) on delete cascade,
  amount_jagx numeric(18,4) not null,
  shares bigint not null,
  equity_pct numeric(8,5) not null,
  full_name text not null,
  gov_id text not null,
  email text not null,
  phone text not null,
  address text not null,
  country text not null,
  signature_data_url text not null,
  status text not null default 'pending',          -- pending | approved | rejected
  admin_note text,
  certificate_url text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invest_apps_user_idx    on public.investment_applications(user_id);
create index if not exists invest_apps_project_idx on public.investment_applications(project_id);
create index if not exists invest_apps_status_idx  on public.investment_applications(status);

grant select, insert on public.investment_applications to authenticated;
grant all on public.investment_applications to service_role;
alter table public.investment_applications enable row level security;

drop policy if exists "invest_apps_owner_read" on public.investment_applications;
create policy "invest_apps_owner_read" on public.investment_applications
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

drop policy if exists "invest_apps_owner_insert" on public.investment_applications;
create policy "invest_apps_owner_insert" on public.investment_applications
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "invest_apps_admin_update" on public.investment_applications;
create policy "invest_apps_admin_update" on public.investment_applications
  for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- escrow ledger
create table if not exists public.investment_ledger (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.investment_applications(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  project_id uuid references public.investment_projects(id),
  amount_jagx numeric(18,4) not null,
  direction text not null check (direction in ('debit','credit')),
  reason text,
  created_at timestamptz not null default now()
);
grant select, insert on public.investment_ledger to authenticated;
grant all on public.investment_ledger to service_role;
alter table public.investment_ledger enable row level security;
drop policy if exists "invest_ledger_owner_read" on public.investment_ledger;
create policy "invest_ledger_owner_read" on public.investment_ledger
  for select to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- ===== RPCs =====

-- Submit application: validates shares, escrows JagX from buyer wallet.
create or replace function public.submit_investment_application(
  _project_id uuid,
  _amount_jagx numeric,
  _full_name text, _gov_id text, _email text, _phone text,
  _address text, _country text, _signature_data_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare p record; v_shares bigint; v_equity numeric; v_balance int; v_app_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into p from public.investment_projects where id = _project_id and status='open' for update;
  if not found then raise exception 'Project not available'; end if;

  v_shares := floor(_amount_jagx / p.price_per_share_jagx);
  if v_shares <= 0 then raise exception 'Amount too small for one share'; end if;
  if v_shares > p.available_shares then raise exception 'Not enough shares remaining'; end if;
  v_equity := (v_shares::numeric / p.total_shares::numeric) * p.equity_total_pct;

  select coin_balance into v_balance from public.profiles where user_id = auth.uid() for update;
  if v_balance < ceil(_amount_jagx) then raise exception 'Insufficient JagX balance'; end if;

  -- escrow: debit wallet
  update public.profiles set coin_balance = coin_balance - ceil(_amount_jagx)::int
    where user_id = auth.uid();

  insert into public.investment_applications
    (user_id, project_id, amount_jagx, shares, equity_pct,
     full_name, gov_id, email, phone, address, country, signature_data_url)
  values (auth.uid(), _project_id, _amount_jagx, v_shares, v_equity,
          _full_name, _gov_id, _email, _phone, _address, _country, _signature_data_url)
  returning id into v_app_id;

  insert into public.investment_ledger (application_id, user_id, project_id, amount_jagx, direction, reason)
  values (v_app_id, auth.uid(), _project_id, _amount_jagx, 'debit', 'escrow_submit');

  insert into public.notifications (user_id, from_user_id, type, content)
  values (auth.uid(), auth.uid(), 'general',
          'Investment application submitted for '||p.name||' — awaiting admin review.');

  return v_app_id;
end; $$;

grant execute on function public.submit_investment_application(uuid, numeric, text, text, text, text, text, text, text) to authenticated;

-- Approve: decrement shares, promote user, notify with certificate URL.
create or replace function public.approve_investment_application(_app_id uuid, _certificate_url text, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record; p record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admin only'; end if;
  select * into a from public.investment_applications where id=_app_id and status='pending' for update;
  if not found then raise exception 'Application not found or already processed'; end if;
  select * into p from public.investment_projects where id=a.project_id for update;
  if a.shares > p.available_shares then raise exception 'Shares no longer available'; end if;

  update public.investment_projects
    set available_shares = available_shares - a.shares
    where id = p.id;

  update public.investment_applications
    set status='approved', certificate_url=_certificate_url,
        admin_note=_note, reviewed_by=auth.uid(), reviewed_at=now()
    where id=_app_id;

  -- promote user to investor role
  insert into public.user_roles (user_id, role) values (a.user_id, 'investor')
    on conflict (user_id, role) do nothing;

  insert into public.notifications (user_id, from_user_id, type, content, related_post_id)
  values (a.user_id, auth.uid(), 'general',
          'Your investment in '||p.name||' was approved. '||a.shares||' shares ('||round(a.equity_pct,4)||'%). Certificate ready.',
          null);
end; $$;
grant execute on function public.approve_investment_application(uuid, text, text) to authenticated;

create or replace function public.reject_investment_application(_app_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Admin only'; end if;
  select * into a from public.investment_applications where id=_app_id and status='pending' for update;
  if not found then raise exception 'Not found or already processed'; end if;

  -- refund escrow
  update public.profiles set coin_balance = coin_balance + ceil(a.amount_jagx)::int
    where user_id = a.user_id;
  insert into public.investment_ledger (application_id, user_id, project_id, amount_jagx, direction, reason)
  values (_app_id, a.user_id, a.project_id, a.amount_jagx, 'credit', 'refund_reject');

  update public.investment_applications
    set status='rejected', admin_note=_reason, reviewed_by=auth.uid(), reviewed_at=now()
    where id=_app_id;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (a.user_id, auth.uid(), 'general',
          'Your investment application was rejected: '||coalesce(_reason,'(no reason)')||'. JagX refunded.');
end; $$;
grant execute on function public.reject_investment_application(uuid, text) to authenticated;

-- ===== Seed defaults =====
insert into public.investment_projects (slug, name, description, equity_total_pct, equity_available_pct, total_shares, available_shares, price_per_share_jagx, suggested_price_jagx)
values
  ('jagx-connect','JagX Connect','The flagship social platform. 10% equity open to early investors.', 100, 10, 100000, 10000, 100, 100),
  ('jagx-ai-agent','JagX AI Agent','Autonomous AI assistant suite. 5% equity open.',                  100,  5, 100000,  5000, 250, 250),
  ('jagx-ai','JagX AI','Core AI research arm. Strictly 1% equity available.',                          100,  1, 100000,  1000, 500, 500)
on conflict (slug) do nothing;

-- Storage bucket for certificate PDFs (must also be created in dashboard if not via SQL).
insert into storage.buckets (id, name, public) values ('investment-certs','investment-certs', true)
on conflict (id) do nothing;