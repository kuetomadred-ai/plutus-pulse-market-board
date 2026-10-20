import { createClient } from "@supabase/supabase-js";
import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { pathToFileURL } from "node:url";
import { parseEngineTick } from "./domain.js";
import { setEngineStatus } from "./runtime-state.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const providerUrl = process.env.BIQUOTE_URL ?? "https://biquote.io";
const allowed = new Set(
  (
    process.env.ENGINE_SYMBOLS ??
    "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,XAUUSD,XAGUSD,US500,USTEC,US30"
  )
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);
const seen = new Map<string, number>();
const minTickIntervalMs = 250;
let stopping = false;

async function loadInstruments() {
  const response = await fetch(`${providerUrl}/api/symbols?quotedWithinDays=7`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Biquote catalogue HTTP ${response.status}`);
  const items: unknown = await response.json();
  if (!Array.isArray(items)) throw new Error("Invalid Biquote catalogue");
  const rows = (items as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const symbol = String(raw.name ?? "").toUpperCase();
    const tickSize = Number(raw.tickSize);
    const tickValue = Number(raw.tickValue);
    const contractSize = Number(raw.contractSize ?? 1);
    if (!allowed.has(symbol) || !(tickSize > 0) || !(tickValue > 0) || !(contractSize > 0))
      return [];
    return [
      {
        symbol,
        tick_size: tickSize,
        tick_value: tickValue,
        contract_size: contractSize,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
    ];
  });
  if (!rows.length)
    throw new Error(
      "No allow-listed instruments with provider tick-value metadata; engine refuses unsafe valuation",
    );
  const { error } = await supabase
    .from("pf_engine_instruments")
    .upsert(rows, { onConflict: "symbol" });
  if (error) throw error;
  return rows.map((x) => x.symbol);
}

export async function startWorker() {
  stopping = false;
  setEngineStatus("starting");
  let symbols: string[];
  try {
    symbols = await loadInstruments();
  } catch (error) {
    setEngineStatus("error", error);
    throw error;
  }
  const symbolSet = new Set(symbols);
  console.info(`Loaded ${symbols.length} server-valued instruments`);
  const connection = new HubConnectionBuilder()
    .withUrl(`${providerUrl}/hubs/tick`, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect([1000, 2000, 5000, 10000, 30000])
    .configureLogging(LogLevel.Warning)
    .build();

  const onTick = async (tick: unknown) => {
    if (stopping || !tick) return;
    const quote = parseEngineTick(tick, symbolSet);
    if (!quote) return;
    const { symbol, bid, ask, quoteAt } = quote;
    const now = Date.now();
    if (now - (seen.get(symbol) ?? 0) < minTickIntervalMs) return;
    seen.set(symbol, now);
    try {
      const { error } = await supabase.rpc("pf_engine_process_tick", {
        p_symbol: symbol,
        p_bid: bid,
        p_ask: ask,
        p_quote_at: quoteAt.toISOString(),
      });
      if (error) console.error("tick rejected", symbol, error.message);
    } catch (error) {
      console.error("tick processing failed", symbol, error);
    }
  };

  connection.on("ReceiveTick", onTick);
  connection.on("Tick", onTick);
  connection.onreconnecting((error) => setEngineStatus("reconnecting", error));
  connection.onreconnected(() => {
    void connection
      .invoke("Subscribe", symbols)
      .then(() => {
        setEngineStatus("connected");
        console.info("Biquote reconnected");
      })
      .catch((error) => {
        setEngineStatus("reconnecting", error);
        console.error("Biquote resubscribe failed", error);
      });
  });
  connection.onclose((error) => {
    if (!stopping) {
      setEngineStatus("disconnected", error);
      console.error("Biquote disconnected", error?.message);
    }
  });

  setEngineStatus("connecting");
  try {
    await connection.start();
    await connection.invoke("Subscribe", symbols);
    setEngineStatus("connected");
  } catch (error) {
    setEngineStatus("error", error);
    await connection.stop().catch(() => undefined);
    throw error;
  }
  console.info("Server-side paper engine running; broker execution is disabled");

  return async () => {
    if (stopping) return;
    stopping = true;
    setEngineStatus("stopping");
    try {
      await connection.stop();
    } finally {
      setEngineStatus("disconnected");
    }
  };
}

async function main() {
  const stop = await startWorker();
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Engine startup failed", error);
    process.exitCode = 1;
  });
}
