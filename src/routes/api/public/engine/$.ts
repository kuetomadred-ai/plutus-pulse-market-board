import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/engine/$')({
  server: { handlers: {
    GET: async ({ request, params }) => {
      const { handleTerminalRequest } = await import('@/lib/terminal-engine.server')
      return handleTerminalRequest(request, params._splat ?? '')
    },
    POST: async ({ request, params }) => {
      const { handleTerminalRequest } = await import('@/lib/terminal-engine.server')
      return handleTerminalRequest(request, params._splat ?? '')
    },
  } },
})