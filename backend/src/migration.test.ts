import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20261016090000_server_side_paper_engine.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("paper trading engine migration", () => {
  it("defines persistent accounts, orders, positions, ledger, and trade history", () => {
    for (const table of [
      "pf_engine_accounts",
      "pf_engine_orders",
      "pf_engine_positions",
      "pf_engine_ledger",
      "pf_engine_trades_history",
    ]) {
      expect(migration).toMatch(new RegExp(`create table if not exists public\\.${table}\\b`));
    }
  });

  it("restricts user reads with RLS and reserves writes for trusted RPCs", () => {
    expect(migration).toMatch(/alter table public\.%I enable row level security/);
    expect(migration).toContain(
      "create policy pf_engine_history_owner_read on public.pf_engine_trades_history for select to authenticated",
    );
    expect(migration).toContain(
      "grant select on public.pf_engine_accounts,public.pf_engine_orders,public.pf_engine_positions,public.pf_engine_ledger,public.pf_engine_trades_history to authenticated",
    );
    expect(migration).toContain("grant execute on function public.pf_engine_process_tick");
    expect(migration).toContain("to service_role");
  });

  it("records full, automatic SL/TP, and partial closes atomically", () => {
    const inserts = migration.match(/insert into public\.pf_engine_trades_history\(/g) ?? [];
    expect(inserts).toHaveLength(3);
    expect(migration).toContain("'MANUAL'");
    expect(migration).toContain("'SL'");
    expect(migration).toContain("'TP'");
    expect(migration).toContain("'PARTIAL'");
  });
});
