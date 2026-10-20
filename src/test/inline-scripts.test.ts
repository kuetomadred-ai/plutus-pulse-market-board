// @ts-nocheck -- loosely typed test harness for untyped plain-JS app code
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(path.join(root, "public/plotos/index.html"), "utf8");
const engineConfig = readFileSync(path.join(root, "public/plotos/engine-config.js"), "utf8");
const inlineScripts = Array.from(page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
  .filter((match) => !/\bsrc\s*=/i.test(match[1]))
  .map((match) => match[2].trim())
  .filter(Boolean);

describe("embedded application scripts", () => {
  it("parses every inline script without executing application code", () => {
    expect(inlineScripts.length).toBeGreaterThan(0);
    inlineScripts.forEach((source, index) => {
      expect(() => new Function(source), `inline script ${index + 1}`).not.toThrow();
    });
  });

  it("requires a confirmed Supabase session before entering the app", () => {
    expect(page).toContain("function pre(){return CLOUD.ok?cloudPull():Promise.resolve()}");
    expect(page).not.toMatch(/\bvar pre=/);
    expect(page).toContain("if(!r.data.user||!r.data.session)");
    expect(page).toContain("DB.session=null;DEMO_MODE=false;save()");
    expect(page).toContain("function runAuthButton(button,request,onSuccess)");
    expect(page).toContain('id="demoBtn">Go to login');
  });

  it("presents Supabase resend cooldowns as a friendly, non-error status", () => {
    expect(page).toContain("(?:after|wait)\\s+(\\d+)\\s+seconds?");
    expect(page).toContain(
      "Wait '+wait[1]+' seconds before requesting another confirmation email.",
    );
    expect(page).toContain("!!success||confirmation||unverified||limited");
    expect(page).not.toContain("For security purposes, you can only request this after");
    expect(page).not.toContain("49 seconds.");
  });

  it("removes redundant signup disclosures while retaining a concise simulation label", () => {
    expect(page).toContain("Simulated trading environment");
    expect(page).not.toContain("Account activation is reviewed by staff.");
    expect(page).not.toContain("SERVER-SIDE PAPER TRADING");
    expect(page).not.toContain("Sign in for paper trading");
    expect(page).not.toContain('<footer class="lp-foot">');
  });

  it("preserves the NOWPayments invoice route and fails closed without a native API URL", () => {
    expect(page).toContain("NOWPayments");
    expect(page).toContain("/api/public/payments/invoice");
    expect(page).toContain("Payment API is not configured for this build");
    expect(engineConfig).toContain('window.PLUTUS_PAYMENTS_API_URL = ""');
  });
});
