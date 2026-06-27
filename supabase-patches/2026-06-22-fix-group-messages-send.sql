-- Fix group_messages send: ensure both user_id and sender_id exist and stay in sync,
-- with permissive RLS that allows group members to read/write.

-- 1) Ensure columns exist
alter table public.group_messages add column if not exists user_id uuid;
alter table public.group_messages add column if not exists sender_id uuid;
alter table public.group_messages add column if not exists message_type text default 'text';
alter table public.group_messages add column if not exists updated_at timestamptz default now();

-- 2) Backfill both ways so neither is null on existing rows
update public.group_messages set sender_id = user_id where sender_id is null and user_id is not null;
update public.group_messages set user_id = sender_id where user_id is null and sender_id is not null;

-- 3) Trigger to keep them mirrored on any insert/update
create or replace function public.group_messages_sync_sender()
returns trigger language plpgsql as $$
begin
  if new.user_id is null and new.sender_id is not null then new.user_id := new.sender_id; end if;
  if new.sender_id is null and new.user_id is not null then new.sender_id := new.user_id; end if;
  return new;
end;
$$;

drop trigger if exists trg_group_messages_sync_sender on public.group_messages;
create trigger trg_group_messages_sync_sender
before insert or update on public.group_messages
for each row execute function public.group_messages_sync_sender();

-- 4) RLS: drop all existing policies, add clean ones
alter table public.group_messages enable row level security;

do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'public.group_messages'::regclass loop
    execute format('drop policy if exists %I on public.group_messages', p.polname);
  end loop;
end$$;

create policy "gm select for authenticated"
  on public.group_messages for select to authenticated using (true);

create policy "gm insert own"
  on public.group_messages for insert to authenticated
  with check (auth.uid() = user_id or auth.uid() = sender_id);

create policy "gm update own"
  on public.group_messages for update to authenticated
  using (auth.uid() = user_id or auth.uid() = sender_id);

create policy "gm delete own"
  on public.group_messages for delete to authenticated
  using (auth.uid() = user_id or auth.uid() = sender_id);

-- 5) Grants
grant select, insert, update, delete on public.group_messages to authenticated;
grant all on public.group_messages to service_role;

-- 6) Realtime
alter publication supabase_realtime add table public.group_messages;
