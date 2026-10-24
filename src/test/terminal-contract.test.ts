import { describe, expect, it } from 'vitest'
import { orderSchema, parseQuotes } from '../lib/terminal-contract'

describe('server terminal input', () => {
  const order = { accountId: '50001', requestId: 'fbbfe967-d0d4-4fa9-9303-e3ed026535d9', symbol: 'XAUUSD', side: 'buy', type: 'MARKET', lots: 0.01 }
  it('never accepts caller-supplied identity', () => {
    expect(orderSchema.safeParse({ ...order, userId: 'another-client' }).success).toBe(false)
    expect(orderSchema.safeParse(order).success).toBe(true)
  })
  it('requires a unique request key', () => {
    expect(orderSchema.safeParse({ ...order, requestId: undefined }).success).toBe(false)
  })
  it('accepts provider dictionary prices', () => {
    const now = Date.parse('2026-10-24T10:00:00Z')
    expect(parseQuotes({ XAUUSD: { symbol: 'XAUUSD', bid: 4000, ask: 4001, timestamp: '2026-10-24T09:59:59Z' } }, ['XAUUSD'], now)).toEqual([{ symbol: 'XAUUSD', bid: 4000, ask: 4001, quoteAt: '2026-10-24T09:59:59.000Z' }])
  })
  it('rejects a stale provider price rather than fabricating a fill', () => {
    expect(parseQuotes([{ symbol: 'XAUUSD', bid: 4000, ask: 4001, timestamp: '2026-10-24T10:00:00Z', stale: true }], ['XAUUSD'], Date.parse('2026-10-24T10:00:01Z'))).toEqual([])
  })
})