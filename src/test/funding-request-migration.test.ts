import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261014043338_phase1_funding_requests.sql",
  "utf8",
);

describe("staged funding request migration", () => {
  it("keeps the migration additive and preserves legacy JSON sync", () => {
    expect(migration).toContain("create table if not exists public.pf_funding_requests");
    expect(migration).toContain("create table if not exists public.pf_security_audit");
    expect(migration).not.toMatch(
      /\b(drop|alter)\s+(table|policy)\s+public\.(pf_users_data|pf_audit_log)/i,
    );
  });

  it("allows request creation only through the authenticated server RPC", () => {
    expect(migration).toContain(
      "revoke all on public.pf_funding_requests from anon, authenticated",
    );
    expect(migration).toContain("grant select on public.pf_funding_requests to authenticated");
    expect(migration).toContain("create or replace function public.pf_create_funding_request");
    expect(migration).toContain("if v_user_id is null then");
    expect(migration).toContain("^[A-Za-z0-9_-]{2,40}$");
    expect(migration).toContain("'PENDING'");
  });

  it("requires trusted staff role and locks a request before one-time review", () => {
    expect(migration).toContain("coalesce(v_role, '') not in ('ADMIN', 'FINANCE')");
    expect(migration).toContain("coalesce(p_decision, '') not in ('APPROVED', 'REJECTED')");
    expect(migration).toContain("for update;");
    expect(migration).toContain("if v_request.status <> 'PENDING' then");
    expect(migration).toContain("'APPROVED', 'REJECTED'");
    expect(migration).toContain("'FUNDING_REQUEST_REVIEWED'");
  });

  it("keeps the new audit stream client-read-only and admin-readable", () => {
    expect(migration).toContain("revoke all on public.pf_security_audit from anon, authenticated");
    expect(migration).toContain("grant select on public.pf_security_audit to authenticated");
    expect(migration).toContain("pf_security_audit_admin_read");
    expect(migration).toContain(
      "using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN')",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = pg_catalog");
  });
});
