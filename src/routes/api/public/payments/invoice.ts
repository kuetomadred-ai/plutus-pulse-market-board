import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rest } from "@/lib/nowpayments.server";

const Body = z.object({ templateId: z.string().min(1).max(60) });

type Template = { id: string; programId?: string; size?: number; fee?: number; broker?: boolean };

export const Route = createFileRoute("/api/public/payments/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });

        const u = await rest("/auth/v1/user", { token });
        if (!u.ok) return new Response("Unauthorized", { status: 401 });
        const user = (await u.json()) as { id: string };

        const apiKey = process.env["NOWPAYMENTS_API_KEY"];
        if (!apiKey || !process.env["PLOTOS_SERVICE_ROLE_KEY"])
          return new Response("Payments not configured", { status: 503 });

        // Price comes from the ADMIN-managed firm catalogue, never from the browser.
        const f = await rest("/rest/v1/pf_firm?id=eq.firm&select=blob", { token });
        const firm = f.ok ? ((await f.json()) as { blob?: { templates?: Template[] } }[])[0] : null;
        const t = firm?.blob?.templates?.find((x) => x.id === parsed.data.templateId);
        const fee = Number(t?.fee ?? 0);
        const size = Number(t?.size ?? 0);
        const code = String(t?.programId ?? "")
          .replace(/[^A-Za-z0-9_-]/g, "")
          .slice(0, 40);
        if (!t || t.broker || !(fee > 0) || !(size > 0) || code.length < 2)
          return new Response("Program unavailable", { status: 422 });

        // Create the PENDING funding request as the signed-in user.
        const fr = await rest("/rest/v1/rpc/pf_create_funding_request", {
          token,
          method: "POST",
          body: JSON.stringify({ p_program_code: code, p_account_size: size }),
        });
        if (!fr.ok) return new Response("Request failed", { status: 502 });
        const requestId = String(await fr.json());

        const origin = new URL(request.url).origin;
        const inv = await fetch("https://api.nowpayments.io/v1/invoice", {
          method: "POST",
          headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            price_amount: fee,
            price_currency: "usd",
            order_id: requestId,
            order_description: "PLUTUS simulated program fee",
            ipn_callback_url: `${origin}/api/public/payments/webhook`,
            success_url: `${origin}/?payment=success`,
            cancel_url: `${origin}/?payment=cancel`,
          }),
        });
        if (!inv.ok) return new Response("Invoice failed", { status: 502 });
        const invoice = (await inv.json()) as { id: string; invoice_url: string };

        const saved = await rest("/rest/v1/pf_payments", {
          admin: true,
          method: "POST",
          body: JSON.stringify({
            user_id: user.id,
            funding_request_id: requestId,
            provider_invoice_id: String(invoice.id),
            amount_usd: fee,
          }),
        });
        if (!saved.ok) return new Response("Payment record failed", { status: 502 });
        return Response.json({ url: invoice.invoice_url, requestId });
      },
    },
  },
});
