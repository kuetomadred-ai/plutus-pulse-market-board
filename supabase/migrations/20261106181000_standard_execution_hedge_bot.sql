-- MT5-standard paper execution and opt-in, account-scoped hedge-trap bot.
-- No broker orders are routed. The bot is inactive until explicitly enabled.

create table if not exists public.pf_engine_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  symbol text not null references public.pf_engine_instruments(symbol),
  lots numeric(10,2) not null default 1.00 check (lots between 0.01 and 100),
  step numeric(24,12) not null default 1.00 check (step > 0),
  max_positions integer not null default 10 check (max_positions between 1 and 10),
  max_loss numeric(18,2) not null default 1000 check (max_loss > 0),
  cycle_start_balance numeric(18,2) not null default 1000 check (cycle_start_balance >= 0),
  last_buy_price numeric(24,12), last_sell_price numeric(24,12),
  active boolean not null default false, last_action text,
  updated_at timestamptz not null default now(), unique(account_id, symbol)
);
alter table public.pf_engine_bots enable row level security;
revoke all on public.pf_engine_bots from anon, authenticated;
grant select on public.pf_engine_bots to authenticated;
create policy pf_engine_bots_owner_read on public.pf_engine_bots for select to authenticated using (user_id=(select auth.uid()));

create or replace function public.pf_engine_equity(p_account_id text)
returns numeric language sql security definer set search_path=pg_catalog as $$
select round((a.balance+coalesce(sum(((case when p.side='buy' then q.bid else q.ask end-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)),0))::numeric,2)
from public.pf_engine_accounts a left join public.pf_engine_positions p on p.account_id=a.id and p.status='OPEN'
left join public.pf_engine_instruments i on i.symbol=p.symbol left join public.pf_engine_quotes q on q.symbol=p.symbol
where a.id=p_account_id group by a.id,a.balance $$;

create or replace function public.pf_engine_place_order(p_user_id uuid,p_account_id text,p_request_id uuid,p_symbol text,p_side text,p_order_type text,p_lots numeric,p_trigger numeric default null,p_sl numeric default null,p_tp numeric default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; v_price numeric; v_margin numeric; v_used numeric; v_order public.pf_engine_orders; v_pos public.pf_engine_positions;
begin
 if p_user_id is null or p_request_id is null then raise exception using errcode='28000',message='Verified identity and idempotency key required'; end if;
 select * into v_order from public.pf_engine_orders where request_id=p_request_id;
 if found then if v_order.user_id<>p_user_id then raise exception using errcode='42501',message='Request key belongs to another user'; end if; return jsonb_build_object('order',to_jsonb(v_order),'duplicate',true); end if;
 if p_side not in ('buy','sell') or p_order_type not in ('MARKET','LIMIT','STOP') or p_lots is null or p_lots<0.01 or p_lots>100 or p_lots<>round(p_lots,2) then raise exception using errcode='22023',message='Invalid order parameters'; end if;
 if p_order_type<>'MARKET' and coalesce(p_trigger,0)<=0 then raise exception using errcode='22023',message='Trigger price required'; end if;
 select * into a from public.pf_engine_accounts where id=p_account_id and user_id=p_user_id for update; if not found or a.status<>'ACTIVE' then raise exception using errcode='42501',message='Active account not found'; end if;
 select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled; if not found then raise exception using errcode='22023',message='Instrument unavailable'; end if;
 select * into q from public.pf_engine_quotes where symbol=p_symbol and received_at>now()-interval '30 seconds'; if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 -- MT5 standard: buy at Ask, sell at Bid.
 v_price:=case when p_side='buy' then q.ask else q.bid end;
 if p_order_type='LIMIT' and ((p_side='buy' and p_trigger>=q.ask) or (p_side='sell' and p_trigger<=q.bid)) then raise exception using errcode='22023',message='Invalid limit trigger side'; end if;
 if p_order_type='STOP' and ((p_side='buy' and p_trigger<=q.ask) or (p_side='sell' and p_trigger>=q.bid)) then raise exception using errcode='22023',message='Invalid stop trigger side'; end if;
 if p_sl is not null and ((p_side='buy' and p_sl>=v_price) or (p_side='sell' and p_sl<=v_price)) then raise exception using errcode='22023',message='Stop loss on invalid side'; end if;
 if p_tp is not null and ((p_side='buy' and p_tp<=v_price) or (p_side='sell' and p_tp>=v_price)) then raise exception using errcode='22023',message='Take profit on invalid side'; end if;
 insert into public.pf_engine_orders(request_id,user_id,account_id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status) values(p_request_id,p_user_id,p_account_id,p_symbol,p_side,p_order_type,p_lots,case when p_order_type='MARKET' then null else p_trigger end,p_sl,p_tp,case when p_order_type='MARKET' then 'FILLED' else 'PENDING' end) returning * into v_order;
 if p_order_type='MARKET' then
  v_margin:=p_lots*i.contract_size*v_price/a.leverage;
  select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.bid else q2.ask end/a.leverage),0) into v_used from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol where x.account_id=p_account_id and x.status='OPEN';
  if v_margin+v_used>a.balance*(a.max_margin_pct/100) then raise exception using errcode='P0001',message='Insufficient margin'; end if;
  insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit) values(v_order.id,p_user_id,p_account_id,p_symbol,p_side,p_lots,v_price,p_sl,p_tp) returning * into v_pos;
 end if;
 return jsonb_build_object('order',to_jsonb(v_order),'position',case when v_pos.id is null then null else to_jsonb(v_pos) end,'fill_price',case when p_order_type='MARKET' then v_price else null end,'execution_mode','STANDARD_MT5','quote_at',q.quote_at);
