-- Server-side simulated trading engine (paper only; never routes to a broker).
-- Apply only after review in staging. No live project was modified by this task.
create table if not exists public.pf_engine_instruments (
  symbol text primary key check (symbol ~ '^[A-Z0-9_]{2,20}$'),
  tick_size numeric(24,12) not null check (tick_size > 0),
  tick_value numeric(24,12) not null check (tick_value > 0),
  contract_size numeric(24,8) not null default 1 check (contract_size > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.pf_engine_accounts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  initial_balance numeric(18,2) not null check (initial_balance > 0),
  balance numeric(18,2) not null check (balance >= 0),
  leverage numeric(10,2) not null default 100 check (leverage > 0),
  max_margin_pct numeric(6,2) not null default 100 check (max_margin_pct between 1 and 100),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','LOCKED','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pf_engine_accounts_user_idx on public.pf_engine_accounts(user_id);
create table if not exists public.pf_engine_quotes (
  symbol text primary key references public.pf_engine_instruments(symbol),
  bid numeric(24,12) not null check (bid > 0),
  ask numeric(24,12) not null check (ask >= bid),
  quote_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table if not exists public.pf_engine_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  symbol text not null references public.pf_engine_instruments(symbol),
  side text not null check (side in ('buy','sell')),
  order_type text not null check (order_type in ('MARKET','LIMIT','STOP')),
  lots numeric(10,2) not null check (lots between 0.01 and 100),
  trigger_price numeric(24,12),
  stop_loss numeric(24,12),
  take_profit numeric(24,12),
  status text not null default 'PENDING' check (status in ('PENDING','FILLED','CANCELLED','REJECTED')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pf_engine_orders_pending_idx on public.pf_engine_orders(symbol,created_at) where status='PENDING';
create table if not exists public.pf_engine_positions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.pf_engine_orders(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete restrict,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  symbol text not null references public.pf_engine_instruments(symbol),
  side text not null check (side in ('buy','sell')),
  lots numeric(10,2) not null check (lots between 0.01 and 100),
  entry_price numeric(24,12) not null check (entry_price > 0),
  stop_loss numeric(24,12),
  take_profit numeric(24,12),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric(24,12),
  realized_pnl numeric(18,2),
  close_reason text
);
create index if not exists pf_engine_positions_open_idx on public.pf_engine_positions(symbol,opened_at) where status='OPEN';
create index if not exists pf_engine_positions_owner_idx on public.pf_engine_positions(user_id,account_id);
create table if not exists public.pf_engine_ledger (
  id bigint generated always as identity primary key,
  request_id uuid unique,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  position_id uuid references public.pf_engine_positions(id) on delete set null,
  event text not null check (event in ('POSITION_CLOSED','POSITION_PARTIAL_CLOSE','ENGINE_ADJUSTMENT')),
  amount numeric(18,2) not null,
  balance_after numeric(18,2) not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pf_engine_ledger_account_idx on public.pf_engine_ledger(account_id,created_at desc);
create table if not exists public.pf_engine_trades_history (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.pf_engine_positions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete restrict,
  account_id text not null references public.pf_engine_accounts(id) on delete restrict,
  symbol text not null references public.pf_engine_instruments(symbol),
  side text not null check (side in ('buy','sell')),
  lots numeric(10,2) not null check (lots between 0.01 and 100),
  entry_price numeric(24,12) not null check (entry_price > 0),
  exit_price numeric(24,12) not null check (exit_price > 0),
  realized_pnl numeric(18,2) not null,
  close_reason text not null check (close_reason in ('MANUAL','SL','TP','PARTIAL')),
  opened_at timestamptz not null,
  closed_at timestamptz not null default now()
);
create index if not exists pf_engine_trades_history_owner_idx
  on public.pf_engine_trades_history(user_id,closed_at desc);
create index if not exists pf_engine_trades_history_account_idx
  on public.pf_engine_trades_history(account_id,closed_at desc);

-- Users can read only their engine data; all writes go through trusted service RPCs.
do $$ declare t text; begin
  foreach t in array array['pf_engine_instruments','pf_engine_accounts','pf_engine_quotes','pf_engine_orders','pf_engine_positions','pf_engine_ledger','pf_engine_trades_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end $$;
grant select on public.pf_engine_accounts,public.pf_engine_orders,public.pf_engine_positions,public.pf_engine_ledger,public.pf_engine_trades_history to authenticated;
create policy pf_engine_account_owner_read on public.pf_engine_accounts for select to authenticated using (user_id=(select auth.uid()));
create policy pf_engine_order_owner_read on public.pf_engine_orders for select to authenticated using (user_id=(select auth.uid()));
create policy pf_engine_position_owner_read on public.pf_engine_positions for select to authenticated using (user_id=(select auth.uid()));
create policy pf_engine_ledger_owner_read on public.pf_engine_ledger for select to authenticated using (user_id=(select auth.uid()));
create policy pf_engine_history_owner_read on public.pf_engine_trades_history for select to authenticated using (user_id=(select auth.uid()));

-- Trusted service-role only. Callers must authenticate at the API and pass the verified auth.users id.
create or replace function public.pf_engine_place_order(
  p_user_id uuid, p_account_id text, p_request_id uuid, p_symbol text,
  p_side text, p_order_type text, p_lots numeric, p_trigger numeric default null,
  p_sl numeric default null, p_tp numeric default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; v_price numeric; v_ref numeric; v_margin numeric; v_used numeric; v_order public.pf_engine_orders; v_pos public.pf_engine_positions;
begin
 if p_user_id is null or p_request_id is null then raise exception using errcode='28000',message='Verified identity and idempotency key required'; end if;
 select * into v_order from public.pf_engine_orders where request_id=p_request_id;
 if found then if v_order.user_id<>p_user_id then raise exception using errcode='42501',message='Request key belongs to another user'; end if; return jsonb_build_object('order',to_jsonb(v_order),'duplicate',true); end if;
 if p_side not in ('buy','sell') or p_order_type not in ('MARKET','LIMIT','STOP') or p_lots is null or p_lots<0.01 or p_lots>100 or p_lots<>round(p_lots,2) then raise exception using errcode='22023',message='Invalid order parameters'; end if;
 if p_order_type<>'MARKET' and coalesce(p_trigger,0)<=0 then raise exception using errcode='22023',message='Trigger price required'; end if;
 select * into a from public.pf_engine_accounts where id=p_account_id and user_id=p_user_id for update;
 if not found or a.status<>'ACTIVE' then raise exception using errcode='42501',message='Active account not found'; end if;
 select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled;
 if not found then raise exception using errcode='22023',message='Instrument unavailable'; end if;
 select * into q from public.pf_engine_quotes where symbol=p_symbol and received_at>now()-interval '15 seconds';
 if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 v_price:=case when p_side='buy' then q.ask else q.bid end;
 v_ref:=case when p_order_type='MARKET' then v_price else p_trigger end;
 if p_order_type='LIMIT' and ((p_side='buy' and p_trigger>=q.ask) or (p_side='sell' and p_trigger<=q.bid)) then raise exception using errcode='22023',message='Invalid limit trigger side'; end if;
 if p_order_type='STOP' and ((p_side='buy' and p_trigger<=q.ask) or (p_side='sell' and p_trigger>=q.bid)) then raise exception using errcode='22023',message='Invalid stop trigger side'; end if;
 if p_sl is not null and ((p_side='buy' and p_sl>=v_ref) or (p_side='sell' and p_sl<=v_ref)) then raise exception using errcode='22023',message='Stop loss on invalid side'; end if;
 if p_tp is not null and ((p_side='buy' and p_tp<=v_ref) or (p_side='sell' and p_tp>=v_ref)) then raise exception using errcode='22023',message='Take profit on invalid side'; end if;
 insert into public.pf_engine_orders(request_id,user_id,account_id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status)
 values(p_request_id,p_user_id,p_account_id,p_symbol,p_side,p_order_type,p_lots,case when p_order_type='MARKET' then null else p_trigger end,p_sl,p_tp,case when p_order_type='MARKET' then 'FILLED' else 'PENDING' end) returning * into v_order;
 if p_order_type='MARKET' then
   v_margin:=p_lots*i.contract_size*v_price/a.leverage;
   select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.ask else q2.bid end/a.leverage),0) into v_used
   from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol
   where x.account_id=p_account_id and x.status='OPEN';
   if v_margin+v_used>a.balance*(a.max_margin_pct/100) then raise exception using errcode='P0001',message='Insufficient margin'; end if;
   insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit)
   values(v_order.id,p_user_id,p_account_id,p_symbol,p_side,p_lots,v_price,p_sl,p_tp) returning * into v_pos;
 end if;
 return jsonb_build_object('order',to_jsonb(v_order),'position',case when v_pos.id is null then null else to_jsonb(v_pos) end,'fill_price',case when p_order_type='MARKET' then v_price else null end,'quote_at',q.quote_at);
end $$;
create or replace function public.pf_engine_close_position(p_user_id uuid,p_position_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.pf_engine_positions; a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; px numeric; pnl numeric;
begin
 select * into p from public.pf_engine_positions where id=p_position_id and user_id=p_user_id for update;
 if not found then raise exception using errcode='P0002',message='Position not found'; end if;
 if p.status='CLOSED' then return jsonb_build_object('position',to_jsonb(p),'duplicate',true); end if;
 if p.opened_at>now()-interval '1 minute' then raise exception using errcode='55000',message='Minimum hold period has not elapsed'; end if;
 select * into a from public.pf_engine_accounts where id=p.account_id for update;
 select * into i from public.pf_engine_instruments where symbol=p.symbol and enabled;
 select * into q from public.pf_engine_quotes where symbol=p.symbol and received_at>now()-interval '15 seconds';
 if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 px:=case when p.side='buy' then q.bid else q.ask end;
 pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
 update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason='MANUAL' where id=p.id returning * into p;
 update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=a.id returning * into a;
 insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at)
 values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,p.exit_price,p.realized_pnl,p.close_reason,p.opened_at,p.closed_at);
 insert into public.pf_engine_ledger(request_id,account_id,user_id,position_id,event,amount,balance_after,details) values(p_request_id,a.id,p_user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'symbol',p.symbol,'lots',p.lots,'side',p.side,'entry',p.entry_price));
 return jsonb_build_object('position',to_jsonb(p),'account',jsonb_build_object('id',a.id,'balance',a.balance),'pnl',pnl,'price',px);
end $$;

-- Tick handler, called only by the trusted quote worker. SL/TP and pending order fills
-- are serialized by row locks and committed together with account/ledger changes.
create or replace function public.pf_engine_process_tick(p_symbol text,p_bid numeric,p_ask numeric,p_quote_at timestamptz)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare i public.pf_engine_instruments; p public.pf_engine_positions; o public.pf_engine_orders; a public.pf_engine_accounts; px numeric; pnl numeric; v_margin numeric; v_used numeric; n integer:=0;
begin
 if p_bid<=0 or p_ask<p_bid or p_quote_at>now()+interval '5 seconds' or p_quote_at<now()-interval '30 seconds' then raise exception using errcode='22023',message='Invalid or stale tick'; end if;
 select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled; if not found then return 0; end if;
 if exists(select 1 from public.pf_engine_quotes where symbol=p_symbol and quote_at>p_quote_at) then return 0; end if;
 insert into public.pf_engine_quotes(symbol,bid,ask,quote_at,received_at) values(p_symbol,p_bid,p_ask,p_quote_at,now())
 on conflict(symbol) do update set bid=excluded.bid,ask=excluded.ask,quote_at=excluded.quote_at,received_at=now()
 where excluded.quote_at>=public.pf_engine_quotes.quote_at;
 for p in select * from public.pf_engine_positions where symbol=p_symbol and status='OPEN' for update loop
   px:=case when p.side='buy' then p_bid else p_ask end;
   if (p.stop_loss is not null and ((p.side='buy' and p_bid<=p.stop_loss) or (p.side='sell' and p_ask>=p.stop_loss))) or
      (p.take_profit is not null and ((p.side='buy' and p_bid>=p.take_profit) or (p.side='sell' and p_ask<=p.take_profit))) then
     if p.stop_loss is not null and ((p.side='buy' and p_bid<=p.stop_loss) or (p.side='sell' and p_ask>=p.stop_loss)) then px:=p.stop_loss; else px:=p.take_profit; end if;
     pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
     update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason=case when px=p.stop_loss then 'SL' else 'TP' end where id=p.id;
     insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at)
     values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,case when px=p.stop_loss then 'SL' else 'TP' end,p.opened_at,now());
     update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=p.account_id returning * into a;
     insert into public.pf_engine_ledger(account_id,user_id,position_id,event,amount,balance_after,details) values(p.account_id,p.user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'reason',case when px=p.stop_loss then 'SL' else 'TP' end)); n:=n+1;
   end if;
 end loop;
 for o in select * from public.pf_engine_orders where symbol=p_symbol and status='PENDING' for update loop
   if (o.order_type='LIMIT' and ((o.side='buy' and p_ask<=o.trigger_price) or (o.side='sell' and p_bid>=o.trigger_price))) or
      (o.order_type='STOP' and ((o.side='buy' and p_ask>=o.trigger_price) or (o.side='sell' and p_bid<=o.trigger_price))) then
      select * into a from public.pf_engine_accounts where id=o.account_id for update;
      if not found or a.status<>'ACTIVE' then
        update public.pf_engine_orders set status='REJECTED',reason='Account is not active',updated_at=now() where id=o.id;
      else
        px:=case when o.side='buy' then p_ask else p_bid end;
        v_margin:=o.lots*i.contract_size*px/a.leverage;
        select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.ask else q2.bid end/a.leverage),0) into v_used
        from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol
        where x.account_id=o.account_id and x.status='OPEN';
        if v_margin+v_used<=a.balance*(a.max_margin_pct/100) then
          update public.pf_engine_orders set status='FILLED',updated_at=now() where id=o.id;
          insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit)
          values(o.id,o.user_id,o.account_id,o.symbol,o.side,o.lots,px,o.stop_loss,o.take_profit);
          n:=n+1;
        else
          update public.pf_engine_orders set status='REJECTED',reason='Insufficient margin at trigger',updated_at=now() where id=o.id;
        end if;
      end if;
   end if;
 end loop;
 return n;
