import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(path.join(root, "public/plotos/index.html"), "utf8");
const client = readFileSync(path.join(root, "public/plotos/engine-client.js"), "utf8");
const demo = readFileSync(path.join(root, "src/routes/api/public/demo.ts"), "utf8");
const engine = readFileSync(path.join(root, "src/lib/terminal-engine.server.ts"), "utf8");
const workflow = readFileSync(path.join(root, ".github/workflows/trade-monitor.yml"), "utf8");

describe("cloud paper engine contract", () => {
  it("requires a cloud session instead of silently creating local trades", () => {
    expect(page).toContain("function canTradeServer()");
    expect(page).toContain("function cloudTradingRequired()");
    expect(page).toContain("if(!canTradeServer())return cloudTradingRequired()");
    expect(page).toContain("function useLocal(){return false}");
    expect(page).toContain("function enterLocalDemo(){return enterDemo()}");
    expect(page).toContain("localStorage.removeItem('plutus_demo_token')");
  });

  it("returns and uses a server-signed demo session without Magic Link", () => {
    expect(demo).toContain("signDemoToken");
    expect(demo).not.toContain("generateLink");
    expect(demo).not.toContain("auth/v1/verify");
    expect(demo).toContain("access_token");
    expect(page).toContain("c.session.access_token");
    expect(page).toContain("localStorage.setItem('plutus_demo_token',j.session.access_token)");
    expect(page).not.toContain("CLOUD.sb.auth.setSession(c.session)");
    expect(engine).toContain("verifyDemoToken(token)");
    expect(engine).toContain("client = supabaseAdmin as SupabaseClient");
  });

  it("triggers the authenticated monitor endpoint on a free schedule", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).toContain("/api/public/jobs/monitor-trades");
    expect(workflow).toContain("LOVABLE_CRON_SECRET");
    expect(workflow).toContain("workflow_dispatch");
    expect(client).toContain("plutus_demo_device_v1");
    expect(client).toContain("plutus_demo_token");
  });
});
