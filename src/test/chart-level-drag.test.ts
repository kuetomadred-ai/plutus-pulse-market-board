import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");

describe("chart SL/TP drag contract", () => {
  it("uses a larger touch hit area and a visual drag state", () => {
    expect(html).toContain("bd=touch?38:24");
    expect(html).toContain("level-dragging");
    expect(html).toContain("chart-drag-pill.invalid");
  });

  it("keeps preview values separate from the persisted position until release", () => {
    expect(html).toContain("DRAG.candidate=pr");
    expect(html).toContain("chart.levelDraft={posId:p.id,sl:p.sl,tp:p.tp}");
    expect(html).toContain("Place '+moved.kind.toUpperCase()+' on the valid side of price");
  });

  it("saves directly after a valid drag and restores the old level on failure", () => {
    expect(html).toContain("toast('Saving '+moved.kind.toUpperCase()+'…','')");
    expect(html).toContain("pos.sl=oldSl;pos.tp=oldTp");
    expect(html).toContain("TradingProvider.modifyPosition(pos,nextSl,nextTp,pos.ts)");
  });
});
