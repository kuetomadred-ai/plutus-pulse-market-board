import { z } from "zod";

export const orderPayloadSchema = z
  .object({
    accountId: z.string().min(1).max(80),
    requestId: z.string().uuid(),
    symbol: z.string().regex(/^[A-Z0-9_]{2,20}$/),
    side: z.enum(["buy", "sell"]),
    type: z.enum(["MARKET", "LIMIT", "STOP"]),
    lots: z.number().finite().min(0.01).max(100),
    price: z.number().positive().optional(),
    stopLoss: z.number().positive().optional(),
    takeProfit: z.number().positive().optional(),
  })
  .strict();

export type EngineQuote = { symbol: string; bid: number; ask: number; quoteAt: Date };
export function parseEngineTick(
  tick: unknown,
  allowedSymbols: ReadonlySet<string>,
  now = Date.now(),
): EngineQuote | null {
  if (!tick || typeof tick !== "object") return null;
  const raw = tick as Record<string, unknown>;
  const symbol = String(raw.symbol ?? "").toUpperCase();
  const bid = Number(raw.bid),
    ask = Number(raw.ask);
  const rawTime = raw.time ?? raw.timestamp ?? now;
  const numeric =
    typeof rawTime === "string" && !/^\d+(\.\d+)?$/.test(rawTime)
      ? Date.parse(rawTime)
      : Number(rawTime);
  if (!allowedSymbols.has(symbol) || !(bid > 0) || !(ask >= bid) || !Number.isFinite(numeric))
    return null;
  const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
  if (milliseconds > now + 5_000 || milliseconds < now - 30_000) return null;
  return { symbol, bid, ask, quoteAt: new Date(milliseconds) };
}
