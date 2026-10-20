// @ts-nocheck -- loosely typed test harness for untyped plain-JS app code
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");

function inlineFunction(name: string) {
  const start = page.indexOf(`function ${name}(`);
  const end = page.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`Could not find inline function ${name}`);
  return page.slice(start, end + 2);
}

function makeChartApi(chart: unknown = {}, quotes: unknown = {}, save = vi.fn()) {
  const factory = new Function(
    "chart",
    "Q",
    "TFSEC",
    "saveCandlesToCache",
    `${inlineFunction("chartBarEnd")}; ${inlineFunction("chartBucketTime")}; ${inlineFunction("syncChartCandleWithQuote")}; return { chartBarEnd, chartBucketTime, syncChartCandleWithQuote };`,
  );
  return factory(chart, quotes, { "1m": 60, "1w": 604800, "1mo": 2592000 }, save);
}

function makeQuoteApi(quotes: Record<string, unknown> = {}) {
  const factory = new Function(
    "Q",
    "SYMBOLS",
    "FEEDS",
    "Date",
    `${inlineFunction("quoteFromBiquote")}; ${inlineFunction("applyBiquoteQuote")}; return applyBiquoteQuote;`,
  );
  const feeds = { biquote: { last: 0 } };
  return { apply: factory(quotes, { EURUSD: true }, feeds, Date), feeds };
}

function makeQuoteNormalizer() {
  const factory = new Function(
    "Q",
    "Date",
    `${inlineFunction("quoteFromBiquote")}; return quoteFromBiquote;`,
  );
  return factory({}, Date);
}

describe("Biquote quote and chart price alignment", () => {
  it("uses the exact Bid/Ask midpoint for chart pricing and validates the quote timestamp", () => {
    const normalize = makeQuoteNormalizer();
    const timestamp = "2026-10-09T20:57:37Z";
    const quote = normalize(
      {
        symbol: "XAUUSD",
        bid: 4194.817,
        ask: 4194.985,
        mid: 4195.4,
        timestamp,
        marketState: "closed",
        stale: true,
      },
      false,
    );

    expect(quote.last).toBeCloseTo((4194.817 + 4194.985) / 2, 10);
    expect(quote.quoteTimestampValid).toBe(true);
    expect(quote.t).toBe(Date.parse(timestamp));

    const untimed = normalize({ symbol: "EURUSD", bid: 1.1, ask: 1.1002, mid: 1.1001 }, false);
    expect(untimed.quoteTimestampValid).toBe(false);
  });

  it("aligns a candle close only when the quote timestamp belongs to its candle", () => {
    const quoteTime = Date.parse("2026-10-09T20:57:37Z");
    const candleTime = Math.floor(quoteTime / 1000 / 60) * 60;
    const bar = { time: candleTime, open: 4195.2, high: 4195.5, low: 4194.5, close: 4195.118 };
    const chart = {
      cs: {},
      sym: "XAUUSD",
      tf: "1m",
      dataSym: "XAUUSD",
      dataTf: "1m",
      candleArr: [bar],
    };
    const quotes = {
      XAUUSD: {
        bid: 4194.817,
        ask: 4194.985,
        last: (4194.817 + 4194.985) / 2,
        t: quoteTime,
        quoteTimestampValid: true,
      },
    };
    const save = vi.fn();
    const { syncChartCandleWithQuote } = makeChartApi(chart, quotes, save);

    expect(syncChartCandleWithQuote("XAUUSD", "1m")).toBe(true);
    expect(bar.close).toBeCloseTo(quotes.XAUUSD.last, 10);
    expect(bar.high).toBe(4195.5);
    expect(bar.low).toBe(4194.5);
    expect(save).toHaveBeenCalledWith("XAUUSD", "1m", chart.candleArr);
  });

  it("does not rewrite candles for a different period, symbol, timeframe, or untrusted timestamp", () => {
    const quoteTime = Date.parse("2026-10-09T20:57:37Z");
    const bar = {
      time: Math.floor(quoteTime / 1000 / 60) * 60,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
    };
    const chart = {
      cs: {},
      sym: "EURUSD",
      tf: "1m",
      dataSym: "EURUSD",
      dataTf: "1m",
      candleArr: [bar],
    };
    const quote = {
      bid: 10.1,
      ask: 10.3,
      last: 10.2,
      t: quoteTime + 60_000,
      quoteTimestampValid: true,
    };
    const save = vi.fn();
    const { syncChartCandleWithQuote } = makeChartApi(chart, { EURUSD: quote }, save);

    expect(syncChartCandleWithQuote("EURUSD", "1m")).toBe(false);
    expect(syncChartCandleWithQuote("GBPUSD", "1m")).toBe(false);
    expect(syncChartCandleWithQuote("EURUSD", "5m")).toBe(false);
    expect(bar.close).toBe(10.5);
    expect(save).not.toHaveBeenCalled();

    quote.t = quoteTime;
    quote.quoteTimestampValid = false;
    expect(syncChartCandleWithQuote("EURUSD", "1m")).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("uses calendar month boundaries and the current weekly bar anchor", () => {
    const { chartBarEnd, chartBucketTime } = makeChartApi();
    const monthStart = Date.UTC(2026, 9, 1) / 1000;
    const monthEnd = Date.UTC(2026, 10, 1) / 1000;
    const monthQuote = Date.UTC(2026, 9, 31, 20) / 1000;
    const weekStart = Date.UTC(2026, 9, 5) / 1000;
    const weekQuote = Date.UTC(2026, 9, 9, 20) / 1000;

    expect(chartBarEnd(monthStart, "1mo")).toBe(monthEnd);
    expect(chartBucketTime(monthQuote, "1mo", monthStart)).toBe(monthStart);
    expect(chartBucketTime(weekQuote, "1w", weekStart)).toBe(weekStart);
    expect(chartBarEnd(weekStart, "1w")).toBe(weekStart + 604800);
  });

  it("ignores an older or untimed quote after a newer timestamped quote", () => {
    const quotes: Record<string, unknown> = {};
    const { apply } = makeQuoteApi(quotes);
    const newer = {
      symbol: "EURUSD",
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      timestamp: "2026-10-09T20:58:00Z",
      marketState: "open",
    };
    const older = { ...newer, bid: 1.09, ask: 1.0902, timestamp: "2026-10-09T20:57:00Z" };

    expect(apply(newer, true)).toBe(true);
    const acceptedPrice = (quotes.EURUSD as { last: number }).last;
    expect(apply(older, true)).toBe(false);
    expect(apply({ ...newer, mid: undefined, timestamp: undefined }, false)).toBe(false);
    expect((quotes.EURUSD as { last: number }).last).toBe(acceptedPrice);
  });
});
