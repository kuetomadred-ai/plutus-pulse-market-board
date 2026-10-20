import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");
const start = page.indexOf("function chartRiskLevelValid(");
const end = page.indexOf("\n}", start);
if (start < 0 || end < 0) throw new Error("Could not find chartRiskLevelValid");
const chartRiskLevelValid = new Function(
  `${page.slice(start, end + 2)}; return chartRiskLevelValid;`,
)();

describe("chart SL/TP placement", () => {
  it("validates buy stops below Bid and targets above Bid", () => {
    const buy = { side: "buy", symbol: "EURUSD", entry: 1.1 };
    const quote = { bid: 1.099, ask: 1.0992 };
    expect(chartRiskLevelValid(buy, "sl", 1.098, quote)).toBe(true);
    expect(chartRiskLevelValid(buy, "sl", 1.1, quote)).toBe(false);
    expect(chartRiskLevelValid(buy, "tp", 1.101, quote)).toBe(true);
    expect(chartRiskLevelValid(buy, "tp", 1.098, quote)).toBe(false);
  });

  it("validates sell stops above Ask and targets below Ask", () => {
    const sell = { side: "sell", symbol: "EURUSD", entry: 1.1 };
    const quote = { bid: 1.0998, ask: 1.1 };
    expect(chartRiskLevelValid(sell, "sl", 1.101, quote)).toBe(true);
    expect(chartRiskLevelValid(sell, "sl", 1.099, quote)).toBe(false);
    expect(chartRiskLevelValid(sell, "tp", 1.098, quote)).toBe(true);
    expect(chartRiskLevelValid(sell, "tp", 1.101, quote)).toBe(false);
  });

  it("falls back to entry when no quote exists and rejects invalid prices", () => {
    const buy = { side: "buy", symbol: "EURUSD", entry: 1.1 };
    expect(chartRiskLevelValid(buy, "sl", 1.09, {})).toBe(true);
    expect(chartRiskLevelValid(buy, "tp", 1.11, {})).toBe(true);
    expect(chartRiskLevelValid(buy, "sl", 0, {})).toBe(false);
    expect(chartRiskLevelValid(buy, "sl", Infinity, {})).toBe(false);
    expect(chartRiskLevelValid(buy, "entry", 1.09, {})).toBe(false);
  });

  it("exposes chart placement actions and a cancelable placement hint", () => {
    expect(page).toContain('id="epChartSL"');
    expect(page).toContain('id="epChartTP"');
    expect(page).toContain('id="chartLevelHint"');
    expect(page).toContain("beginChartLevelDrag(cv,e,xy)");
    expect(page).toContain("function selectChartPosition(p)");
    expect(page).toContain("bar.id='chartPositionBar'");
    expect(page).toContain("root.id='mt5ModifySheet'");
    expect(page).toContain("function submitChartPositionSheet()");
  });
});
