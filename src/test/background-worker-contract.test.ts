import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  path.join(root, "supabase/migrations/20261026190000_background_engine_worker.sql"),
  "utf8",
);
const fencedMigration = readFileSync(
  path.join(root, "supabase/migrations/20261030130000_fenced_background_worker_lease.sql"),
  "utf8",
);
const worker = readFileSync(path.join(root, "supabase/functions/engine-worker/index.ts"), "utf8");
const monitor = readFileSync(
  path.join(root, "src/routes/api/public/jobs/monitor-trades.ts"),
  "utf8",
);
const docs = readFileSync(path.join(root, "docs/BACKGROUND_ENGINE.md"), "utf8");

describe("background engine contract", () => {
  it("uses a durable lease so scheduled invocations cannot overlap", () => {
    expect(migration).toContain("pf_engine_worker_runs");
    expect(migration).toContain("pf_engine_worker_claim");
    expect(migration).toContain("locked_until");
    expect(worker).toContain('p_worker_name: "engine-tick"');
    expect(monitor).toContain("pf_engine_worker_claim");
    expect(monitor).toContain("already-running");
    expect(fencedMigration).toContain("lease_id uuid");
    expect(fencedMigration).toContain("and lease_id = p_lease_id");
  });

  it("processes server quotes and releases the lease on success and failure", () => {
    expect(worker).toContain("pf_engine_process_tick");
    expect(worker).toContain("pf_engine_worker_release");
    expect(worker).toContain('p_status: "error"');
    expect(worker).toContain('p_status: "ok"');
    expect(monitor).toContain("pf_engine_worker_release");
    expect(worker).toContain("p_lease_id: leaseId");
    expect(monitor).toContain("Worker lease release failed");
  });

  it("documents Supabase scheduling without requiring a paid always-on server", () => {
    expect(docs).toContain("pg_cron");
    expect(docs).toContain("pg_net");
    expect(docs).toContain("vault.create_secret");
    expect(docs).toContain("cron.unschedule");
    expect(docs).toContain("timeout_milliseconds := 10000");
    expect(docs).toContain("database_timezone");
    expect(docs).toContain("fenced lease");
    expect(docs).toContain("BIQUOTE_URL");
  });
});
