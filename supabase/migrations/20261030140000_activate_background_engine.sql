-- Activate the free Supabase scheduler without storing secrets in Git.
-- Apply after the fenced worker lease migration.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.pf_engine_worker_secret()
returns text
language sql
security definer
set search_path = vault, pg_catalog
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'engine_worker_secret'
  limit 1;
$$;

revoke all on function public.pf_engine_worker_secret() from public, anon, authenticated;
grant execute on function public.pf_engine_worker_secret() to service_role;

do $$
declare
  v_id uuid;
  v_url text := 'https://jujjjvuspzfgrmeljljh.supabase.co/functions/v1/engine-worker';
begin
  select id into v_id from vault.decrypted_secrets where name = 'engine_worker_url' limit 1;
  if v_id is null then
    perform vault.create_secret(v_url, 'engine_worker_url', 'PLUTUS background engine worker URL', null);
  else
    perform vault.update_secret(v_id, v_url, 'engine_worker_url', 'PLUTUS background engine worker URL', null);
  end if;

  select id into v_id from vault.decrypted_secrets where name = 'engine_worker_secret' limit 1;
  if v_id is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'engine_worker_secret', 'PLUTUS background engine worker bearer secret', null);
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'plutus-engine-every-minute') then
    perform cron.unschedule('plutus-engine-every-minute');
  end if;
end
$$;

select cron.schedule(
  'plutus-engine-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
