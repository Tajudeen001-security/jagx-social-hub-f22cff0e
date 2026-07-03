-- ============================================================
-- 2026-07-03 — Fix public.messages RLS + seed 10 test accounts
-- Paste this file into Supabase → SQL Editor and Run.
-- ============================================================

-- 1) Enable RLS on public.messages (policies exist but RLS was off)
alter table public.messages enable row level security;

-- Recreate the standard DM policies idempotently
drop policy if exists "messages_select" on public.messages;
drop policy if exists "messages_insert" on public.messages;
drop policy if exists "messages_update" on public.messages;
drop policy if exists "messages_delete" on public.messages;

create policy "messages_select" on public.messages
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (auth.uid() = sender_id);

create policy "messages_update" on public.messages
  for update to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id)
  with check (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "messages_delete" on public.messages
  for delete to authenticated
  using (auth.uid() = sender_id);

grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;

-- Make sure realtime keeps working on messages
alter publication supabase_realtime add table public.messages;

-- 2) Seed 10 pre-created accounts (users log in normally with these creds).
--    Idempotent: skips any email that already exists.
do $$
declare
  rec record;
  new_uid uuid;
begin
  for rec in
    select * from (values
      ('j5afr5@example.com',      'BvHgDHSvu$vq'),
      ('mlgtrviif5l@example.com', 'vsrxUGXsFQg&'),
      ('odwatpj@demo.org',        'bHGp7cxYXv^0'),
      ('1di1hpqm@mail.com',       'qq9GEr%sM$vS'),
      ('vew35pg2iscx@demo.org',   'x^ivas$U5DaG'),
      ('63w6qqt30xj@mail.com',    'G59bgo%*iO6q'),
      ('7s9uypb@test.com',        'U0^ESJdlVIzc'),
      ('hiwsb5s5e@example.com',   'l1e84k1aZg^!'),
      ('ex6sc6@demo.org',         'ZseX9*q8UJbs'),
      ('tpqaf0n@example.com',     '^c%3MBq67Z^#')
    ) as t(email, pw)
  loop
    if exists (select 1 from auth.users where email = rec.email) then
      continue;
    end if;
    new_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_uid, 'authenticated', 'authenticated', rec.email,
      crypt(rec.pw, gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      '{}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), rec.email, new_uid,
      jsonb_build_object('sub', new_uid::text, 'email', rec.email, 'email_verified', true),
      'email', now(), now(), now()
    );
    -- profile row (best effort — column set matches your existing profiles table)
    begin
      insert into public.profiles (user_id, username, display_name)
      values (new_uid, split_part(rec.email, '@', 1), split_part(rec.email, '@', 1))
      on conflict (user_id) do nothing;
    exception when others then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
