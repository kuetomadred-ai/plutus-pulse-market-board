import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "public/plotos/engine-client.js"), "utf8");

describe("PLUTUS engine client module", () => {
  it("accepts HTTPS origins and local HTTP only", () => {
    const window = { crypto: { randomUUID: () => "test-uuid" } };
    new Function("window", source)(window);
    const client = (
      window as typeof window & {
        PLUTUS_ENGINE_CLIENT: {
          baseUrl: (value: string) => string;
          request: (base: string, client: unknown, path: string) => Promise<unknown>;
        };
      }
    ).PLUTUS_ENGINE_CLIENT;
    expect(client.baseUrl("https://engine.example.com/")).toBe("https://engine.example.com");
    expect(client.baseUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(client.baseUrl("http://engine.example.com")).toBe("");
    expect(client.baseUrl("https://engine.example.com/path?q=1")).toBe("");
  });

  it("fails closed offline when no API URL is configured", async () => {
    const window = {};
    new Function("window", source)(window);
    const client = (
      window as typeof window & {
        PLUTUS_ENGINE_CLIENT: {
          request: (base: string, supabase: unknown, path: string) => Promise<unknown>;
        };
      }
    ).PLUTUS_ENGINE_CLIENT;
    await expect(client.request("", null, "/v1/accounts")).rejects.toThrow(
      "Trading API URL is not configured",
    );
  });
});
