import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseQuotes } from "./terminal-contract";

const providerUrl = process.env["BIQUOTE_URL"] || "https://biquote.io";
const quoteTimeoutMs = 8000;
const maxAttempts = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchQuotes(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(quoteTimeoutMs) });
      if (!response.ok) throw new Error(`Market prices unavailable (${response.status})`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Market prices unavailable");
}

export async function refreshEngineQuotes() {
  const { data: instruments, error } = await supabaseAdmin
    .from("pf_engine_instruments")
    .select("symbol")
    .eq("enabled", true)
    .limit(100);
  if (error) throw new Error("Instrument catalogue unavailable");
  const symbols = instruments?.map((row) => row.symbol) ?? [];
  if (!symbols.length) return { processed: 0 };

  const query = new URLSearchParams();
  for (const symbol of symbols) query.append("symbols", symbol);
  const payload = await fetchQuotes(`${providerUrl.replace(/\/$/, "")}/api/latest?${query}`);
  const quotes = parseQuotes(payload, symbols);
  if (!quotes.length) throw new Error("No fresh market prices");

  let processed = 0;
  // Sequential ticks preserve quote ordering and keep database connections bounded.
  for (const quote of quotes) {
    const { error: tickError } = await supabaseAdmin.rpc("pf_engine_process_tick", {
      p_symbol: quote.symbol,
      p_bid: quote.bid,
      p_ask: quote.ask,
      p_quote_at: quote.quoteAt,
    });
    if (tickError) throw new Error(`Quote processing failed for ${quote.symbol}`);
    processed++;
  }
  const { error: riskError } = await supabaseAdmin.rpc("pf_engine_evaluate_all");
  if (riskError) throw new Error("Risk evaluation failed");
  return { processed };
}
