-- Supabase pg_cron supports 1-59 second schedules on supported Postgres versions.
-- The database-side guard avoids issuing another HTTP request while a lease is active.

select cron.schedule(
  'plutus-engine-every-minute',
  '1 second',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'engine_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where not exists (
    select 1
    from public.pf_engine_worker_runs
    where worker_name = 'engine-tick'
      and locked_until > now()
  );
  $$
);