end $$;

create or replace function public.pf_engine_close_position(p_user_id uuid,p_position_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.pf_engine_positions; a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; px numeric; pnl numeric;
begin
 select * into p from public.pf_engine_positions where id=p_position_id and user_id=p_user_id for update; if not found then raise exception using errcode='P0002',message='Position not found'; end if;
 if p.status='CLOSED' then return jsonb_build_object('position',to_jsonb(p),'duplicate',true); end if;
 select * into a from public.pf_engine_accounts where id=p.account_id and user_id=p_user_id for update; select * into i from public.pf_engine_instruments where symbol=p.symbol and enabled; select * into q from public.pf_engine_quotes where symbol=p.symbol and received_at>now()-interval '30 seconds'; if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 -- MT5 standard: close buy at Bid, sell at Ask; no spread bonus.
 px:=case when p.side='buy' then q.bid else q.ask end; pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
 update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason='MANUAL' where id=p.id returning * into p;
 update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=a.id returning * into a;
 insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at) values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,'MANUAL',p.opened_at,now());
 insert into public.pf_engine_ledger(request_id,account_id,user_id,position_id,event,amount,balance_after,details) values(p_request_id,a.id,p_user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'execution_mode','STANDARD_MT5'));
 return jsonb_build_object('position',to_jsonb(p),'account',jsonb_build_object('id',a.id,'balance',a.balance),'pnl',pnl,'price',px,'execution_mode','STANDARD_MT5');
end $$;

