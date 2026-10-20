import { createFileRoute } from "@tanstack/react-router";
import { rest, verifyIpn } from "@/lib/nowpayments.server";

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["NOWPAYMENTS_IPN_SECRET"];
        const sig = request.headers.get("x-nowpayments-sig");
        if (!secret || !sig) return new Response("Unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || !(await verifyIpn(body, sig, secret)))
          return new Response("Invalid signature", { status: 401 });

        const invoiceId = String(body["invoice_id"] ?? "");
        if (!invoiceId) return new Response("ok");
        // Records payment status only. The funding request stays PENDING for staff review.
        await rest(`/rest/v1/pf_payments?provider_invoice_id=eq.${encodeURIComponent(invoiceId)}`, {
          admin: true,
          method: "PATCH",
          body: JSON.stringify({
            status: String(body["payment_status"] ?? "unknown").slice(0, 32),
            provider_payment_id: String(body["payment_id"] ?? ""),
            pay_currency: String(body["pay_currency"] ?? "").slice(0, 16),
            raw: body,
            updated_at: new Date().toISOString(),
          }),
        });
        return new Response("ok");
      },
    },
  },
});
