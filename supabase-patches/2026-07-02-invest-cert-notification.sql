-- Approval notification now embeds the certificate URL so users can tap and download.
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

  insert into public.user_roles (user_id, role) values (a.user_id, 'investor')
    on conflict (user_id, role) do nothing;

  insert into public.notifications (user_id, from_user_id, type, content)
  values (
    a.user_id, auth.uid(), 'general',
    'Your investment in '||p.name||' was approved. '||a.shares||' shares ('||round(a.equity_pct,4)||'%). Certificate: '||coalesce(_certificate_url,'')
  );
end; $$;
grant execute on function public.approve_investment_application(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';