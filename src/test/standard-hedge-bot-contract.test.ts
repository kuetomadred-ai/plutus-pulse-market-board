import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261106181000_standard_execution_hedge_bot.sql"),
  "utf8",
);

describe("standard execution hedge bot contract", () => {
  it("defines standard MT5 executable sides", () => {
    expect(migration).toContain("MT5 standard: buy at Ask, sell at Bid");
    expect(migration).toContain("MT5 standard: close buy at Bid, sell at Ask");
    expect(migration).toContain("execution_mode','STANDARD_MT5'");
  });

  it("bounds the bot and prevents accidental activation", () => {
    expect(migration).toContain("max_positions integer not null default 10");
    expect(migration).toContain("max_loss numeric(18,2) not null default 1000");
    expect(migration).toContain("where a.id='9982430'");
    expect(migration).toContain("active=false");
    expect(migration).toContain("WAITING_FOR_EXPLICIT_START");
  });

  it("does not create a fallback account or route to a broker", () => {
    expect(migration).toContain("No broker orders are routed");
    expect(migration).not.toContain("insert into public.pf_engine_accounts");
    expect(migration).not.toContain("9982430', '4b2eb61d");
  });
});
