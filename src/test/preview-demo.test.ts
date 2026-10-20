import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const page = readFileSync("public/plotos/index.html", "utf8");
const flag = page.match(/var PREVIEW_DEMO=([^;]+);/)?.[1];
const boot = page.slice(page.indexOf("(function boot(){"), page.indexOf("if ('serviceWorker'"));

describe("preview demo entry", () => {
  it("enables paper entry only for an explicit web trading demo", () => {
    if (!flag) throw new Error("Demo entry policy missing");
    const enabled = new Function("PORTAL_ADMIN", "window", "location", `return ${flag}`);
    expect(enabled(false, {}, { search: "?demo=1" })).toBe(true);
    expect(enabled(false, {}, { search: "" })).toBe(false);
    expect(enabled(true, {}, { search: "?demo=1&portal=admin" })).toBe(false);
    expect(enabled(false, { PLUTUS_NATIVE: true }, { search: "?demo=1" })).toBe(false);
  });

  it("opens the existing demo without waiting for external authentication", () => {
    const start = boot.slice(0, boot.indexOf(" ensureChartLib();")) + "})();";
    const enterDemo = vi.fn();
    const cloudInit = vi.fn(() => Promise.reject(new Error("Auth offline")));
    new Function("PREVIEW_DEMO", "enterDemo", "cloudInit", "location", "localStorage", "loadDB", "DB", "freshDB", "applyTheme", "applyLang", "SYMBOLS", "TFSEC", "chart", "startFeeds", start)(
      true, enterDemo, cloudInit, { search: "?demo=1" }, {}, () => {}, { settings: {} }, () => ({}), () => {}, () => {}, {}, {}, {}, () => {},
    );
    expect(enterDemo).toHaveBeenCalledOnce();
    expect(cloudInit).not.toHaveBeenCalled();
  });
});