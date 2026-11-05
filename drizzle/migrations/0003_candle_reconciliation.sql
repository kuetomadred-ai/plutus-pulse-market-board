alter table public.pf_engine_positions
  add column if not exists protection_changed_at timestamptz,
  add column if not exists risk_checked_at timestamptz,
  add column if not exists risk_issue jsonb;
update public.pf_engine_positions set protection_changed_at = opened_at where protection_changed_at is null;
create index if not exists pf_engine_positions_reconcile_idx on public.pf_engine_positions(symbol, status, opened_at) where status = 'OPEN' and (stop_loss is not null or take_profit is not null);
create or replace function public.pf_engine_reconcile_candles(p_symbol text, p_bars jsonb, p_basis text default 'UNKNOWN', p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare p public.pf_engine_positions; i public.pf_engine_instruments; a public.pf_engine_accounts; b jsonb; bt timestamptz; hi numeric; lo numeric; ehi numeric; elo numeric; px numeric; pnl numeric; reason text; sl_hit boolean; tp_hit boolean; n integer := 0; unresolved integer := 0;
 basis text := upper(coalesce(nullif(trim(p_basis), ''), 'UNKNOWN')); spread numeric := 0; hs numeric := 0;
begin
 if p_symbol is null or p_symbol !~ '^[A-Z0-9_]{2,20}$' then raise exception using errcode='22023', message='Invalid symbol'; end if;
 if jsonb_typeof(p_bars) <> 'array' or jsonb_array_length(p_bars) > 1000 then raise exception using errcode='22023', message='Invalid candle batch'; end if;
 if basis not in ('BID','ASK','MID','UNKNOWN') then raise exception using errcode='22023', message='Invalid candle basis'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pf-risk:' || p_symbol, 0));
 select * into i from public.pf_engine_instruments where symbol = p_symbol and enabled;
 if not found then return jsonb_build_object('closed',0,'unresolved',0,'ignored',0); end if;
 if basis in ('MID','UNKNOWN') then
   select greatest(ask - bid, 0) into spread from public.pf_engine_quotes where symbol = p_symbol order by received_at desc limit 1;
   spread := coalesce(spread, 0); hs := spread / 2;
 end if;
 for p in select * from public.pf_engine_positions where symbol = p_symbol and (p_user_id is null or user_id = p_user_id) and status = 'OPEN' and (stop_loss is not null or take_profit is not null) order by account_id, id for update loop
  for b in select value from jsonb_array_elements(p_bars) order by (value->>'openTime')::timestamptz loop
   bt := (b->>'openTime')::timestamptz; hi := (b->>'high')::numeric; lo := (b->>'low')::numeric;
   if bt is null or hi is null or lo is null or lo <= 0 or hi < lo then raise exception using errcode='22023', message='Invalid candle'; end if;
   if coalesce((b->>'isOpen')::boolean,false) or bt + interval '1 minute' > now() or bt < greatest(p.opened_at, coalesce(p.protection_changed_at, p.opened_at)) or (p.risk_checked_at is not null and bt < p.risk_checked_at) then continue; end if;
   if p.side = 'buy' then
     elo := case when basis in ('MID','UNKNOWN') then lo + hs else lo end; ehi := case when basis in ('MID','UNKNOWN') then hi + hs else hi end;
     sl_hit := p.stop_loss is not null and elo <= p.stop_loss; tp_hit := p.take_profit is not null and ehi >= p.take_profit;
   else
     elo := case when basis in ('MID','UNKNOWN') then lo - hs else lo end; ehi := case when basis in ('MID','UNKNOWN') then hi - hs else hi end;
     sl_hit := p.stop_loss is not null and ehi >= p.stop_loss; tp_hit := p.take_profit is not null and elo <= p.take_profit;
   end if;
   if sl_hit and tp_hit then
     update public.pf_engine_positions set risk_issue = jsonb_build_object('kind','AMBIGUOUS_SL_TP','bar_open_at',bt,'detected_at',now(),'high',hi,'low',lo,'basis',basis,'spread',spread) where id = p.id;
     unresolved := unresolved + 1; exit;
   end if;
   update public.pf_engine_positions set risk_checked_at = greatest(coalesce(risk_checked_at,'-infinity'::timestamptz), bt + interval '1 minute'), risk_issue = null where id = p.id;
   if not sl_hit and not tp_hit then continue; end if;
   reason := case when sl_hit then 'SL' else 'TP' end; px := case when sl_hit then p.stop_loss else p.take_profit end;
   perform public.pf_engine_close_at(p.id, px, reason);
   n := n + 1; exit;
  end loop;
 end loop;
 return jsonb_build_object('closed',n,'unresolved',unresolved,'basis',basis,'spread',spread);
end $$;
revoke all on function public.pf_engine_reconcile_candles(text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.pf_engine_reconcile_candles(text, jsonb, text, uuid) to service_role;