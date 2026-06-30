-- Admin moderation audit log + soft-delete columns on posts & comments.

alter table public.posts    add column if not exists removed_at  timestamptz;
alter table public.posts    add column if not exists removed_by  uuid references auth.users(id);
alter table public.comments add column if not exists removed_at  timestamptz;
alter table public.comments add column if not exists removed_by  uuid references auth.users(id);

create table if not exists public.moderation_audit_log (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  admin_id  uuid not null references auth.users(id) on delete cascade,
  action    text not null,                 -- removed_post | removed_comment | dismissed | reviewed
  target_type text,
  target_id   uuid,
  previous_status text,
  new_status      text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists mod_audit_admin_idx on public.moderation_audit_log(admin_id);
create index if not exists mod_audit_report_idx on public.moderation_audit_log(report_id);

grant select, insert on public.moderation_audit_log to authenticated;
grant all on public.moderation_audit_log to service_role;
alter table public.moderation_audit_log enable row level security;

drop policy if exists "mod_audit_admin_read" on public.moderation_audit_log;
create policy "mod_audit_admin_read" on public.moderation_audit_log
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "mod_audit_admin_insert" on public.moderation_audit_log
;
create policy "mod_audit_admin_insert" on public.moderation_audit_log
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin') and auth.uid() = admin_id);

-- Allow admins to update posts/comments (soft-delete).
drop policy if exists "posts_admin_update" on public.posts;
create policy "posts_admin_update" on public.posts
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "comments_admin_update" on public.comments;
create policy "comments_admin_update" on public.comments
  for update to authenticated using (public.has_role(auth.uid(), 'admin'));