import { createFileRoute } from '@tanstack/react-router'
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth'

export const Route = createFileRoute('/api/public/jobs/monitor-trades')({
  server: { handlers: { POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request)
    if (failure) return failure
    try {
      const { refreshEngineQuotes } = await import('@/lib/engine-quotes.server')
      return Response.json(await refreshEngineQuotes())
    } catch {
      return Response.json({ error: 'Price monitoring unavailable' }, { status: 503 })
    }
  } } },
})