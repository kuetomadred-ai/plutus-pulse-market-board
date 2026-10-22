import { supabaseAdmin } from '@/integrations/supabase/client.server'

export async function refreshEngineQuotes() {
  const { data: instruments, error } = await supabaseAdmin.from('pf_engine_instruments').select('symbol').eq('enabled', true)
  if (error) throw new Error('Instrument catalogue unavailable')
  const symbols = instruments?.map(row => row.symbol) ?? []
  if (!symbols.length) return { processed: 0 }
  const query = new URLSearchParams()
  for (const symbol of symbols) query.append('symbols', symbol)
  const response = await fetch(`https://biquote.io/api/latest?${query}`, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Market prices unavailable')
  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) throw new Error('Invalid market response')
  let processed = 0
  // Sequential ticks preserve account/quote transaction ordering and connection limits.
  for (const raw of payload) {
    const symbol = String(raw?.symbol ?? raw?.name ?? '').toUpperCase()
    const bid = Number(raw?.bid), ask = Number(raw?.ask)
    const quoteAt = new Date(raw?.timestamp ?? raw?.time ?? raw?.quoteAt ?? '').getTime()
    if (!symbols.includes(symbol) || !Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask < bid || !Number.isFinite(quoteAt)) continue
    if (raw.stale === true || Date.now() - quoteAt > 15000 || quoteAt > Date.now() + 5000) continue
    const { error: tickError } = await supabaseAdmin.rpc('pf_engine_process_tick', { p_symbol: symbol, p_bid: bid, p_ask: ask, p_quote_at: new Date(quoteAt).toISOString() })
    if (tickError) throw new Error('Quote processing failed')
    processed++
  }
  const { error: riskError } = await supabaseAdmin.rpc('pf_engine_evaluate_all')
  if (riskError) throw new Error('Risk evaluation failed')
  return { processed }
}