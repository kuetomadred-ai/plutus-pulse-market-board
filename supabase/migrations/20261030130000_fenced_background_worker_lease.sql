-- Fenced leases prevent an expired worker from releasing a newer worker's lease.
-- Apply after 20261026190000_background_engine_worker.sql.

alter table public.pf_engine_worker_runs
  add column if not exists lease_id uuid;

-- The return type changes from boolean to uuid, so the old signature must be dropped first.
drop function if exists public.pf_engine_worker_claim(text, integer);
drop function if exists public.pf_engine_worker_release(text, text, integer, text);

create or replace function public.pf_engine_worker_claim(
  p_worker_name text,
  p_lease_seconds integer default 55
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed integer;
  v_lease_id uuid := gen_random_uuid();
begin
  if p_worker_name is null or p_worker_name <> 'engine-tick'
     or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'Invalid worker claim';
  end if;

  update public.pf_engine_worker_runs
  set lease_id = v_lease_id,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      last_started_at = now(),
      last_status = 'running',
      last_error = null,
      updated_at = now()
  where worker_name = p_worker_name
    and (locked_until is null or locked_until < now());

  get diagnostics changed = row_count;
  if changed <> 1 then
    return null;
  end if;
  return v_lease_id;
end;
$$;

create or replace function public.pf_engine_worker_release(
  p_worker_name text,
  p_lease_id uuid,
  p_status text,
  p_processed integer default 0,
  p_error text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  changed integer;
begin
  if p_worker_name is null or p_worker_name <> 'engine-tick'
     or p_lease_id is null or p_status not in ('ok','error')
     or p_processed < 0 then
    raise exception using errcode = '22023', message = 'Invalid worker release';
  end if;

  update public.pf_engine_worker_runs
  set locked_until = null,
      lease_id = null,
      last_finished_at = now(),
      last_status = p_status,
      last_processed = p_processed,
      last_error = left(p_error, 1000),
      updated_at = now()
  where worker_name = p_worker_name
    and lease_id = p_lease_id;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.pf_engine_worker_claim(text, integer) from public, anon, authenticated;
revoke all on function public.pf_engine_worker_release(text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.pf_engine_worker_claim(text, integer) to service_role;
grant execute on function public.pf_engine_worker_release(text, uuid, text, integer, text) to service_role;
