import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const paymentSource = readFileSync(path.join(root, "src/lib/nowpayments.server.ts"), "utf8");
const hardeningSql = readFileSync(
  path.join(root, "supabase/migrations/20261026170000_security_hardening.sql"),
  "utf8",
);
const envExample = readFileSync(path.join(root, ".env.example"), "utf8");

describe("security hardening contract", () => {
  it("does not embed a Supabase URL or key in payment code", () => {
    expect(paymentSource).not.toMatch(/https:\/\/[^"']+supabase\.co/);
    expect(paymentSource).not.toMatch(/sb_(publishable|secret)_[A-Za-z0-9_-]{12,}/);
    expect(paymentSource).toContain('process.env["PLOTOS_SB_URL"]');
    expect(paymentSource).toContain('process.env["PLOTOS_PUBLISHABLE_KEY"]');
  });

  it("revokes client writes and sanitizes legacy financial blob keys", () => {
    expect(hardeningSql).toContain(
      "revoke insert, update, delete, truncate on public.pf_audit_log from anon, authenticated",
    );
    expect(hardeningSql).toContain("create or replace function public.pf_audit_append");
    expect(hardeningSql).toContain("'balance', 'equity', 'pnl'");
    expect(hardeningSql).toContain("create trigger pf_users_data_sanitize_blob");
  });

  it("documents server-only secrets without committing values", () => {
    expect(envExample).toContain("SUPABASE_SERVICE_ROLE_KEY=sb_secret_replace-me");
    expect(envExample).toContain("NOWPAYMENTS_IPN_SECRET=replace-me");
  });
});
