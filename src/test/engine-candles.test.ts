import { describe, expect, it } from "vitest";
import { parseRiskBars } from "@/lib/engine-candles";

describe("engine candle parsing", () => {
  it("treats Biquote OHLC without an explicit basis as MID", () => {
    const result = parseRiskBars({
      bars: [
        { openTime: "2026-10-31T10:00:00Z", high: 2001, low: 1999, isOpen: false },
        { openTime: "2026-10-31T10:01:00Z", high: 2002, low: 2000, isOpen: true },
      ],
    }, Date.parse("2026-10-31T10:03:00Z"));
    expect(result.basis).toBe("MID");
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]?.high).toBe(2001);
  });

  it("rejects malformed and future bars", () => {
    const result = parseRiskBars({
      priceBasis: "BID",
      bars: [
        { openTime: "not-a-date", high: 2, low: 1 },
        { openTime: "2026-10-31T10:05:00Z", high: 1, low: 2 },
        { openTime: "2026-10-31T10:04:00Z", high: 2, low: 1 },
      ],
    }, Date.parse("2026-10-31T10:03:00Z"));
    expect(result.basis).toBe("BID");
    expect(result.bars).toEqual([]);
  });
});
