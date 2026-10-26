-- Security hardening for the legacy support tables.
-- Trading truth lives only in pf_engine_* and is changed by trusted RPCs.

-- A browser session must never be able to manufacture an audit event or email.
revoke insert, update, delete, truncate on public.pf_audit_log from anon, authenticated;
revoke insert, update, delete, truncate on public.pf_email_queue from anon, authenticated;

-- Keep audit writes available to the server-side worker only when the legacy
-- function exists in an older deployment.
do $$
begin
  if to_regprocedure('public.pf_audit_insert(text,text,text,text,text,uuid)') is not null then
    execute 'revoke all on function public.pf_audit_insert(text,text,text,text,text,uuid) from public, anon, authenticated';
  end if;
end
$$;

create or replace function public.pf_audit_append(
  p_event_id text,
  p_actor text,
  p_action text,
  p_entity text,
  p_details text,
  p_user_id uuid
) returns public.pf_audit_log
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare result public.pf_audit_log;
begin
  insert into public.pf_audit_log(event_id, actor, action, entity, details, user_id)
  values (p_event_id, p_actor, p_action, p_entity, p_details, p_user_id)
  returning * into result;
  return result;
end;
$$;
revoke all on function public.pf_audit_append(text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.pf_audit_append(text,text,text,text,text,uuid) to service_role;

-- Legacy blob data is retained only for non-financial preferences. These keys are
-- removed at the database boundary so a client cannot turn the blob into trading truth.
create or replace function public.pf_sanitize_user_blob()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  new.blob := new.blob - array[
    'balance', 'equity', 'pnl', 'profit', 'loss', 'wallet', 'funds',
    'positions', 'orders', 'trades', 'account', 'accounts', 'challenge_status'
  ];
  return new;
end;
$$;
drop trigger if exists pf_users_data_sanitize_blob on public.pf_users_data;
create trigger pf_users_data_sanitize_blob
before insert or update of blob on public.pf_users_data
for each row execute function public.pf_sanitize_user_blob();
