import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/20261026210000_inverted_execution_and_spread_bonus.sql"),
  "utf8",
);
const page = readFileSync(path.join(root, "public/plotos/index.html"), "utf8");
const demo = readFileSync(path.join(root, "src/routes/api/public/demo.ts"), "utf8");

describe("inverted educational execution contract", () => {
  it("uses inverted paper prices consistently in server functions", () => {
    expect(migration).toContain("-- Educational inverted mode: buy at Bid and sell at Ask.");
    expect(migration).toContain("v_price := case when p_side = 'buy' then q.bid else q.ask end");
    expect(migration).toContain("px := case when p.side = 'buy' then q.ask else q.bid end");
    expect(migration).toContain("execution_mode','INVERTED_EDUCATIONAL'");
  });

  it("records the positive spread bonus explicitly for manual and automatic closes", () => {
    expect(migration).toContain("spread_bonus");
    expect(migration).toContain("'spread_bonus',spread_bonus");
    expect(migration).toContain("reason := 'SL'");
    expect(migration).toContain("reason := 'TP'");
  });

  it("keeps the UI on the server engine when configured", () => {
    expect(page).toContain(
      "function tradePrice(sym,side,q){q=q||qt(sym);if(!q||!(q.bid>0))return 0;return side==='buy'?(q.bid||q.ask):(q.ask||q.bid)}",
    );
    expect(page).toContain("function useLocal(){return !ENGINE.base}");
  });

  it("reuses the same demo identity and account across device sessions", () => {
    expect(demo).toContain("listUsers({");
    expect(demo).toContain("page: 1");
    expect(demo).toContain("perPage: 1000");
    expect(demo).toContain("updateUserById(existing.id");
    expect(demo).toContain("password,");
    expect(demo).toContain("maybeSingle()");
    expect(demo).toContain("persistent: true, paper: true");
  });
});
