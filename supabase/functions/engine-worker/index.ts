import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Quote = { symbol: string; bid: number; ask: number; quoteAt: string };

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const workerSecret = Deno.env.get("ENGINE_WORKER_SECRET");
const providerUrl = Deno.env.get("BIQUOTE_URL") ?? "https://biquote.io";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function parseQuotes(payload: unknown, symbols: string[], now = Date.now()): Quote[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.values(payload)
      : [];
  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const symbol = String(item.symbol ?? "").toUpperCase();
    const bid = Number(item.bid);
    const ask = Number(item.ask);
    const rawTime = item.timestamp ?? item.quoteAt ?? item.time;
    const milliseconds =
      typeof rawTime === "number"
        ? rawTime < 1e12
          ? rawTime * 1000
          : rawTime
        : Date.parse(String(rawTime ?? ""));
    if (
      !symbols.includes(symbol) ||
      !Number.isFinite(bid) ||
      bid <= 0 ||
      !Number.isFinite(ask) ||
      ask < bid ||
      !Number.isFinite(milliseconds) ||
      item.stale === true ||
      milliseconds < now - 15_000 ||
      milliseconds > now + 5_000
    ) return [];
    return [{ symbol, bid, ask, quoteAt: new Date(milliseconds).toISOString() }];
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  if (!supabaseUrl || !serviceKey || !workerSecret) return json({ error: "Worker is not configured" }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${workerSecret}`) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimed, error: claimError } = await supabase.rpc("pf_engine_worker_claim", {
    p_worker_name: "engine-tick",
      p_lease_seconds: 240,
  });
  if (claimError) return json({ error: "Worker lock unavailable" }, 503);
  if (!claimed) return json({ ok: true, skipped: "already-running" });

  let processed = 0;
  try {
    const { data: instruments, error: instrumentError } = await supabase
      .from("pf_engine_instruments")
      .select("symbol")
      .eq("enabled", true)
      .limit(100);
    if (instrumentError) throw instrumentError;
    const symbols = (instruments ?? []).map((row) => row.symbol).filter(Boolean);
    if (!symbols.length) throw new Error("No enabled instruments");

    const query = new URLSearchParams(symbols.map((symbol) => ["symbols", symbol]));
    const response = await fetch(`${providerUrl}/api/latest?${query}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Quote provider HTTP ${response.status}`);
    const quotes = parseQuotes(await response.json(), symbols);
    if (!quotes.length) throw new Error("No fresh quotes");

    for (const quote of quotes) {
      const { error } = await supabase.rpc("pf_engine_process_tick", {
        p_symbol: quote.symbol,
        p_bid: quote.bid,
        p_ask: quote.ask,
        p_quote_at: quote.quoteAt,
      });
      if (error) throw new Error(`Tick ${quote.symbol} failed: ${error.message}`);
      processed += 1;
    }
    const { error: riskError } = await supabase.rpc("pf_engine_evaluate_all");
    if (riskError) throw riskError;
    await supabase.rpc("pf_engine_worker_release", {
      p_worker_name: "engine-tick",
      p_status: "ok",
      p_processed: processed,
    });
    return json({ ok: true, processed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker failed";
    await supabase.rpc("pf_engine_worker_release", {
      p_worker_name: "engine-tick",
      p_status: "error",
      p_processed: processed,
      p_error: message,
    });
    return json({ error: "Background engine tick failed", processed }, 503);
  }
});
