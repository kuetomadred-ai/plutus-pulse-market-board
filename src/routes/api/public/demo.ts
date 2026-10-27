import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Educational paper account: one persistent server-side identity per device.
export const Route = createFileRoute("/api/public/demo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        try {
          const { deviceId } = z
            .object({ deviceId: z.string().uuid() })
            .parse(await request.json());
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const email = `demo-${deviceId}@demo.plutustrade.app`;
          const bytes = crypto.getRandomValues(new Uint8Array(18));
          const password =
            "D" + btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, "x") + "#9";
          const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
          if (listError) throw new Error("Could not inspect demo identity");
          const existing = users.users.find((user) => user.email === email);
          let userId = existing?.id;
          if (existing) {
            const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
              password,
            });
            if (error) throw new Error("Could not refresh demo identity");
          } else {
            const { data, error } = await supabaseAdmin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
              user_metadata: { full_name: "Demo Trader", demo: true, educational: true },
            });
            if (error || !data.user) throw new Error("Failed to create demo identity");
            userId = data.user.id;
          }
          if (!userId) throw new Error("Demo identity is unavailable");

          const { data: account, error: accountError } = await supabaseAdmin
            .from("pf_engine_accounts")
            .select("id")
            .eq("user_id", userId)
            .maybeSingle();
          if (accountError) throw new Error("Could not read demo account");
          if (account)
            return Response.json(
              { email, password, login: account.id, persistent: true, paper: true },
              { headers },
            );

          let accountId = "";
          for (let i = 0; i < 5; i += 1) {
            const candidate = String(7000000 + Math.floor(Math.random() * 2999999));
            const { error } = await supabaseAdmin.from("pf_engine_accounts").insert({
              id: candidate,
              user_id: userId,
              initial_balance: 10000,
              balance: 10000,
              leverage: 100,
              program: "PAPER",
              phase: 1,
              day_start_balance: 10000,
              min_equity: 10000,
              status: "ACTIVE",
              challenge_status: "ACTIVE",
            });
            if (!error) {
              accountId = candidate;
              break;
            }
          }
          if (!accountId) throw new Error("Could not create demo account");
          return Response.json(
            { email, password, login: accountId, persistent: true, paper: true },
            { headers },
          );
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Invalid request" },
            { status: 400, headers },
          );
        }
      },
    },
  },
});
