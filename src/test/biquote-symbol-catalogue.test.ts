import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const projectRoot = process.cwd();
const indexHtml = readFileSync(path.join(projectRoot, "public/plotos/index.html"), "utf8");
const marker = "/* Biquote is the sole market-data provider for PLUTUS. */";
const inlineStart = indexHtml.indexOf(marker);
const inlineEnd = indexHtml.indexOf("</script>", inlineStart);
const inlineAdapter =
  inlineStart >= 0 && inlineEnd > inlineStart ? indexHtml.slice(inlineStart, inlineEnd) : "";
const standaloneAdapter = readFileSync(
  path.join(projectRoot, "public/plotos/biquote-adapter.js"),
  "utf8",
);

async function requestSymbols(source: string) {
  const fakeWindow: { BiquoteAdapter?: { getSymbols: () => Promise<unknown> } } = {};
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ name: "EURUSD" }] });
  const run = new Function(
    "window",
    "fetch",
    "AbortController",
    "setTimeout",
    "clearTimeout",
    source,
  );
  run(fakeWindow, fetchMock, AbortController, setTimeout, clearTimeout);
  const result = await fakeWindow.BiquoteAdapter?.getSymbols();
  return { result, fetchMock };
}

describe("Biquote symbol catalogue", () => {
  it.each([
    ["embedded runtime adapter", inlineAdapter],
    ["standalone adapter", standaloneAdapter],
  ])("requests recently quoted symbols in the %s", async (_label, source) => {
    expect(source).toContain("/api/symbols?quotedWithinDays=7");
    expect(source).not.toContain("/api/symbols?liveOnly=true");

    const { result, fetchMock } = await requestSymbols(source);

    expect(result).toEqual([{ name: "EURUSD" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://biquote.io/api/symbols?quotedWithinDays=7",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });
});
