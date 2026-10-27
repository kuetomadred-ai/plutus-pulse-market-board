-- Educational paper-engine mode only. This migration never routes orders to a broker.
-- It intentionally models the requested inverted execution and records the spread bonus
-- explicitly in the ledger so the test behavior is auditable rather than hidden.

create or replace function public.pf_engine_place_order(
  p_user_id uuid, p_account_id text, p_request_id uuid, p_symbol text,
  p_side text, p_order_type text, p_lots numeric, p_trigger numeric default null,
  p_sl numeric default null, p_tp numeric default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  a public.pf_engine_accounts;
  i public.pf_engine_instruments;
  q public.pf_engine_quotes;
  v_price numeric;
  v_margin numeric;
  v_used numeric;
  v_order public.pf_engine_orders;
  v_pos public.pf_engine_positions;
begin
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '28000', message = 'Verified identity and idempotency key required';
  end if;
  select * into v_order from public.pf_engine_orders where request_id = p_request_id;
  if found then
    if v_order.user_id <> p_user_id then
      raise exception using errcode = '42501', message = 'Request key belongs to another user';
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'duplicate', true);
  end if;
  if p_side not in ('buy','sell') or p_order_type not in ('MARKET','LIMIT','STOP')
     or p_lots is null or p_lots < 0.01 or p_lots > 100 or p_lots <> round(p_lots,2) then
    raise exception using errcode = '22023', message = 'Invalid order parameters';
  end if;
  if p_order_type <> 'MARKET' and coalesce(p_trigger,0) <= 0 then
    raise exception using errcode = '22023', message = 'Trigger price required';
  end if;
  select * into a from public.pf_engine_accounts where id = p_account_id and user_id = p_user_id for update;
  if not found or a.status <> 'ACTIVE' then
    raise exception using errcode = '42501', message = 'Active account not found';
  end if;
  select * into i from public.pf_engine_instruments where symbol = p_symbol and enabled;
  if not found then raise exception using errcode = '22023', message = 'Instrument unavailable'; end if;
  select * into q from public.pf_engine_quotes where symbol = p_symbol and received_at > now() - interval '30 seconds';
  if not found then raise exception using errcode = '55000', message = 'No fresh server quote'; end if;

  -- Educational inverted mode: buy at Bid and sell at Ask.
  v_price := case when p_side = 'buy' then q.bid else q.ask end;
  if p_order_type = 'LIMIT' and ((p_side = 'buy' and p_trigger >= q.bid) or (p_side = 'sell' and p_trigger <= q.ask)) then
    raise exception using errcode = '22023', message = 'Invalid limit trigger side';
  end if;
  if p_order_type = 'STOP' and ((p_side = 'buy' and p_trigger <= q.bid) or (p_side = 'sell' and p_trigger >= q.ask)) then
    raise exception using errcode = '22023', message = 'Invalid stop trigger side';
  end if;
  if p_sl is not null and ((p_side = 'buy' and p_sl >= v_price) or (p_side = 'sell' and p_sl <= v_price)) then
    raise exception using errcode = '22023', message = 'Stop loss on invalid side';
  end if;
  if p_tp is not null and ((p_side = 'buy' and p_tp <= v_price) or (p_side = 'sell' and p_tp >= v_price)) then
    raise exception using errcode = '22023', message = 'Take profit on invalid side';
  end if;

  insert into public.pf_engine_orders(request_id,user_id,account_id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status)
  values(p_request_id,p_user_id,p_account_id,p_symbol,p_side,p_order_type,p_lots,
         case when p_order_type = 'MARKET' then null else p_trigger end,p_sl,p_tp,
         case when p_order_type = 'MARKET' then 'FILLED' else 'PENDING' end)
  returning * into v_order;

  if p_order_type = 'MARKET' then
    v_margin := p_lots * i.contract_size * v_price / a.leverage;
    select coalesce(sum(x.lots * j.contract_size *
      case when x.side = 'buy' then q2.bid else q2.ask end / a.leverage),0)
      into v_used
      from public.pf_engine_positions x
      join public.pf_engine_instruments j on j.symbol = x.symbol
      join public.pf_engine_quotes q2 on q2.symbol = x.symbol
      where x.account_id = p_account_id and x.status = 'OPEN';
    if v_margin + v_used > a.balance * (a.max_margin_pct / 100) then
      raise exception using errcode = 'P0001', message = 'Insufficient margin';
    end if;
    insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit)
    values(v_order.id,p_user_id,p_account_id,p_symbol,p_side,p_lots,v_price,p_sl,p_tp)
    returning * into v_pos;
  end if;
  return jsonb_build_object('order',to_jsonb(v_order),
    'position',case when v_pos.id is null then null else to_jsonb(v_pos) end,
    'fill_price',case when p_order_type = 'MARKET' then v_price else null end,
    'execution_mode','INVERTED_EDUCATIONAL','quote_at',q.quote_at);
