-- Remove spread-bonus metadata from standard close and demo recharge paths.
create or replace function public.pf_engine_close_position(p_user_id uuid,p_position_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.pf_engine_positions; a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; px numeric; pnl numeric;
begin
 select * into p from public.pf_engine_positions where id=p_position_id and user_id=p_user_id for update; if not found then raise exception using errcode='P0002',message='Position not found'; end if;
 if p.status='CLOSED' then return jsonb_build_object('position',to_jsonb(p),'duplicate',true); end if;
 select * into a from public.pf_engine_accounts where id=p.account_id and user_id=p_user_id for update; select * into i from public.pf_engine_instruments where symbol=p.symbol and enabled; select * into q from public.pf_engine_quotes where symbol=p.symbol and received_at>now()-interval '30 seconds'; if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 px:=case when p.side='buy' then q.bid else q.ask end; pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
 update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason='MANUAL' where id=p.id returning * into p;
 update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=a.id returning * into a;
 insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at) values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,'MANUAL',p.opened_at,now());
 insert into public.pf_engine_ledger(request_id,account_id,user_id,position_id,event,amount,balance_after,details) values(p_request_id,a.id,p_user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'execution_mode','STANDARD_MT5'));
 return jsonb_build_object('position',to_jsonb(p),'account',jsonb_build_object('id',a.id,'balance',a.balance),'pnl',pnl,'price',px,'execution_mode','STANDARD_MT5');
end $$;
revoke all on function public.pf_engine_close_position(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pf_engine_close_position(uuid,uuid,uuid) to service_role;
