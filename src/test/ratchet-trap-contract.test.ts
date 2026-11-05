import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "scripts/ratchet-trap-bot.ts"), "utf8");

describe("ratchet trap educational harness", () => {
  it("defaults to dry-run and requires explicit execution", () => {
    expect(source).toContain('const execute = process.argv.includes("--execute")');
    expect(source).toContain("if (!execute) return null");
    expect(source).toContain("--execute requires SUPABASE_URL");
  });

  it("has bounded runtime and stops after stop-out/recharge", () => {
    expect(source).toContain("MAX_STEPS");
    expect(source).toContain("MAX_MINUTES");
    expect(source).toContain("recharge/stop-out detected; stopping without reopening the hedge");
    expect(source).not.toContain("9982430");
    expect(source).not.toContain("4b2eb61d-0eb9-46a3-a09c-9684e88bc54c");
  });

  it("verifies a demo identity before any live-demo write", () => {
    expect(source).toContain("verifyDemoIdentity");
    expect(source).toContain("Refusing to run: DEMO_USER_ID is not marked as a demo identity");
  });
});