-- The existing tick handler remains the scheduler. This bot function is called
-- from it and is inert unless an explicit row has active=true.
create or replace function public.pf_engine_bot_step()
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare b record; q record; p record; v_open integer; v_equity numeric; v_loss numeric; v_res jsonb; v_price numeric; n integer:=0; v_email text;
begin
 for b in select * from public.pf_engine_bots where active order by id for update skip locked loop
  begin
   select email into v_email from auth.users where id=b.user_id;
   if coalesce(v_email,'') not like 'demo-%@demo.plutustrade.app' and not exists(select 1 from auth.users where id=b.user_id and coalesce(raw_user_meta_data->>'demo','false')='true') then update public.pf_engine_bots set active=false,last_action='DISABLED_NON_DEMO',updated_at=now() where id=b.id; continue; end if;
   select bid,ask into q from public.pf_engine_quotes where symbol=b.symbol; if not found then continue; end if;
   v_equity:=public.pf_engine_equity(b.account_id); v_loss:=b.cycle_start_balance-v_equity;
   if v_loss>=b.max_loss then
    for p in select id from public.pf_engine_positions where account_id=b.account_id and symbol=b.symbol and status='OPEN' for update loop perform public.pf_engine_close_position(b.user_id,p.id,gen_random_uuid()); n:=n+1; end loop;
    update public.pf_engine_bots set cycle_start_balance=coalesce((select balance from public.pf_engine_accounts where id=b.account_id),0),last_buy_price=null,last_sell_price=null,last_action='CYCLE_STOP_LOSS',updated_at=now() where id=b.id; continue;
   end if;
   select count(*) into v_open from public.pf_engine_positions where account_id=b.account_id and symbol=b.symbol and status='OPEN';
   if v_open=0 then
    v_res:=public.pf_engine_place_order(b.user_id,b.account_id,gen_random_uuid(),b.symbol,'buy','MARKET',b.lots,null,null,null); v_price:=(v_res->>'fill_price')::numeric;
    v_res:=public.pf_engine_place_order(b.user_id,b.account_id,gen_random_uuid(),b.symbol,'sell','MARKET',b.lots,null,null,null);
    update public.pf_engine_bots set cycle_start_balance=coalesce((select balance from public.pf_engine_accounts where id=b.account_id),b.cycle_start_balance),last_buy_price=v_price,last_sell_price=(v_res->>'fill_price')::numeric,last_action='HEDGE_INITIALIZED',updated_at=now() where id=b.id; n:=n+2; continue;
   end if;
   if v_open<b.max_positions and b.last_buy_price is not null and q.bid<=b.last_buy_price-b.step then v_res:=public.pf_engine_place_order(b.user_id,b.account_id,gen_random_uuid(),b.symbol,'buy','MARKET',b.lots,null,null,null); update public.pf_engine_bots set last_buy_price=(v_res->>'fill_price')::numeric,last_action='TRAP_BUY',updated_at=now() where id=b.id; n:=n+1; end if;
   select count(*) into v_open from public.pf_engine_positions where account_id=b.account_id and symbol=b.symbol and status='OPEN';
   if v_open<b.max_positions and b.last_sell_price is not null and q.ask>=b.last_sell_price+b.step then v_res:=public.pf_engine_place_order(b.user_id,b.account_id,gen_random_uuid(),b.symbol,'sell','MARKET',b.lots,null,null,null); update public.pf_engine_bots set last_sell_price=(v_res->>'fill_price')::numeric,last_action='TRAP_SELL',updated_at=now() where id=b.id; n:=n+1; end if;
  exception when others then update public.pf_engine_bots set last_action='ERROR: '||sqlerrm,updated_at=now() where id=b.id; end;
 end loop;
 return n;
end $$;

-- Enable the bot only through an explicit row update after the account exists.
revoke all on function public.pf_engine_equity(text) from public,anon,authenticated;
revoke all on function public.pf_engine_bot_step() from public,anon,authenticated;
revoke all on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.pf_engine_close_position(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pf_engine_equity(text) to service_role;
grant execute on function public.pf_engine_bot_step() to service_role;
grant execute on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.pf_engine_close_position(uuid,uuid,uuid) to service_role;

insert into public.pf_engine_bots(user_id,account_id,symbol,lots,step,max_positions,max_loss,cycle_start_balance,active,last_action)
select a.user_id,a.id,'XAUUSD',1.00,1.00,10,1000,a.balance,false,'WAITING_FOR_EXPLICIT_START'
from public.pf_engine_accounts a where a.id='9982430' and a.user_id='4b2eb61d-0eb9-46c3-a09c-9684e88bc54c'
on conflict(account_id,symbol) do update set user_id=excluded.user_id,lots=1.00,step=1.00,max_positions=10,max_loss=1000,active=false,last_action='WAITING_FOR_EXPLICIT_START',updated_at=now();
