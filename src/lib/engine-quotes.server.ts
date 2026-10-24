import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { parseQuotes } from './terminal-contract'

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
  let processed = 0
  // Sequential ticks preserve account/quote transaction ordering and connection limits.
  for (const quote of parseQuotes(payload, symbols)) {
    const { error: tickError } = await supabaseAdmin.rpc('pf_engine_process_tick', { p_symbol: quote.symbol, p_bid: quote.bid, p_ask: quote.ask, p_quote_at: quote.quoteAt })
    if (tickError) throw new Error('Quote processing failed')
    processed++
  }
  const { error: riskError } = await supabaseAdmin.rpc('pf_engine_evaluate_all')
  if (riskError) throw new Error('Risk evaluation failed')
  return { processed }
}