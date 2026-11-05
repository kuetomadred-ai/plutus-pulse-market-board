create or replace function public.pf_engine_evaluate_paper(p_account_id text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare a public.pf_engine_accounts; eq numeric; x record;
begin
 select * into a from public.pf_engine_accounts where id=p_account_id for update;
 if not found or a.program<>'PAPER' then return null; end if;
 eq:=public.pf_engine_equity(a.id);
 if eq > a.initial_balance-1000 then return null; end if;
 for x in select p.id,p.side,q.bid,q.ask from public.pf_engine_positions p join public.pf_engine_quotes q on q.symbol=p.symbol where p.account_id=a.id and p.status='OPEN' loop
   perform public.pf_engine_close_at(x.id,case when x.side='buy' then x.bid else x.ask end,'RULE');
 end loop;
 update public.pf_engine_orders set status='CANCELLED',reason='Demo loss limit $1000 reached',updated_at=now() where account_id=a.id and status='PENDING';
 update public.pf_engine_accounts set balance=initial_balance,day_start_balance=initial_balance,min_equity=initial_balance,status='ACTIVE',challenge_status='ACTIVE',fail_reason=null,updated_at=now() where id=a.id returning * into a;
 insert into public.pf_engine_ledger(account_id,user_id,event,amount,balance_after,details)
 values(a.id,a.user_id,'RULE_EVENT',0,a.balance,jsonb_build_object('result','DEMO_RESET','reason','LOSS_LIMIT_1000','equity',eq));
 return 'DEMO_RESET';
end $$;
revoke all on function public.pf_engine_evaluate_paper(text) from public, anon, authenticated;

create or replace function public.pf_engine_evaluate_all()
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare r record; n integer:=0;
begin
 for r in select id from public.pf_engine_accounts where status='ACTIVE' and program<>'PAPER' loop
   if public.pf_engine_evaluate_account(r.id) is not null then n:=n+1; end if;
 end loop;
 for r in select a.id from public.pf_engine_accounts a where a.program='PAPER' and exists(select 1 from public.pf_engine_positions p where p.account_id=a.id and p.status='OPEN') loop
   if public.pf_engine_evaluate_paper(r.id) is not null then n:=n+1; end if;
 end loop;
 return n;
end $$;