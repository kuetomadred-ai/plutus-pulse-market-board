import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");

type Template = { id: string; programMode: string; commissionPerLot: number };
type Account = { brokerProfileId?: string | null; commissionPerLot?: number | null };
type CommissionApi = {
  commissionPerLotFor: (account: Account) => number;
  commissionForLots: (account: Account, lots: number) => number;
};

function inlineFunction(name: string) {
  const start = page.indexOf(`function ${name}(`);
  const end = page.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`Could not find inline function ${name}`);
  return page.slice(start, end + 2);
}

const loadCommissionApi = new Function(
  "DB",
  `${inlineFunction("commissionPerLotFor")}; ${inlineFunction("commissionForLots")}; return { commissionPerLotFor, commissionForLots };`,
) as (db: { templates: Template[] }) => CommissionApi;

const templates: Template[] = [
  { id: "raw_ecn_sim", programMode: "broker_sim", commissionPerLot: 3 },
  { id: "standard_sim", programMode: "broker_sim", commissionPerLot: 0 },
  { id: "prop_50k", programMode: "challenge", commissionPerLot: 0 },
];
const api = loadCommissionApi({ templates });

describe("simulated broker commission policy", () => {
  it("applies the stored commission or falls back to the broker template only", () => {
    expect(api.commissionPerLotFor({ brokerProfileId: "raw_ecn_sim", commissionPerLot: 3 })).toBe(
      3,
    );
    expect(api.commissionPerLotFor({ brokerProfileId: "raw_ecn_sim" })).toBe(3);
    expect(api.commissionPerLotFor({ brokerProfileId: "standard_sim", commissionPerLot: 0 })).toBe(
      0,
    );
    expect(api.commissionPerLotFor({ commissionPerLot: 99 })).toBe(0);
    expect(api.commissionPerLotFor({ brokerProfileId: "missing", commissionPerLot: -4 })).toBe(0);
  });

  it("calculates the same rounded fee for full and partial closed lot quantities", () => {
    const account = { brokerProfileId: "raw_ecn_sim", commissionPerLot: 3 };
    expect(api.commissionForLots(account, 2)).toBe(6);
    expect(api.commissionForLots(account, 0.5)).toBe(1.5);
    expect(api.commissionForLots(account, 0.333)).toBe(1);
    expect(api.commissionForLots(account, -1)).toBe(0);
    expect(api.commissionForLots(account, Number.NaN)).toBe(0);
  });

  it("routes full and partial closes to the server instead of changing balances in the client", () => {
    const partialStart = page.indexOf("function closePartial(p,frac)");
    const partialEnd = page.indexOf("function closeAll(", partialStart);
    const partial = page.slice(partialStart, partialEnd);
    expect(page).toContain("/v1/positions/'+encodeURIComponent(p.id)+'/close-partial");
    expect(page).toContain("/v1/positions/'+encodeURIComponent(p.id)+'/close");
    expect(partial).toContain("TradingProvider.closePartial(p,closeLots)");
    expect(partial).not.toContain("a.balance=");
    expect(page).not.toContain("setInterval(function(){try{engineTick()}catch(e){}},600)");
  });
});
