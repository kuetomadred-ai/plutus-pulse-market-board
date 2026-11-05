// Educational Ratchet Trap harness.
// Default mode is DRY-RUN: it never submits orders or closes positions.
// To run against an explicitly selected demo account, pass --execute and
// provide SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_ACCOUNT_ID, and
// DEMO_USER_ID. This script is intentionally capped and stops after a
// recharge/stop-out signal, so it cannot loop through repeated recharges.
import { createClient } from "@supabase/supabase-js";

const SYMBOL = process.env.RATCHET_SYMBOL ?? "XAUUSD";
const LOTS = 1;
const STEP = 1;
const POLL_MS = Math.max(1000, Number(process.env.RATCHET_POLL_MS ?? 2000));
const MAX_STEPS = Math.min(50, Math.max(1, Number(process.env.RATCHET_MAX_STEPS ?? 8)));
const MAX_MINUTES = Math.min(30, Math.max(1, Number(process.env.RATCHET_MAX_MINUTES ?? 10)));
const execute = process.argv.includes("--execute");
const accountId = process.env.DEMO_ACCOUNT_ID;
const userId = process.env.DEMO_USER_ID;

if (execute && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !accountId || !userId)) {
  throw new Error("--execute requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_ACCOUNT_ID, and DEMO_USER_ID");
}

const sb = createClient(process.env.SUPABASE_URL ?? "http://dry-run.invalid", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dry-run", {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Position = { id: string; side: "buy" | "sell"; lots: number; entry_price: number; status: string };
type Quote = { bid: number; ask: number };
type Instrument = { tick_size: number; tick_value: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const requestId = () => globalThis.crypto.randomUUID();

async function readState() {
  const [{ data: quote, error: quoteError }, { data: positions, error: positionError }, { data: instrument, error: instrumentError }, { data: account, error: accountError }] = await Promise.all([
    sb.from("pf_engine_quotes").select("bid,ask").eq("symbol", SYMBOL).single(),
    sb.from("pf_engine_positions").select("id,side,lots,entry_price,status").eq("account_id", accountId!).eq("status", "OPEN"),
    sb.from("pf_engine_instruments").select("tick_size,tick_value").eq("symbol", SYMBOL).single(),
    sb.from("pf_engine_accounts").select("balance,status,leverage").eq("id", accountId!).single(),
  ]);
  const error = quoteError ?? positionError ?? instrumentError ?? accountError;
  if (error) throw error;
  return { quote: quote as Quote, positions: (positions ?? []) as Position[], instrument: instrument as Instrument, account: account as { balance: number; status: string; leverage: number } };
}

function floatingPnl(position: Position, quote: Quote, instrument: Instrument) {
  const exit = position.side === "buy" ? quote.ask : quote.bid;
  return ((exit - position.entry_price) / instrument.tick_size) * instrument.tick_value * position.lots * (position.side === "buy" ? 1 : -1);
}

async function place(side: "buy" | "sell") {
  if (!execute) return null;
  const { data, error } = await sb.rpc("pf_engine_place_order", {
    p_user_id: userId!, p_account_id: accountId!, p_request_id: requestId(), p_symbol: SYMBOL,
    p_side: side, p_order_type: "MARKET", p_lots: LOTS, p_trigger: null, p_sl: null, p_tp: null,
  });
  if (error) throw error;
  const price = Number((data as { fill_price?: number })?.fill_price);
  if (!Number.isFinite(price)) throw new Error(`Server did not return a fill price for ${side}`);
  return price;
}

async function close(positionId: string) {
  if (!execute) return;
  const { error } = await sb.rpc("pf_engine_close_position", {
    p_user_id: userId!, p_position_id: positionId, p_request_id: requestId(),
  });
  if (error) throw error;
}

async function verifyDemoIdentity() {
  if (!execute) return;
  const { data, error } = await sb.auth.admin.getUserById(userId!);
  if (error) throw error;
  const email = data.user?.email ?? "";
  const demo = data.user?.user_metadata?.demo === true || email.startsWith("demo-") || email.endsWith("@demo.plutustrade.app");
  if (!demo) throw new Error("Refusing to run: DEMO_USER_ID is not marked as a demo identity");
}

async function main() {
  await verifyDemoIdentity();
  const started = Date.now();
  let steps = 0;
  let lastBuy: number | null = null;
  let lastSell: number | null = null;

  console.log(`[ratchet] ${execute ? "EXECUTE DEMO" : "DRY-RUN"} | ${SYMBOL} | lots=${LOTS} | step=$${STEP} | maxSteps=${MAX_STEPS}`);
  if (!execute) console.log("[ratchet] No database writes will be made. Add --execute only for an isolated demo account.");

  let state = await readState();
  if (state.account.status !== "ACTIVE") throw new Error(`Account is not ACTIVE: ${state.account.status}`);
  if (state.positions.length === 0) {
    lastBuy = await place("buy");
    lastSell = await place("sell");
    console.log(`[ratchet] initial hedge: BUY=${lastBuy ?? "would-open"} SELL=${lastSell ?? "would-open"}`);
  } else {
    lastBuy = [...state.positions].reverse().find((p) => p.side === "buy")?.entry_price ?? null;
    lastSell = [...state.positions].reverse().find((p) => p.side === "sell")?.entry_price ?? null;
  }

  while (Date.now() - started < MAX_MINUTES * 60_000 && steps < MAX_STEPS) {
    state = await readState();
    const equityEstimate = Number(state.account.balance) + state.positions.reduce((sum, p) => sum + floatingPnl(p, state.quote, state.instrument), 0);
    console.log(`[ratchet] bid=${state.quote.bid} ask=${state.quote.ask} balance=${state.account.balance} equity≈${equityEstimate.toFixed(2)} open=${state.positions.length} step=${steps}`);

    if (state.account.balance >= 1000 && steps > 0 && state.positions.length === 0) {
      console.log("[ratchet] recharge/stop-out detected; stopping without reopening the hedge");
      break;
    }
    if (equityEstimate <= 0) {
      console.log("[ratchet] equity reached zero; stopping");
      break;
    }

    if (lastSell !== null && state.quote.bid >= lastSell + STEP && steps < MAX_STEPS) {
      for (const position of state.positions.filter((p) => p.side === "buy" && floatingPnl(p, state.quote, state.instrument) > 0)) await close(position.id);
      const price = await place("sell");
      lastSell = price ?? state.quote.bid;
      steps++;
      console.log(`[ratchet] upward trigger: close profitable BUYs, add SELL at ≈${lastSell}`);
    }
    if (lastBuy !== null && state.quote.ask <= lastBuy - STEP && steps < MAX_STEPS) {
      for (const position of state.positions.filter((p) => p.side === "sell" && floatingPnl(p, state.quote, state.instrument) > 0)) await close(position.id);
      const price = await place("buy");
      lastBuy = price ?? state.quote.ask;
      steps++;
      console.log(`[ratchet] downward trigger: close profitable SELLs, add BUY at ≈${lastBuy}`);
    }
    await sleep(POLL_MS);
  }
  console.log(`[ratchet] finished after ${steps} step(s)`);
}

main().catch((error) => {
  console.error("[ratchet] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
