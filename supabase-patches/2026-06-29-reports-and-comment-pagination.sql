-- Reports / flagging for posts and comments.
-- Apply in your Supabase SQL editor.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post','comment')),
  target_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open', -- open | reviewed | dismissed | actioned
  created_at timestamptz not null default now()
);

create index if not exists reports_target_idx on public.reports(target_type, target_id);
create index if not exists reports_reporter_idx on public.reports(reporter_id);

grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "reports_read_own" on public.reports;
create policy "reports_read_own"
  on public.reports for select to authenticated
  using (auth.uid() = reporter_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin"
  on public.reports for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));