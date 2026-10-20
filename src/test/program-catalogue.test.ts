// @ts-nocheck -- loosely typed test harness for untyped plain-JS app code
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");
const start = page.indexOf("var PROP_PROGRAMS=[");
const end = page.indexOf("\n/* store */", start);
if (start < 0 || end < 0) throw new Error("Could not find the inline funding program catalogue");

const loadCatalogue = new Function(
  `${page.slice(start, end)}; return { PROP_PROGRAMS, BROKER_SIM_TEMPLATES, programTemplateRecords, challengeTargets };`,
) as () => {
  PROP_PROGRAMS: Array<{
    id: string;
    tiers: Array<{ id: string; size: number; profit1: number; profit2: number }>;
  }>;
  BROKER_SIM_TEMPLATES: Array<{ id: string; comm: number; lev: number }>;
  programTemplateRecords: () => Array<Record<string, unknown>>;
  challengeTargets: (template: Record<string, unknown>) => number[];
};

const { PROP_PROGRAMS, BROKER_SIM_TEMPLATES, programTemplateRecords, challengeTargets } =
  loadCatalogue();

describe("PLUTUS simulated funding catalogue", () => {
  it("provides the requested 2-step, 1-step, and direct tiers", () => {
    expect(PROP_PROGRAMS.map((program) => program.id)).toEqual([
      "prog_2step",
      "prog_1step",
      "prog_instant",
    ]);
    expect(PROP_PROGRAMS.map((program) => program.tiers.length)).toEqual([5, 4, 3]);
    expect(PROP_PROGRAMS[0].tiers.map((tier) => tier.size)).toEqual([
      10_000, 25_000, 50_000, 100_000, 200_000,
    ]);
  });

  it("keeps evaluation targets and direct funding semantics distinct", () => {
    const templates = programTemplateRecords();
    const byId = new Map(templates.map((template) => [template.id, template]));

    expect(challengeTargets(byId.get("2s-50k")!)).toEqual([8, 5]);
    expect(challengeTargets(byId.get("1s-50k")!)).toEqual([9]);
    expect(challengeTargets(byId.get("ins-25k")!)).toEqual([]);
    expect(byId.get("ins-25k")).toMatchObject({
      dailyLossPct: 0,
      minDays: 0,
      programMode: "instant",
      payoutCadenceDays: 14,
    });
  });

  it("moves a two-step account to phase two, then marks it passed", () => {
    const passStart = page.indexOf("function passCh(a){");
    const passEnd = page.indexOf("\nfunction dayProfits", passStart);
    if (passStart < 0 || passEnd < 0)
      throw new Error("Could not find the challenge phase transition");
    const closeAll = vi.fn();
    const audit = vi.fn();
    const notify = vi.fn();
    const save = vi.fn();
    const passCh = new Function(
      "challengeTargets",
      "closeAll",
      "todayKey",
      "audit",
      "notify",
      "save",
      `${page.slice(passStart, passEnd)}; return passCh;`,
    )(challengeTargets, closeAll, () => "2026-10-12", audit, notify, save) as (account: {
      size: number;
      balance: number;
      dayKey: string;
      dayStartEq: number;
      highEq: number;
      days: number[];
      curve: Array<{ t: number; e: number }>;
      riskLock: string | null;
      w1: boolean;
      w2: boolean;
      userId: string;
      login: number;
      ch: Record<string, unknown>;
    }) => void;
    const account = {
      size: 50_000,
      balance: 54_000,
      dayKey: "old-day",
      dayStartEq: 54_000,
      highEq: 54_000,
      days: [1, 2, 3],
      curve: [{ t: 1, e: 54_000 }],
      riskLock: null,
      w1: true,
      w2: true,
      userId: "trader-1",
      login: 12345,
      ch: {
        status: "ACTIVE",
        programMode: "challenge",
        phaseTargets: [8, 5],
        profitPct: 8,
        phase2ProfitPct: 5,
        phase: 1,
        phaseCount: 2,
        startedAt: Date.now() - 1000,
      },
    };

    passCh(account);
    expect(account.ch).toMatchObject({ phase: 2, profitPct: 5, status: "ACTIVE" });
    expect(account.balance).toBe(50_000);
    expect(account.days).toEqual([]);
    expect(account.riskLock).toBeNull();

    passCh(account);
    expect(account.ch).toMatchObject({ phase: 2, profitPct: 5, status: "PASSED" });
    expect(account.ch.passAt).toEqual(expect.any(Number));
    expect(closeAll).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps broker simulation profiles separate from funded-program templates", () => {
    const templates = programTemplateRecords();
    const brokers = templates.filter((template) => template.programId === "broker_sim");

    expect(BROKER_SIM_TEMPLATES).toHaveLength(2);
    expect(brokers).toHaveLength(2);
    expect(brokers.map((template) => template.commissionPerLot)).toEqual([3, 0]);
    expect(brokers.every((template) => template.programMode === "broker_sim")).toBe(true);
  });

  it("starts staff-approved funding from the original account balance", () => {
    const fundedStart = page.indexOf("function startFundedPeriod(a){");
    const fundedEnd = page.indexOf("\nfunction goFunded", fundedStart);
    if (fundedStart < 0 || fundedEnd < 0) throw new Error("Could not find funded-period setup");
    const closeAll = vi.fn();
    const startFundedPeriod = new Function(
      "closeAll",
      "todayKey",
      `${page.slice(fundedStart, fundedEnd)}; return startFundedPeriod;`,
    )(closeAll, () => "funded-day") as (account: {
      size: number;
      balance: number;
      days: number[];
      curve: Array<{ t: number; e: number }>;
      dayKey: string;
      dayStartEq: number;
      highEq: number;
      riskLock: string | null;
      funded: boolean;
      fundedAt?: number;
      ch: { fundedAt?: number };
    }) => void;
    const account = {
      size: 25_000,
      balance: 27_000,
      days: [1, 2],
      curve: [{ t: 1, e: 27_000 }],
      dayKey: "evaluation-day",
      dayStartEq: 27_000,
      highEq: 27_000,
      riskLock: "challenge passed",
      funded: false,
      ch: {},
    };

    startFundedPeriod(account);
    expect(account.balance).toBe(25_000);
    expect(account.days).toEqual([]);
    expect(account.dayKey).toBe("funded-day");
    expect(account.dayStartEq).toBe(25_000);
    expect(account.highEq).toBe(25_000);
    expect(account.curve.at(-1)?.e).toBe(25_000);
    expect(account.funded).toBe(true);
    expect(account.riskLock).toBeNull();
    expect(account.fundedAt).toEqual(expect.any(Number));
    expect(account.ch.fundedAt).toBe(account.fundedAt);
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it("requires a staff-approved FUNDED status before creating a payout request", () => {
    const payoutStart = page.indexOf("function requestPayout(a){");
    const payoutEnd = page.indexOf("\nfunction scaleAccount", payoutStart);
    if (payoutStart < 0 || payoutEnd < 0) throw new Error("Could not find payout request logic");
    const db = {
      users: [{ id: "trader-1", email: "trader@example.com" }],
      riskRules: { requireKYC: false, consistencyPct: 40, payoutSplit: 80 },
      payouts: [] as Array<Record<string, unknown>>,
    };
    const requestPayout = new Function(
      "DB",
      "kycGate",
      "consistencyCheck",
      "accountPayoutShare",
      "uid",
      "audit",
      "user",
      "notify",
      "save",
      `${page.slice(payoutStart, payoutEnd)}; return requestPayout;`,
    )(
      db,
      () => null,
      (account: { balance: number; size: number }) => ({
        ok: true,
        best: 0,
        limit: 0,
        profit: account.balance - account.size,
      }),
      (account: { ch?: { payoutSplit?: number } }) => account.ch?.payoutSplit ?? 80,
      () => "payout-1",
      vi.fn(),
      () => null,
      vi.fn(),
      vi.fn(),
    ) as (account: {
      id: string;
      login: number;
      kind: string;
      userId: string;
      size: number;
      balance: number;
      ch: { status: string; payoutSplit: number; payoutCadenceDays: number };
    }) => string | null;
    const account = {
      id: "account-1",
      login: 12345,
      kind: "PROP",
      userId: "trader-1",
      size: 1000,
      balance: 1200,
      ch: { status: "PASSED", payoutSplit: 80, payoutCadenceDays: 0 },
    };

    expect(requestPayout(account)).toContain("staff approves");
    expect(db.payouts).toHaveLength(0);
    account.ch.status = "FUNDED";
    expect(requestPayout(account)).toBeNull();
    expect(db.payouts[0]).toMatchObject({ status: "PENDING", amount: 160, payoutSplit: 80 });
  });

  it("submits funding through the authenticated RPC and disables local wallet debits", () => {
    const bindReqStart = page.indexOf("function bindReq(){");
    const bindReqEnd = page.indexOf("\nfunction bindProp(", bindReqStart);
    const bindReq = page.slice(bindReqStart, bindReqEnd);

    expect(bindReq).toContain("CLOUD.sb.rpc('pf_create_funding_request'");
    expect(bindReq).toContain("p_program_code:t.programId");
    expect(bindReq).toContain("p_account_size:+t.size");
    expect(bindReq).not.toContain("DB.chRequests.unshift");
    expect(bindReq).not.toContain("wTx(");
    expect(page).toContain('id="rqWallet" disabled');
  });
});
