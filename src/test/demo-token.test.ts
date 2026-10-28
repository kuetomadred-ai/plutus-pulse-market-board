import { describe, expect, it } from "vitest";
import { signDemoToken, verifyDemoToken } from "../lib/demo-token.server";

process.env["LOVABLE_CRON_SECRET"] ||= "test-demo-token-secret";

describe("server-signed demo token", () => {
  it("signs and verifies a scoped, expiring demo identity", () => {
    const token = signDemoToken("user-123", "device-123");
    expect(token.startsWith("plutus_demo_")).toBe(true);
    expect(verifyDemoToken(token)).toMatchObject({ userId: "user-123", deviceId: "device-123" });
  });

  it("rejects tampering and malformed tokens", () => {
    const token = signDemoToken("user-123", "device-123");
    const [prefix, raw] = token.split("plutus_demo_");
    expect(prefix).toBe("");
    const [payload, signature] = (raw || "").split(".");
    const changed = Buffer.from(
      JSON.stringify({ userId: "other", deviceId: "device-123", exp: Date.now() + 1000 }),
    ).toString("base64url");
    expect(verifyDemoToken(`plutus_demo_${changed}.${signature}`)).toBeNull();
    expect(verifyDemoToken("plutus_demo_not-a-token")).toBeNull();
    expect(verifyDemoToken(`plutus_demo_${payload}.${signature}.extra`)).toBeNull();
  });
});
