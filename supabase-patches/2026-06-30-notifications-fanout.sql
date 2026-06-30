-- =========================================================
-- Universal push notification fan-out.
-- After: a row in public.notifications fires HTTP call to
-- the dispatch-push edge function (via pg_net), which looks
-- up push_tokens and sends FCM v1.
-- Also adds triggers that *insert* notification rows for
-- direct messages and new posts from followed creators.
-- Apply in the Supabase SQL editor.
-- =========================================================

create extension if not exists pg_net;

-- Set these once in the SQL editor (replace with your own):
--   alter database postgres set app.dispatch_push_url     = 'https://<PROJECT>.functions.supabase.co/dispatch-push';
--   alter database postgres set app.dispatch_push_secret  = '<shared secret>';

create or replace function public.dispatch_push_for_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url   text := current_setting('app.dispatch_push_url', true);
  v_token text := current_setting('app.dispatch_push_secret', true);
begin
  if v_url is null or v_url = '' then return new; end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', coalesce(v_token, '')
    ),
    body    := jsonb_build_object(
      'notification_id', new.id,
      'user_id', new.user_id,
      'type', new.type,
      'content', new.content,
      'related_post_id', new.related_post_id,
      'from_user_id', new.from_user_id
    )
  );
  return new;
exception when others then
  -- never block insert if pg_net is misconfigured
  return new;
end; $$;

drop trigger if exists on_notification_insert_push on public.notifications;
create trigger on_notification_insert_push
  after insert on public.notifications
  for each row execute function public.dispatch_push_for_notification();

-- ----- Direct message → notify recipient -----
create or replace function public.notify_on_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  if new.recipient_id is null or new.recipient_id = new.sender_id then
    return new;
  end if;
  select username into v_username from public.profiles where user_id = new.sender_id;
  insert into public.notifications (user_id, from_user_id, type, content)
  values (new.recipient_id, new.sender_id, 'message',
          coalesce('@'||v_username||' sent you a message', 'New message'));
  return new;
end; $$;

do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='messages') then
    drop trigger if exists on_message_insert_notify on public.messages;
    create trigger on_message_insert_notify
      after insert on public.messages
      for each row execute function public.notify_on_direct_message();
  end if;
end $$;

-- ----- New post → notify each follower -----
create or replace function public.notify_followers_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  select username into v_username from public.profiles where user_id = new.user_id;
  insert into public.notifications (user_id, from_user_id, type, content, related_post_id)
  select f.follower_id, new.user_id, 'new_post',
         coalesce('@'||v_username||' shared a new post', 'New post'),
         new.id
  from public.followers f
  where f.following_id = new.user_id
    and f.follower_id <> new.user_id;
  return new;
end; $$;

drop trigger if exists on_post_insert_notify_followers on public.posts;
create trigger on_post_insert_notify_followers
  after insert on public.posts
  for each row execute function public.notify_followers_on_post();