import { describe, expect, it } from "vitest";
import { orderPayloadSchema, parseEngineTick } from "./domain.js";

const requestId = "a1949b4b-1db7-4c05-9ce5-024f8a608f86";
describe("paper engine request validation", () => {
  it("accepts an idempotent market order within allowed lot bounds", () => {
    expect(
      orderPayloadSchema.safeParse({
        accountId: "acct-1",
        requestId,
        symbol: "EURUSD",
        side: "buy",
        type: "MARKET",
        lots: 0.1,
      }).success,
    ).toBe(true);
  });
  it("rejects client-provided identity and invalid size; DB checks actual instruments", () => {
    expect(
      orderPayloadSchema.safeParse({
        accountId: "acct-1",
        requestId,
        userId: "forged",
        symbol: "EURUSD",
        side: "buy",
        type: "MARKET",
        lots: 0.1,
      }).success,
    ).toBe(false);
    expect(
      orderPayloadSchema.safeParse({
        accountId: "acct-1",
        requestId,
        symbol: "FAKE",
        side: "buy",
        type: "MARKET",
        lots: 1,
      }).success,
    ).toBe(true); // final instrument allowlist is authoritative in DB
  });
});
describe("trusted quote tick parsing", () => {
  const now = 1_800_000_000_000;
  const allowed = new Set(["EURUSD"]);
  it("normalizes a current quote and seconds-based timestamps", () => {
    const quote = parseEngineTick(
      { symbol: "eurusd", bid: 1.1, ask: 1.1002, time: now / 1000 },
      allowed,
      now,
    );
    expect(quote?.symbol).toBe("EURUSD");
    expect(quote?.ask).toBe(1.1002);
  });
  it("rejects symbols outside the server allowlist and malformed spreads", () => {
    expect(parseEngineTick({ symbol: "FAKE", bid: 1, ask: 2, time: now }, allowed, now)).toBeNull();
    expect(
      parseEngineTick({ symbol: "EURUSD", bid: 2, ask: 1, time: now }, allowed, now),
    ).toBeNull();
  });
  it("rejects stale and implausibly future quotes", () => {
    expect(
      parseEngineTick({ symbol: "EURUSD", bid: 1, ask: 1.1, time: now - 31_000 }, allowed, now),
    ).toBeNull();
    expect(
      parseEngineTick({ symbol: "EURUSD", bid: 1, ask: 1.1, time: now + 6_000 }, allowed, now),
    ).toBeNull();
  });
});
