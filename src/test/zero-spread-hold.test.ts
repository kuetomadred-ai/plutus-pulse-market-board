// @ts-nocheck -- loosely typed test harness for untyped plain-JS app code
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");
function fn(name) {
  const start = page.indexOf(`function ${name}(`);
  return page.slice(start, page.indexOf("}", page.indexOf("return", start)) + 1);
}
const api = new Function(
  `var MIN_HOLD_MS=60000;${fn("midPrice")};${fn("holdLeftSec")};return {midPrice,holdLeftSec};`,
)();

describe("zero-spread execution and minimum hold", () => {
  it("fills at the exact Bid/Ask midpoint", () => {
    expect(api.midPrice({ bid: 1.5972, ask: 1.5974 })).toBeCloseTo(1.5973, 10);
  });
  it("blocks closing before one minute", () => {
    expect(api.holdLeftSec({ openedAt: Date.now() - 30000 })).toBe(30);
    expect(api.holdLeftSec({ openedAt: Date.now() - 60000 })).toBe(0);
  });
});