end;
$$;

create or replace function public.pf_engine_close_position(
  p_user_id uuid, p_position_id uuid, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  p public.pf_engine_positions;
  a public.pf_engine_accounts;
  i public.pf_engine_instruments;
  q public.pf_engine_quotes;
  px numeric;
  pnl numeric;
  spread_bonus numeric := 0;
begin
  select * into p from public.pf_engine_positions where id = p_position_id and user_id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Position not found'; end if;
  if p.status = 'CLOSED' then return jsonb_build_object('position',to_jsonb(p),'duplicate',true); end if;
  select * into a from public.pf_engine_accounts where id = p.account_id and user_id = p_user_id for update;
  select * into i from public.pf_engine_instruments where symbol = p.symbol and enabled;
  select * into q from public.pf_engine_quotes where symbol = p.symbol and received_at > now() - interval '30 seconds';
  if not found then raise exception using errcode = '55000', message = 'No fresh server quote'; end if;

  -- Educational inverted mode: close buy at Ask and sell at Bid.
  px := case when p.side = 'buy' then q.ask else q.bid end;
  pnl := round(((px - p.entry_price) / i.tick_size * i.tick_value * p.lots *
    case when p.side = 'buy' then 1 else -1 end)::numeric,2);
  if q.ask > q.bid then
    spread_bonus := round(((q.ask - q.bid) / i.tick_size * i.tick_value * p.lots)::numeric,2);
    pnl := pnl + spread_bonus;
  end if;

  update public.pf_engine_positions
    set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason='MANUAL'
    where id=p.id returning * into p;
  update public.pf_engine_accounts set balance=balance+pnl,updated_at=now()
    where id=a.id returning * into a;
  insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at)
    values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,'MANUAL',p.opened_at,now());
  insert into public.pf_engine_ledger(request_id,account_id,user_id,position_id,event,amount,balance_after,details)
    values(p_request_id,a.id,p_user_id,p.id,'POSITION_CLOSED',pnl,a.balance,
      jsonb_build_object('price',px,'spread_bonus',spread_bonus,'execution_mode','INVERTED_EDUCATIONAL'));
  return jsonb_build_object('position',to_jsonb(p),'account',jsonb_build_object('id',a.id,'balance',a.balance),
    'pnl',pnl,'price',px,'spread_bonus',spread_bonus,'execution_mode','INVERTED_EDUCATIONAL');
end;
$$;

create or replace function public.pf_engine_process_tick(
  p_symbol text, p_bid numeric, p_ask numeric, p_quote_at timestamptz
) returns integer
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  i public.pf_engine_instruments;
  p public.pf_engine_positions;
  o public.pf_engine_orders;
  a public.pf_engine_accounts;
  px numeric;
  pnl numeric;
  spread_bonus numeric;
  v_margin numeric;
  v_used numeric;
  reason text;
  n integer := 0;
