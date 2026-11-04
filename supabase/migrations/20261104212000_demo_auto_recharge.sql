-- Automatically reset educational demo accounts after a server-side stop-out.
-- This migration is deliberately scoped to demo identities only. It does not
-- alter live/challenge accounts and does not implement martingale trading.

create or replace function public.pf_engine_evaluate_account(p_account_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  a public.pf_engine_accounts;
  p public.pf_engine_positions;
  i public.pf_engine_instruments;
  q public.pf_engine_quotes;
  u record;
  eq numeric;
  px numeric;
  pnl numeric;
  spread_bonus numeric;
  prior_balance numeric;
  closed_count integer := 0;
  remaining_open integer;
  is_demo boolean := false;
begin
  select * into a
  from public.pf_engine_accounts
  where id = p_account_id
  for update;
  if not found or a.status <> 'ACTIVE' then
    return null;
  end if;

  select email, raw_user_meta_data into u
  from auth.users
  where id = a.user_id;
  is_demo := coalesce((u.raw_user_meta_data ->> 'demo')::boolean, false)
    or coalesce(u.email, '') like 'demo-%@demo.plutustrade.app';
  if not is_demo then
    return null;
  end if;

  -- Equity uses the same educational execution sides as the tick worker:
  -- buys close at Ask and sells close at Bid.
  select a.balance + coalesce(sum(
    round(((case when p.side = 'buy' then q.ask else q.bid end - p.entry_price)
      / i.tick_size * i.tick_value * p.lots
      * case when p.side = 'buy' then 1 else -1 end)::numeric, 2)
  ), 0)
  into eq
  from public.pf_engine_positions p
  join public.pf_engine_instruments i on i.symbol = p.symbol
  left join public.pf_engine_quotes q on q.symbol = p.symbol
  where p.account_id = a.id and p.status = 'OPEN';

  if coalesce(eq, a.balance) > 0 then
    return null;
  end if;

  prior_balance := a.balance;

  -- Close every open position that has a current server quote. If a quote is
  -- missing, leave that position open and wait for a later tick; never recharge
  -- an account while positions remain open.
  for p in
    select p.*
    from public.pf_engine_positions p
    where p.account_id = a.id and p.status = 'OPEN'
    order by p.id
    for update
  loop
    select * into i from public.pf_engine_instruments where symbol = p.symbol and enabled;
    select * into q from public.pf_engine_quotes where symbol = p.symbol;
    if not found or i is null then
      continue;
    end if;

    px := case when p.side = 'buy' then q.ask else q.bid end;
    if px is null or px <= 0 then
      continue;
    end if;

    pnl := round(((px - p.entry_price) / i.tick_size * i.tick_value * p.lots
      * case when p.side = 'buy' then 1 else -1 end)::numeric, 2);
    spread_bonus := 0;
    if q.ask > q.bid then
      spread_bonus := round(((q.ask - q.bid) / i.tick_size * i.tick_value * p.lots)::numeric, 2);
      pnl := pnl + spread_bonus;
    end if;

    update public.pf_engine_positions
    set status = 'CLOSED',
        closed_at = now(),
        exit_price = px,
        realized_pnl = pnl,
        close_reason = 'MANUAL',
        risk_issue = null
    where id = p.id;

    insert into public.pf_engine_trades_history(
      position_id, user_id, account_id, symbol, side, lots,
      entry_price, exit_price, realized_pnl, close_reason, opened_at, closed_at
    ) values (
      p.id, p.user_id, p.account_id, p.symbol, p.side, p.lots,
      p.entry_price, px, pnl, 'MANUAL', p.opened_at, now()
    );

    update public.pf_engine_accounts
    set balance = balance + pnl, updated_at = now()
    where id = a.id
    returning * into a;

    insert into public.pf_engine_ledger(
      account_id, user_id, position_id, event, amount, balance_after, details
    ) values (
      a.id, a.user_id, p.id, 'POSITION_CLOSED', pnl, a.balance,
      jsonb_build_object(
        'reason', 'AUTO_RECHARGE_STOP_OUT',
        'price', px,
        'spread_bonus', spread_bonus,
        'execution_mode', 'INVERTED_EDUCATIONAL'
      )
    );
    closed_count := closed_count + 1;
  end loop;

  select count(*) into remaining_open
  from public.pf_engine_positions
  where account_id = a.id and status = 'OPEN';
  if remaining_open > 0 then
    return 'STOP_OUT_PENDING_QUOTE';
  end if;

  -- Recharge only after all positions are closed and only for demo accounts.
  update public.pf_engine_accounts
  set balance = 1000,
      initial_balance = 1000,
      leverage = 3000,
      updated_at = now()
  where id = a.id
  returning * into a;

  insert into public.pf_engine_ledger(
    account_id, user_id, event, amount, balance_after, details
  ) values (
    a.id, a.user_id, 'ENGINE_ADJUSTMENT', 1000 - prior_balance, 1000,
    jsonb_build_object(
      'result', 'AUTO_RECHARGE',
      'prior_equity', eq,
      'prior_balance', prior_balance,
      'closed_positions', closed_count,
      'leverage', 3000,
      'educational_demo', true
    )
  );

  return 'AUTO_RECHARGE';
end;
$$;

-- This function is called internally by the SECURITY DEFINER tick worker.
revoke all on function public.pf_engine_evaluate_account(text) from public, anon, authenticated;

create or replace function public.pf_engine_process_tick(
  p_symbol text,
  p_bid numeric,
  p_ask numeric,
  p_quote_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
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
  demo_account public.pf_engine_accounts;
  recharge_result text;
begin
  if p_bid <= 0 or p_ask < p_bid or p_quote_at > now()+interval '5 seconds' or p_quote_at < now()-interval '30 seconds' then
    raise exception using errcode='22023',message='Invalid or stale tick';
  end if;
  select * into i from public.pf_engine_instruments where symbol=p_symbol and enabled;
  if not found then return 0; end if;
  if exists(select 1 from public.pf_engine_quotes where symbol=p_symbol and quote_at>p_quote_at) then return 0; end if;
  insert into public.pf_engine_quotes(symbol,bid,ask,quote_at,received_at)
  values(p_symbol,p_bid,p_ask,p_quote_at,now())
  on conflict(symbol) do update set bid=excluded.bid,ask=excluded.ask,quote_at=excluded.quote_at,received_at=now()
  where excluded.quote_at >= public.pf_engine_quotes.quote_at;

  for p in select * from public.pf_engine_positions where symbol=p_symbol and status='OPEN' for update loop
    px := case when p.side='buy' then p_ask else p_bid end; reason := null;
    if p.stop_loss is not null and ((p.side='buy' and p_ask<=p.stop_loss) or (p.side='sell' and p_bid>=p.stop_loss)) then px := p.stop_loss; reason := 'SL';
    elsif p.take_profit is not null and ((p.side='buy' and p_ask>=p.take_profit) or (p.side='sell' and p_bid<=p.take_profit)) then px := p.take_profit; reason := 'TP'; end if;
    if reason is not null then
      spread_bonus := 0;
      pnl := round(((px-p.entry_price)/i.tick_size*i.tick_value*p.lots*case when p.side='buy' then 1 else -1 end)::numeric,2);
      if p_ask > p_bid then spread_bonus := round(((p_ask-p_bid)/i.tick_size*i.tick_value*p.lots)::numeric,2); pnl := pnl + spread_bonus; end if;
      update public.pf_engine_positions set status='CLOSED',closed_at=now(),exit_price=px,realized_pnl=pnl,close_reason=reason where id=p.id;
      insert into public.pf_engine_trades_history(position_id,user_id,account_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at) values(p.id,p.user_id,p.account_id,p.symbol,p.side,p.lots,p.entry_price,px,pnl,reason,p.opened_at,now());
      update public.pf_engine_accounts set balance=balance+pnl,updated_at=now() where id=p.account_id returning * into a;
      insert into public.pf_engine_ledger(account_id,user_id,position_id,event,amount,balance_after,details) values(p.account_id,p.user_id,p.id,'POSITION_CLOSED',pnl,a.balance,jsonb_build_object('price',px,'reason',reason,'spread_bonus',spread_bonus,'execution_mode','INVERTED_EDUCATIONAL'));
      n := n + 1;
    end if;
  end loop;

  for o in select * from public.pf_engine_orders where symbol=p_symbol and status='PENDING' for update loop
    if (o.order_type='LIMIT' and ((o.side='buy' and p_bid<=o.trigger_price) or (o.side='sell' and p_ask>=o.trigger_price))) or (o.order_type='STOP' and ((o.side='buy' and p_bid>=o.trigger_price) or (o.side='sell' and p_ask<=o.trigger_price))) then
      select * into a from public.pf_engine_accounts where id=o.account_id for update;
      if not found or a.status<>'ACTIVE' then update public.pf_engine_orders set status='REJECTED',reason='Account is not active',updated_at=now() where id=o.id;
      else
        px := case when o.side='buy' then p_bid else p_ask end;
        v_margin := o.lots*i.contract_size*px/a.leverage;
        select coalesce(sum(x.lots*j.contract_size*case when x.side='buy' then q2.bid else q2.ask end/a.leverage),0) into v_used from public.pf_engine_positions x join public.pf_engine_instruments j on j.symbol=x.symbol join public.pf_engine_quotes q2 on q2.symbol=x.symbol where x.account_id=o.account_id and x.status='OPEN';
        if v_margin+v_used<=a.balance*(a.max_margin_pct/100) then update public.pf_engine_orders set status='FILLED',updated_at=now() where id=o.id; insert into public.pf_engine_positions(order_id,user_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit) values(o.id,o.user_id,o.account_id,o.symbol,o.side,o.lots,px,o.stop_loss,o.take_profit); n := n + 1;
        else update public.pf_engine_orders set status='REJECTED',reason='Insufficient margin at trigger',updated_at=now() where id=o.id; end if;
      end if;
    end if;
  end loop;

  for demo_account in
    select a.*
    from public.pf_engine_accounts a
    join auth.users u on u.id=a.user_id
    where a.status='ACTIVE'
      and (coalesce((u.raw_user_meta_data->>'demo')::boolean,false) or coalesce(u.email,'') like 'demo-%@demo.plutustrade.app')
      and (a.balance<=0 or exists(select 1 from public.pf_engine_positions p2 where p2.account_id=a.id and p2.status='OPEN'))
    limit 100
  loop
    recharge_result := public.pf_engine_evaluate_account(demo_account.id);
    if recharge_result = 'AUTO_RECHARGE' then n := n + 1; end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.pf_engine_process_tick(text,numeric,numeric,timestamptz) from public, anon, authenticated;

-- Reconcile currently-zero demo accounts once after the function is installed.
do $$
declare
  account_id text;
begin
  for account_id in
    select a.id
    from public.pf_engine_accounts a
    join auth.users u on u.id = a.user_id
    where a.status = 'ACTIVE'
      and a.balance <= 0
      and (
        coalesce((u.raw_user_meta_data ->> 'demo')::boolean, false)
        or coalesce(u.email, '') like 'demo-%@demo.plutustrade.app'
      )
    limit 100
  loop
    perform public.pf_engine_evaluate_account(account_id);
  end loop;
end $$;