end $$;
create or replace function public.pf_engine_provision_account(
  p_admin_id uuid,p_user_id uuid,p_account_id text,p_initial_balance numeric,p_leverage numeric default 100
) returns public.pf_engine_accounts language plpgsql security definer set search_path=pg_catalog as $$
declare v_role text; a public.pf_engine_accounts;
begin
 select raw_app_meta_data->>'role' into v_role from auth.users where id=p_admin_id;
 if coalesce(v_role,'')<>'ADMIN' then raise exception using errcode='42501',message='ADMIN role required'; end if;
 if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_-]{1,80}$' or p_initial_balance<=0 or p_initial_balance>10000000 or p_leverage<1 or p_leverage>1000 then
   raise exception using errcode='22023',message='Invalid account provisioning values';
 end if;
 insert into public.pf_engine_accounts(id,user_id,initial_balance,balance,leverage)
 values(p_account_id,p_user_id,p_initial_balance,p_initial_balance,p_leverage) returning * into a;
 insert into public.pf_engine_ledger(account_id,user_id,event,amount,balance_after,details)
 values(a.id,p_user_id,'ENGINE_ADJUSTMENT',p_initial_balance,a.balance,jsonb_build_object('action','PROVISIONED','by',p_admin_id));
 return a;
end $$;
revoke all on function public.pf_engine_provision_account(uuid,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.pf_engine_provision_account(uuid,uuid,text,numeric,numeric) to service_role;
revoke all on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.pf_engine_close_position(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.pf_engine_close_position(uuid,uuid,uuid) to service_role;
grant execute on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) to service_role;


create or replace function public.pf_engine_close_partial(p_user_id uuid,p_position_id uuid,p_close_lots numeric,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.pf_engine_positions; a public.pf_engine_accounts; i public.pf_engine_instruments; q public.pf_engine_quotes; prior public.pf_engine_ledger; px numeric; pnl numeric; remain numeric;
begin
 select * into prior from public.pf_engine_ledger where request_id=p_request_id;
 if found then if prior.user_id<>p_user_id then raise exception using errcode='42501',message='Request key belongs to another user'; end if; return jsonb_build_object('ledger',to_jsonb(prior),'duplicate',true); end if;
 select * into p from public.pf_engine_positions where id=p_position_id and user_id=p_user_id for update;
 if not found or p.status<>'OPEN' then raise exception using errcode='P0002',message='Open position not found'; end if;
 if p.opened_at>now()-interval '1 minute' then raise exception using errcode='55000',message='Minimum hold period has not elapsed'; end if;
 if p_close_lots is null or p_close_lots<0.01 or p_close_lots<>round(p_close_lots,2) or p_close_lots>=p.lots then raise exception using errcode='22023',message='Invalid partial close size'; end if;
 remain:=p.lots-p_close_lots;
 select * into a from public.pf_engine_accounts where id=p.account_id and user_id=p_user_id for update;
 select * into i from public.pf_engine_instruments where symbol=p.symbol and enabled;
 select * into q from public.pf_engine_quotes where symbol=p.symbol and received_at>now()-interval '15 seconds';
 if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 px:=case when p.side='buy' then q.bid else q.ask end;
 pnl:=round(((px-p.entry_price)/i.tick_size*i.tick_value*p_close_lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
 update public.pf_engine_positions set lots=remain where id=p.id;
 update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=a.id returning * into a;
 insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at)
 values(p.id,p.user_id,p.account_id,p.symbol,p.side,p_close_lots,p.entry_price,px,pnl,'PARTIAL',p.opened_at,now());
 insert into public.pf_engine_ledger(request_id,account_id,user_id,position_id,event,amount,balance_after,details)
 values(p_request_id,a.id,p_user_id,p.id,'POSITION_PARTIAL_CLOSE',pnl,a.balance,jsonb_build_object('price',px,'symbol',p.symbol,'lots',p_close_lots,'side',p.side,'entry',p.entry_price));
 return jsonb_build_object('position_id',p.id,'closed_lots',p_close_lots,'remaining_lots',remain,'pnl',pnl,'balance',a.balance,'price',px);
end $$;

create or replace function public.pf_engine_modify_position(p_user_id uuid,p_position_id uuid,p_sl numeric,p_tp numeric)
returns public.pf_engine_positions language plpgsql security definer set search_path=pg_catalog as $$
declare p public.pf_engine_positions; q public.pf_engine_quotes; ref_price numeric;
begin
 select * into p from public.pf_engine_positions where id=p_position_id and user_id=p_user_id and status='OPEN' for update;
 if not found then raise exception using errcode='P0002',message='Open position not found'; end if;
 select * into q from public.pf_engine_quotes where symbol=p.symbol and received_at>now()-interval '15 seconds';
 if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 ref_price:=case when p.side='buy' then q.bid else q.ask end;
 if p_sl is not null and ((p.side='buy' and p_sl>=ref_price) or (p.side='sell' and p_sl<=ref_price)) then raise exception using errcode='22023',message='Stop loss on invalid side'; end if;
 if p_tp is not null and ((p.side='buy' and p_tp<=ref_price) or (p.side='sell' and p_tp>=ref_price)) then raise exception using errcode='22023',message='Take profit on invalid side'; end if;
 update public.pf_engine_positions set stop_loss=p_sl,take_profit=p_tp where id=p.id returning * into p; return p;
end $$;

create or replace function public.pf_engine_cancel_order(p_user_id uuid,p_order_id uuid)
returns public.pf_engine_orders language plpgsql security definer set search_path=pg_catalog as $$
declare o public.pf_engine_orders;
begin
 select * into o from public.pf_engine_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception using errcode='P0002',message='Order not found'; end if;
 if o.status<>'PENDING' then raise exception using errcode='55000',message='Only pending orders can be cancelled'; end if;
 update public.pf_engine_orders set status='CANCELLED',updated_at=now() where id=o.id returning * into o; return o;
end $$;

create or replace function public.pf_engine_modify_order(p_user_id uuid,p_order_id uuid,p_trigger numeric,p_sl numeric,p_tp numeric)
returns public.pf_engine_orders language plpgsql security definer set search_path=pg_catalog as $$
declare o public.pf_engine_orders; q public.pf_engine_quotes; ref_price numeric;
begin
 select * into o from public.pf_engine_orders where id=p_order_id and user_id=p_user_id for update;
 if not found or o.status<>'PENDING' then raise exception using errcode='P0002',message='Pending order not found'; end if;
 if p_trigger is null or p_trigger<=0 then raise exception using errcode='22023',message='Invalid trigger price'; end if;
 select * into q from public.pf_engine_quotes where symbol=o.symbol and received_at>now()-interval '15 seconds';
 if not found then raise exception using errcode='55000',message='No fresh server quote'; end if;
 if o.order_type='LIMIT' and ((o.side='buy' and p_trigger>=q.ask) or (o.side='sell' and p_trigger<=q.bid)) then raise exception using errcode='22023',message='Invalid limit trigger side'; end if;
 if o.order_type='STOP' and ((o.side='buy' and p_trigger<=q.ask) or (o.side='sell' and p_trigger>=q.bid)) then raise exception using errcode='22023',message='Invalid stop trigger side'; end if;
 ref_price:=p_trigger;
 if p_sl is not null and ((o.side='buy' and p_sl>=ref_price) or (o.side='sell' and p_sl<=ref_price)) then raise exception using errcode='22023',message='Stop loss on invalid side'; end if;
 if p_tp is not null and ((o.side='buy' and p_tp<=ref_price) or (o.side='sell' and p_tp>=ref_price)) then raise exception using errcode='22023',message='Take profit on invalid side'; end if;
 update public.pf_engine_orders set trigger_price=p_trigger,stop_loss=p_sl,take_profit=p_tp,updated_at=now() where id=o.id returning * into o; return o;
end $$;

revoke all on function public.pf_engine_close_partial(uuid,uuid,numeric,uuid) from public,anon,authenticated;
revoke all on function public.pf_engine_modify_position(uuid,uuid,numeric,numeric) from public,anon,authenticated;
revoke all on function public.pf_engine_cancel_order(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pf_engine_modify_order(uuid,uuid,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.pf_engine_close_partial(uuid,uuid,numeric,uuid) to service_role;
grant execute on function public.pf_engine_modify_position(uuid,uuid,numeric,numeric) to service_role;
grant execute on function public.pf_engine_cancel_order(uuid,uuid) to service_role;
grant execute on function public.pf_engine_modify_order(uuid,uuid,numeric,numeric,numeric) to service_role;
