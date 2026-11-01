-- Historical M1 candle reconciliation for gaps while the client or worker was offline.
-- Biquote OHLC bars are MID-price envelopes. For inverted execution we adjust
-- the envelope with the latest known spread before testing the executable side.

alter table public.pf_engine_positions
  add column if not exists protection_changed_at timestamptz,
  add column if not exists risk_checked_at timestamptz,
  add column if not exists risk_issue jsonb;

update public.pf_engine_positions
set protection_changed_at = coalesce(protection_changed_at, opened_at)
where protection_changed_at is null;

create index if not exists pf_engine_positions_reconcile_idx
  on public.pf_engine_positions(symbol, status, opened_at)
  where status = 'OPEN' and (stop_loss is not null or take_profit is not null);

create or replace function public.pf_engine_reconcile_candles(
  p_symbol text,
  p_bars jsonb,
  p_basis text default 'UNKNOWN',
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  p public.pf_engine_positions;
  i public.pf_engine_instruments;
  a public.pf_engine_accounts;
  b jsonb;
  bt timestamptz;
  hi numeric;
  lo numeric;
  executable_hi numeric;
  executable_lo numeric;
  px numeric;
  pnl numeric;
  reason text;
  sl_hit boolean;
  tp_hit boolean;
  n integer := 0;
  unresolved integer := 0;
  basis text := upper(coalesce(nullif(trim(p_basis), ''), 'UNKNOWN'));
  spread numeric := 0;
  half_spread numeric := 0;
begin
  if p_symbol is null or p_symbol !~ '^[A-Z0-9_]{2,20}$' then
    raise exception using errcode = '22023', message = 'Invalid symbol';
  end if;
  if jsonb_typeof(p_bars) <> 'array' or jsonb_array_length(p_bars) > 1000 then
    raise exception using errcode = '22023', message = 'Invalid candle batch';
  end if;
  if basis not in ('BID', 'ASK', 'MID', 'UNKNOWN') then
    raise exception using errcode = '22023', message = 'Invalid candle basis';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pf-risk:' || p_symbol, 0));
  select * into i from public.pf_engine_instruments
  where symbol = p_symbol and enabled;
  if not found then
    return jsonb_build_object('closed', 0, 'unresolved', 0, 'ignored', 0);
  end if;

  -- Biquote OHLC is MID. Use the last observed non-negative spread as the
  -- executable-side adjustment; do not invent a symbol-specific hard-coded spread.
  if basis in ('MID', 'UNKNOWN') then
    select greatest(ask - bid, 0) into spread
    from public.pf_engine_quotes
    where symbol = p_symbol
    order by received_at desc
    limit 1;
    spread := coalesce(spread, 0);
    half_spread := spread / 2;
  end if;

  for p in
    select * from public.pf_engine_positions
    where symbol = p_symbol
      and (p_user_id is null or user_id = p_user_id)
      and status = 'OPEN'
      and (stop_loss is not null or take_profit is not null)
    order by account_id, id
    for update
  loop
    for b in
      select value from jsonb_array_elements(p_bars)
      order by (value->>'openTime')::timestamptz
    loop
      begin
        bt := (b->>'openTime')::timestamptz;
        hi := (b->>'high')::numeric;
        lo := (b->>'low')::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid candle';
      end;
      if bt is null or hi is null or lo is null or lo <= 0 or hi < lo then
        raise exception using errcode = '22023', message = 'Invalid candle';
      end if;
      if coalesce((b->>'isOpen')::boolean, false)
         or bt + interval '1 minute' > now()
         or bt < greatest(p.opened_at, coalesce(p.protection_changed_at, p.opened_at))
         or (p.risk_checked_at is not null and bt < p.risk_checked_at) then
        continue;
      end if;

      -- The position exits on the opposite executable side. For MID bars,
      -- buy exits use MID + half spread and sell exits use MID - half spread.
      if p.side = 'buy' then
        executable_lo := case when basis in ('MID', 'UNKNOWN') then lo + half_spread else lo end;
        executable_hi := case when basis in ('MID', 'UNKNOWN') then hi + half_spread else hi end;
        sl_hit := p.stop_loss is not null and executable_lo <= p.stop_loss;
        tp_hit := p.take_profit is not null and executable_hi >= p.take_profit;
      else
        executable_lo := case when basis in ('MID', 'UNKNOWN') then lo - half_spread else lo end;
        executable_hi := case when basis in ('MID', 'UNKNOWN') then hi - half_spread else hi end;
        sl_hit := p.stop_loss is not null and executable_hi >= p.stop_loss;
        tp_hit := p.take_profit is not null and executable_lo <= p.take_profit;
      end if;

      if sl_hit and tp_hit then
        update public.pf_engine_positions
        set risk_issue = jsonb_build_object(
          'kind', 'AMBIGUOUS_SL_TP', 'bar_open_at', bt,
          'detected_at', now(), 'high', hi, 'low', lo,
          'basis', basis, 'spread', spread
        )
        where id = p.id;
        unresolved := unresolved + 1;
        exit;
      end if;

      update public.pf_engine_positions
      set risk_checked_at = greatest(coalesce(risk_checked_at, '-infinity'::timestamptz), bt + interval '1 minute'),
          risk_issue = null
      where id = p.id;

      if not sl_hit and not tp_hit then
        continue;
      end if;

      reason := case when sl_hit then 'SL' else 'TP' end;
      px := case when sl_hit then p.stop_loss else p.take_profit end;
      pnl := round(((px - p.entry_price) / i.tick_size * i.tick_value * p.lots
        * case when p.side = 'buy' then 1 else -1 end)::numeric, 2);

      select * into a from public.pf_engine_accounts where id = p.account_id for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'Account not found';
      end if;

      update public.pf_engine_positions
      set status = 'CLOSED', closed_at = now(), exit_price = px,
          realized_pnl = pnl, close_reason = reason, risk_issue = null
      where id = p.id;

      update public.pf_engine_accounts
      set balance = balance + pnl, updated_at = now()
      where id = a.id returning * into a;

      insert into public.pf_engine_trades_history(
        position_id, user_id, account_id, symbol, side, lots, entry_price,
        exit_price, realized_pnl, close_reason, opened_at, closed_at
      ) values (
        p.id, p.user_id, p.account_id, p.symbol, p.side, p.lots, p.entry_price,
        px, pnl, reason, p.opened_at, now()
      );

      insert into public.pf_engine_ledger(
        account_id, user_id, position_id, event, amount, balance_after, details
      ) values (
        p.account_id, p.user_id, p.id, 'POSITION_CLOSED', pnl, a.balance,
        jsonb_build_object(
          'price', px, 'reason', reason, 'symbol', p.symbol, 'lots', p.lots,
          'side', p.side, 'source', 'CANDLE_RECONCILIATION',
          'bar_open_at', bt, 'time_precision', 'MINUTE_RANGE',
          'basis', basis, 'spread', spread, 'spread_bonus', 0,
          'settled_at', now()
        )
      );
      n := n + 1;
      exit;
    end loop;
  end loop;

  return jsonb_build_object('closed', n, 'unresolved', unresolved, 'basis', basis, 'spread', spread);
end;
$$;

-- Keep protection timestamps accurate for future reconciliation windows.
create or replace function public.pf_engine_modify_position(
  p_user_id uuid, p_position_id uuid, p_sl numeric, p_tp numeric
) returns public.pf_engine_positions
language plpgsql security definer set search_path = pg_catalog
as $$
declare p public.pf_engine_positions; q public.pf_engine_quotes; ref_price numeric;
begin
  select * into p from public.pf_engine_positions
  where id = p_position_id and user_id = p_user_id and status = 'OPEN' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Open position not found'; end if;
  select * into q from public.pf_engine_quotes
  where symbol = p.symbol and received_at > now() - interval '15 seconds';
  if not found then raise exception using errcode = '55000', message = 'No fresh server quote'; end if;
  ref_price := case when p.side = 'buy' then q.bid else q.ask end;
  if p_sl is not null and ((p.side = 'buy' and p_sl >= ref_price) or (p.side = 'sell' and p_sl <= ref_price)) then raise exception using errcode = '22023', message = 'Stop loss on invalid side'; end if;
  if p_tp is not null and ((p.side = 'buy' and p_tp <= ref_price) or (p.side = 'sell' and p_tp >= ref_price)) then raise exception using errcode = '22023', message = 'Take profit on invalid side'; end if;
  update public.pf_engine_positions
  set stop_loss = p_sl, take_profit = p_tp, protection_changed_at = now(),
      risk_checked_at = null, risk_issue = null
  where id = p.id returning * into p;
  return p;
end;
$$;

revoke all on function public.pf_engine_reconcile_candles(text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.pf_engine_reconcile_candles(text, jsonb, text, uuid) to service_role;
revoke all on function public.pf_engine_modify_position(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.pf_engine_modify_position(uuid, uuid, numeric, numeric) to service_role;
