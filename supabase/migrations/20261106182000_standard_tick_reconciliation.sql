-- Complete the MT5-standard transition for the background tick path.
-- No spread bonus is calculated or added.

create or replace function public.pf_engine_process_tick(p_symbol text,p_bid numeric,p_ask numeric,p_quote_at timestamptz)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare i public.pf_engine_instruments; p public.pf_engine_positions; o public.pf_engine_orders; a public.pf_engine_accounts; px numeric; pnl numeric; v_margin numeric; v_used numeric; reason text; n integer:=0; demo_account public.pf_engine_accounts; recharge_result text;
begin
 if p_bid<=0 or p_ask<p_bid or p_quote_at>now()+interval '5 seconds' or p_quote_at<now()-interval '30 seconds' then raise exception using errcode='22023',message='Invalid or stale tick'; end if;
 select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled; if not found then return 0; end if;
 if exists(select 1 from public.pf_engine_quotes where symbol=p_symbol and quote_at>p_quote_at) then return 0; end if;
 insert into public.pf_engine_quotes(symbol,bid,ask,quote_at,received_at) values(p_symbol,p_bid,p_ask,p_quote_at,now()) on conflict(symbol) do update set bid=excluded.bid,ask=excluded.ask,quote_at=excluded.quote_at,received_at=now() where excluded.quote_at>=public.pf_engine_quotes.quote_at;
 for p in select * from public.pf_engine_positions where symbol=p_symbol and status='OPEN' for update loop
  px:=case when p.side='buy' then p_bid else p_ask end; reason:=null;
  if p.stop_loss is not null and ((p.side='buy' and p_bid<=p.stop_loss) or (p.side='sell' and p_ask>=p.stop_loss)) then px:=p.stop_loss;reason:='SL'; elsif p.take_profit is not null and ((p.side='buy' and p_bid>=p.take_profit) or (p.side='sell' and p_ask<=p.take_profit)) then px:=p.take_profit;reason:='TP'; end if;
  if reason is not null then
   pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
   update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason=reason where id=p.id;
   insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at) values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,reason,p.opened_at,now());
   update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=p.account_id returning * into a;
   insert into public.pf_engine_ledger(account_id,user_id,position_id,event,amount,balance_after,details) values(p.account_id,p.user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'reason',reason,'execution_mode','STANDARD_MT5')); n:=n+1;
  end if;
 end loop;
 for o in select * from public.pf_engine_orders where symbol=p_symbol and status='PENDING' for update loop
  if (o.order_type='LIMIT' and ((o.side='buy' and p_ask<=o.trigger_price) or (o.side='sell' and p_bid>=o.trigger_price))) or (o.order_type='STOP' and ((o.side='buy' and p_ask>=o.trigger_price) or (o.side='sell' and p_bid<=o.trigger_price))) then
   select * into a from public.pf_engine_accounts where id=o.account_id for update;
   if not found or a.status<>'ACTIVE' then update public.pf_engine_orders set status='REJECTED',reason='Account is not active',updated_at=now() where id=o.id;
   else
    px:=case when o.side='buy' then p_ask else p_bid end; v_margin:=o.lots*i.contract_size*px/a.leverage;
    select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.ask else q2.bid end/a.leverage),0) into v_used from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol where x.account_id=o.account_id and x.status='OPEN';
    if v_margin+v_used<=a.balance*(a.max_margin_pct/100) then update public.pf_engine_orders set status='FILLED',updated_at=now() where id=o.id; insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit) values(o.id,o.user_id,o.account_id,o.symbol,o.side,o.lots,px,o.stop_loss,o.take_profit); n:=n+1; else update public.pf_engine_orders set status='REJECTED',reason='Insufficient margin at trigger',updated_at=now() where id=o.id; end if;
   end if;
  end if;
 end loop;
 n:=n+public.pf_engine_bot_step();
 return n;
end $$;
revoke all on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) to service_role;