begin
  if p_bid <= 0 or p_ask < p_bid or p_quote_at > now()+interval '5 seconds' or p_quote_at < now()-interval '30 seconds' then
    raise exception using errcode='22023',message='Invalid or stale tick';
  end if;
  select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled;
  if not found then return 0; end if;
  if exists(select 1 from public.pf_engine_quotes where symbol=p_symbol and quote_at>p_quote_at) then return 0; end if;
  insert into public.pf_engine_quotes(symbol,bid,ask,quote_at,received_at) values(p_symbol,p_bid,p_ask,p_quote_at,now())
    on conflict(symbol) do update set bid=excluded.bid,ask=excluded.ask,quote_at=excluded.quote_at,received_at=now()
    where excluded.quote_at >= public.pf_engine_quotes.quote_at;

  for p in select * from public.pf_engine_positions where symbol=p_symbol and status='OPEN' for update loop
    -- Inverted educational close price: buy at Ask, sell at Bid.
    px := case when p.side='buy' then p_ask else p_bid end;
    reason := null;
    if p.stop_loss is not null and ((p.side='buy' and p_ask<=p.stop_loss) or (p.side='sell' and p_bid>=p.stop_loss)) then
      px := p.stop_loss; reason := 'SL';
    elsif p.take_profit is not null and ((p.side='buy' and p_ask>=p.take_profit) or (p.side='sell' and p_bid<=p.take_profit)) then
      px := p.take_profit; reason := 'TP';
    end if;
    if reason is not null then
      spread_bonus := 0;
      pnl := round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*
        case when p.side='buy' then 1 else -1 end)::numeric,2);
      if p_ask > p_bid then
        spread_bonus := round(((p_ask-p_bid)/i.tick_size*i.tick_value*p.lots)::numeric,2);
        pnl := pnl + spread_bonus;
      end if;
      update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason=reason where id=p.id;
      insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at)
        values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,reason,p.opened_at,now());
      update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=p.account_id returning * into a;
      insert into public.pf_engine_ledger(account_id,user_id,position_id,event,amount,balance_after,details)
        values(p.account_id,p.user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'reason',reason,'spread_bonus',spread_bonus,'execution_mode','INVERTED_EDUCATIONAL'));
      n := n + 1;
    end if;
  end loop;

  for o in select * from public.pf_engine_orders where symbol=p_symbol and status='PENDING' for update loop
    if (o.order_type='LIMIT' and ((o.side='buy' and p_bid<=o.trigger_price) or (o.side='sell' and p_ask>=o.trigger_price))) or
       (o.order_type='STOP' and ((o.side='buy' and p_bid>=o.trigger_price) or (o.side='sell' and p_ask<=o.trigger_price))) then
      select * into a from public.pf_engine_accounts where id=o.account_id for update;
      if not found or a.status<>'ACTIVE' then
        update public.pf_engine_orders set status='REJECTED',reason='Account is not active',updated_at=now() where id=o.id;
      else
        px := case when o.side='buy' then p_bid else p_ask end;
        v_margin := o.lots*i.contract_size*px/a.leverage;
        select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.bid else q2.ask end/a.leverage),0) into v_used
          from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol
          where x.account_id=o.account_id and x.status='OPEN';
        if v_margin+v_used<=a.balance*(a.max_margin_pct/100) then
          update public.pf_engine_orders set status='FILLED',updated_at=now() where id=o.id;
          insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit)
            values(o.id,o.user_id,o.account_id,o.symbol,o.side,o.lots,px,o.stop_loss,o.take_profit);
          n := n + 1;
        else
          update public.pf_engine_orders set status='REJECTED',reason='Insufficient margin at trigger',updated_at=now() where id=o.id;
        end if;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.pf_engine_close_position(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.pf_engine_place_order(uuid,text,uuid,text,text,text,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.pf_engine_close_position(uuid,uuid,uuid) to service_role;
grant execute on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) to service_role;
