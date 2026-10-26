import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/20261026190000_background_engine_worker.sql"),
  "utf8",
);
const worker = readFileSync(path.join(root, "supabase/functions/engine-worker/index.ts"), "utf8");
const docs = readFileSync(path.join(root, "docs/BACKGROUND_ENGINE.md"), "utf8");

describe("background engine contract", () => {
  it("uses a durable lease so scheduled invocations cannot overlap", () => {
    expect(migration).toContain("pf_engine_worker_runs");
    expect(migration).toContain("pf_engine_worker_claim");
    expect(migration).toContain("locked_until");
    expect(worker).toContain('p_worker_name: "engine-tick"');
  });

  it("processes server quotes and releases the lease on success and failure", () => {
    expect(worker).toContain("pf_engine_process_tick");
    expect(worker).toContain("pf_engine_worker_release");
    expect(worker).toContain('p_status: "error"');
    expect(worker).toContain('p_status: "ok"');
  });

  it("documents Supabase scheduling without requiring a paid always-on server", () => {
    expect(docs).toContain("pg_cron");
    expect(docs).toContain("pg_net");
    expect(docs).toContain("vault.create_secret");
  });
});
