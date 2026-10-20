-- PLUTUS staged security migration — additive only.
-- Applied to the live project on 2026-10-14 after explicit user approval.
-- It does not alter pf_users_data, legacy audit policies, or current client sync.

create table if not exists public.pf_funding_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  program_code text not null check (program_code ~ '^[A-Za-z0-9_-]{2,40}$'),
  account_size numeric(14, 2) not null check (account_size > 0 and account_size <= 10000000),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewer_note text check (reviewer_note is null or length(reviewer_note) <= 1000),
  constraint pf_funding_review_state check (
    (status = 'PENDING' and reviewed_at is null and reviewed_by is null)
    or (status in ('APPROVED', 'REJECTED') and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists pf_funding_requests_user_created_idx
  on public.pf_funding_requests (user_id, created_at desc);
create index if not exists pf_funding_requests_pending_idx
  on public.pf_funding_requests (created_at asc)
  where status = 'PENDING';

alter table public.pf_funding_requests enable row level security;
revoke all on public.pf_funding_requests from anon, authenticated;
grant select on public.pf_funding_requests to authenticated;

drop policy if exists pf_funding_requests_read on public.pf_funding_requests;
create policy pf_funding_requests_read
  on public.pf_funding_requests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'role') in ('ADMIN', 'FINANCE')
  );

-- Separate trusted audit stream: clients receive no INSERT/UPDATE/DELETE privileges.
create table if not exists public.pf_security_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('FUNDING_REQUEST_CREATED', 'FUNDING_REQUEST_REVIEWED')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pf_security_audit_created_idx
  on public.pf_security_audit (created_at desc);
create index if not exists pf_security_audit_entity_idx
  on public.pf_security_audit (entity_id, created_at desc);
alter table public.pf_security_audit enable row level security;
revoke all on public.pf_security_audit from anon, authenticated;
grant select on public.pf_security_audit to authenticated;
create policy pf_security_audit_admin_read
  on public.pf_security_audit
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

create or replace function public.pf_create_funding_request(
  p_program_code text,
  p_account_size numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_request_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_program_code is null or p_program_code !~ '^[A-Za-z0-9_-]{2,40}$' then
    raise exception using errcode = '22023', message = 'Invalid funding program';
  end if;
  if p_account_size is null or p_account_size <= 0 or p_account_size > 10000000 then
    raise exception using errcode = '22023', message = 'Invalid account size';
  end if;

  insert into public.pf_funding_requests (user_id, program_code, account_size)
  values (v_user_id, p_program_code, p_account_size)
  returning id into v_request_id;

  insert into public.pf_security_audit (actor_id, action, entity_id, details)
  values (v_user_id, 'FUNDING_REQUEST_CREATED', v_request_id,
          jsonb_build_object('program_code', p_program_code, 'account_size', p_account_size));
  return v_request_id;
end;
$$;

create or replace function public.pf_review_funding_request(
  p_request_id uuid,
  p_decision text,
  p_reviewer_note text default null
)
returns public.pf_funding_requests
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_request public.pf_funding_requests;
begin
  if v_actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if coalesce(v_role, '') not in ('ADMIN', 'FINANCE') then
    raise exception using errcode = '42501', message = 'ADMIN or FINANCE role required';
  end if;
  if coalesce(p_decision, '') not in ('APPROVED', 'REJECTED') then
    raise exception using errcode = '22023', message = 'Decision must be APPROVED or REJECTED';
  end if;
  if p_reviewer_note is not null and length(p_reviewer_note) > 1000 then
    raise exception using errcode = '22023', message = 'Reviewer note is too long';
  end if;

  select * into v_request
  from public.pf_funding_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Funding request not found';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception using errcode = '55000', message = 'Funding request has already been reviewed';
  end if;

  update public.pf_funding_requests
  set status = p_decision,
      reviewed_at = now(),
      reviewed_by = v_actor_id,
      reviewer_note = nullif(btrim(p_reviewer_note), '')
  where id = p_request_id
  returning * into v_request;

  insert into public.pf_security_audit (actor_id, action, entity_id, details)
  values (v_actor_id, 'FUNDING_REQUEST_REVIEWED', p_request_id,
          jsonb_build_object('decision', p_decision, 'note', nullif(btrim(p_reviewer_note), '')));
  return v_request;
end;
$$;

revoke all on function public.pf_create_funding_request(text, numeric) from public, anon;
revoke all on function public.pf_review_funding_request(uuid, text, text) from public, anon;
grant execute on function public.pf_create_funding_request(text, numeric) to authenticated;
grant execute on function public.pf_review_funding_request(uuid, text, text) to authenticated;
