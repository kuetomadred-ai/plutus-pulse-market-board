import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(path.join(root, "public/plotos/index.html"), "utf8");
const client = readFileSync(path.join(root, "public/plotos/engine-client.js"), "utf8");
const workflow = readFileSync(path.join(root, ".github/workflows/trade-monitor.yml"), "utf8");

describe("hybrid trading fallback contract", () => {
  it("falls back locally when the cloud engine is unavailable", () => {
    expect(page).toContain("function canTradeServer()");
    expect(page).toContain(
      "if(!canTradeServer())return Promise.resolve(localFallbackResult(LocalProvider.place",
    );
    expect(page).toContain("function useLocal(){return !canTradeServer()}");
    expect(page).toContain("PAPER_STATE_KEY='plutus_paper_state_v1'");
  });

  it("only falls back after retryable transport failures, not server order rejection", () => {
    expect(client).toContain("unavailable.retryable = true");
    expect(client).toContain("if (error && !error.retryable) error.retryable = true");
    expect(page).toContain("if(!e||!e.retryable)throw e");
  });

  it("triggers the authenticated monitor endpoint on a free schedule", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).toContain("/api/public/jobs/monitor-trades");
    expect(workflow).toContain("LOVABLE_CRON_SECRET");
    expect(workflow).toContain("workflow_dispatch");
  });
});
