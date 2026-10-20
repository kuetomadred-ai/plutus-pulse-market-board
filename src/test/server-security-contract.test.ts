import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fundingSql = readFileSync(
  path.join(root, "supabase/migrations/20261014043338_phase1_funding_requests.sql"),
  "utf8",
);
const engineSql = readFileSync(
  path.join(root, "supabase/migrations/20261016090000_server_side_paper_engine.sql"),
  "utf8",
);
const apiSource = readFileSync(path.join(root, "backend/src/api.ts"), "utf8");

describe("server-side data access contract", () => {
  it("keeps funding writes behind authenticated, role-checked RPCs", () => {
    expect(fundingSql).toContain(
      "alter table public.pf_funding_requests enable row level security",
    );
    expect(fundingSql).toContain("user_id = (select auth.uid())");
    expect(fundingSql).toContain(
      "grant execute on function public.pf_create_funding_request(text, numeric) to authenticated",
    );
    expect(fundingSql).toContain("coalesce(v_role, '') not in ('ADMIN', 'FINANCE')");
  });

  it("enables RLS on every paper-engine table and grants owner-filtered reads only", () => {
    for (const table of [
      "pf_engine_instruments",
      "pf_engine_accounts",
      "pf_engine_quotes",
      "pf_engine_orders",
      "pf_engine_positions",
      "pf_engine_ledger",
    ]) {
      expect(engineSql).toContain(`'${table}'`);
    }
    expect(engineSql).toContain("alter table public.%I enable row level security");
    expect(engineSql).toContain("user_id=(select auth.uid())");
    expect(engineSql).toContain("revoke all on public.%I from anon, authenticated");
    expect(engineSql).toContain("to service_role");
  });

  it("verifies Supabase identity and applies explicit user filters in API reads", () => {
    expect(apiSource).toContain("verifier.auth.getUser(token)");
    expect(apiSource).toContain('.eq("user_id", user.id)');
    expect(apiSource).toContain('.eq("account_id", account.id)');
  });
});
