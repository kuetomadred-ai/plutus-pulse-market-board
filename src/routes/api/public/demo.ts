import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

// Creates one persistent server-side demo account per device. The device keeps the
// returned credentials; trades then run through the same server engine and monitor.
export const Route = createFileRoute('/api/public/demo')({
  server: { handlers: {
    POST: async ({ request }) => {
      const headers = { 'Cache-Control': 'no-store' }
      try {
        const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(await request.json())
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const email = `demo-${deviceId}@demo.plutustrade.app`
        const bytes = crypto.getRandomValues(new Uint8Array(18))
        const password = 'D' + btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, 'x') + '#9'
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: 'Demo Trader', demo: true },
        })
        if (error || !data.user) return Response.json({ error: 'Device already registered' }, { status: 409, headers })
        for (let i = 0; i < 5; i++) {
          const id = String(7000000 + Math.floor(Math.random() * 2999999))
          const { error: e } = await supabaseAdmin.from('pf_engine_accounts').insert({
            id, user_id: data.user.id, initial_balance: 10000, balance: 10000, leverage: 100,
            program: 'PAPER', phase: 1, day_start_balance: 10000, min_equity: 10000,
            status: 'ACTIVE', challenge_status: 'ACTIVE',
          })
          if (!e) return Response.json({ email, password, login: id }, { headers })
        }
        return Response.json({ error: 'Could not create account' }, { status: 500, headers })
      } catch {
        return Response.json({ error: 'Invalid request' }, { status: 400, headers })
      }
    },
  } },
})
