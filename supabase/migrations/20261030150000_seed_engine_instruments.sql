-- Seed only the allow-listed educational instruments with provider-supplied valuation metadata.
insert into public.pf_engine_instruments(symbol, tick_size, tick_value, contract_size, enabled, updated_at)
values
  ('EURUSD', 0.00001, 10, 100000, true, now()),
  ('GBPUSD', 0.00001, 10, 100000, true, now()),
  ('USDJPY', 0.001, 10, 100000, true, now()),
  ('USDCHF', 0.00001, 0.00001, 1, true, now()),
  ('USDCAD', 0.00001, 0.00001, 1, true, now()),
  ('AUDUSD', 0.00001, 0.00001, 1, true, now()),
  ('NZDUSD', 0.00001, 0.00001, 1, true, now()),
  ('XAUUSD', 0.01, 1, 100, true, now()),
  ('XAGUSD', 0.001, 5, 5000, true, now()),
  ('US500', 0.01, 0.01, 1, true, now()),
  ('USTEC', 0.01, 0.01, 1, true, now()),
  ('US30', 0.01, 0.01, 1, true, now())
on conflict (symbol) do update
set tick_size = excluded.tick_size,
    tick_value = excluded.tick_value,
    contract_size = excluded.contract_size,
    enabled = excluded.enabled,
    updated_at = now();
