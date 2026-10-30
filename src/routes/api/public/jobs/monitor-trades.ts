import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/monitor-trades")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const failure = await authenticateCronRequest(request);
        if (failure) return failure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const workerDb = supabaseAdmin as SupabaseClient;
        const claim = await workerDb.rpc("pf_engine_worker_claim", {
          p_worker_name: "engine-tick",
          p_lease_seconds: 240,
        });
        if (claim.error)
          return Response.json({ error: "Worker lock unavailable" }, { status: 503 });
        const leaseId = claim.data as string | null;
        if (!leaseId) return Response.json({ ok: true, skipped: "already-running" });
        let processed = 0;
        try {
          const { refreshEngineQuotes } = await import("@/lib/engine-quotes.server");
          const result = await refreshEngineQuotes();
          processed = result.processed;
          const release = await workerDb.rpc("pf_engine_worker_release", {
            p_worker_name: "engine-tick",
            p_lease_id: leaseId,
            p_status: "ok",
            p_processed: processed,
          });
          if (release.error || release.data !== true)
            return Response.json(
              { error: "Worker lease release failed", processed },
              { status: 503 },
            );
          return Response.json({ ...result, ok: true });
        } catch {
          const release = await workerDb.rpc("pf_engine_worker_release", {
            p_worker_name: "engine-tick",
            p_lease_id: leaseId,
            p_status: "error",
            p_processed: processed,
            p_error: "Price monitoring unavailable",
          });
          if (release.error || release.data !== true)
            return Response.json(
              { error: "Worker lease release failed", processed },
              { status: 503 },
            );
          return Response.json(
            { error: "Price monitoring unavailable", processed },
            { status: 503 },
          );
        }
      },
    },
  },
});
