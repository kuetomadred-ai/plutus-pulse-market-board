-- Durable background worker state. The client never writes these rows.
create table if not exists public.pf_engine_worker_runs (
  worker_name text primary key,
  locked_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text not null default 'never' check (last_status in ('never','running','ok','error')),
  last_processed integer not null default 0 check (last_processed >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.pf_engine_worker_runs(worker_name)
values ('engine-tick')
on conflict (worker_name) do nothing;
alter table public.pf_engine_worker_runs enable row level security;
revoke all on public.pf_engine_worker_runs from anon, authenticated;
grant select on public.pf_engine_worker_runs to service_role;

create or replace function public.pf_engine_worker_claim(
  p_worker_name text,
  p_lease_seconds integer default 55
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare changed integer;
begin
  if p_worker_name is null or p_worker_name <> 'engine-tick' or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'Invalid worker claim';
  end if;
  update public.pf_engine_worker_runs
  set locked_until = now() + make_interval(secs => p_lease_seconds),
      last_started_at = now(), last_status = 'running', last_error = null, updated_at = now()
  where worker_name = p_worker_name
    and (locked_until is null or locked_until < now());
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.pf_engine_worker_release(
  p_worker_name text,
  p_status text,
  p_processed integer default 0,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_worker_name is null or p_worker_name <> 'engine-tick' or p_status not in ('ok','error') or p_processed < 0 then
    raise exception using errcode = '22023', message = 'Invalid worker release';
  end if;
  update public.pf_engine_worker_runs
  set locked_until = null, last_finished_at = now(), last_status = p_status,
      last_processed = p_processed, last_error = left(p_error, 1000), updated_at = now()
  where worker_name = p_worker_name;
end;
$$;
revoke all on function public.pf_engine_worker_claim(text,integer) from public, anon, authenticated;
revoke all on function public.pf_engine_worker_release(text,text,integer,text) from public, anon, authenticated;
grant execute on function public.pf_engine_worker_claim(text,integer) to service_role;
grant execute on function public.pf_engine_worker_release(text,text,integer,text) to service_role;
