import { z } from 'zod'

export const orderSchema = z.object({
  accountId: z.string().min(1).max(80), requestId: z.string().uuid(),
  symbol: z.string().regex(/^[A-Z0-9_]{2,20}$/), side: z.enum(['buy', 'sell']),
  type: z.enum(['MARKET', 'LIMIT', 'STOP']), lots: z.number().finite().min(0.01).max(100),
  price: z.number().positive().optional(), stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
}).strict()

export function parseQuotes(payload: unknown, symbols: string[], now = Date.now()) {
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? Object.values(payload) : []
  return rows.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    const symbol = String(r['symbol'] ?? '').toUpperCase(), bid = Number(r['bid']), ask = Number(r['ask'])
    const time = r['timestamp'] ?? r['quoteAt'] ?? r['time']
    const quoteAt = typeof time === 'number' ? (time < 1e12 ? time * 1000 : time) : Date.parse(String(time ?? ''))
    if (!symbols.includes(symbol) || !Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask < bid || !Number.isFinite(quoteAt)) return []
    if (r['stale'] === true || quoteAt < now - 15000 || quoteAt > now + 5000) return []
    return [{ symbol, bid, ask, quoteAt: new Date(quoteAt).toISOString() }]
  })
}