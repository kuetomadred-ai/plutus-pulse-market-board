import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pathToFileURL } from "node:url";
import { getEngineStatus } from "./runtime-state.js";
import { orderPayloadSchema } from "./domain.js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const supabaseUrl = env("SUPABASE_URL");
const anonKey = env("SUPABASE_ANON_KEY");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = Fastify({ logger: true, bodyLimit: 16_384, trustProxy: false });
app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    reply.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin");
    reply
      .header("Access-Control-Allow-Headers", "authorization,content-type")
      .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  } else if (origin && !allowedOrigins.includes(origin)) {
    return reply.code(403).send({ error: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") return reply.code(204).send();
});

async function auth(request: { headers: { authorization?: string } }) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  // Validate every user token with Supabase Auth; never trust a user_id from the request body.
  const verifier = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, role: data.user.app_metadata?.role as string | undefined };
}
async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await auth(request);
  if (!user) {
    await reply.code(401).send({ error: "Valid Supabase session required" });
    return null;
  }
  return user;
}
function rpcError(error: { message: string; code?: string }) {
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : error.code === "55000"
          ? 409
          : 400;
  return { status, body: { error: error.message } };
}

app.get("/health", async () => ({
  ok: true,
  service: "paper-trading-api",
  brokerConnected: getEngineStatus().brokerConnected,
  engineStatus: getEngineStatus().status,
}));
app.post("/v1/admin/accounts", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (user.role !== "ADMIN") return reply.code(403).send({ error: "ADMIN role required" });
  const parsed = z
    .object({
      userId: z.string().uuid(),
      accountId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
      initialBalance: z.number().positive().max(10_000_000),
      leverage: z.number().min(1).max(1000).default(100),
    })
    .safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ error: "Invalid account provisioning request", issues: parsed.error.issues });
  const { data, error } = await adminClient.rpc("pf_engine_provision_account", {
    p_admin_id: user.id,
    p_user_id: parsed.data.userId,
    p_account_id: parsed.data.accountId,
    p_initial_balance: parsed.data.initialBalance,
    p_leverage: parsed.data.leverage,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return reply.code(201).send(data);
});
app.post("/v1/orders", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const parsed = orderPayloadSchema.safeParse(request.body);
  if (!parsed.success)
    return reply.code(400).send({ error: "Invalid order", issues: parsed.error.issues });
  const x = parsed.data;
  const { data, error } = await adminClient.rpc("pf_engine_place_order", {
    p_user_id: user.id,
    p_account_id: x.accountId,
    p_request_id: x.requestId,
    p_symbol: x.symbol,
    p_side: x.side,
    p_order_type: x.type,
    p_lots: x.lots,
    p_trigger: x.price ?? null,
    p_sl: x.stopLoss ?? null,
    p_tp: x.takeProfit ?? null,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return reply.code(201).send(data);
});
app.post("/v1/positions/:id/close", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z.object({ requestId: z.string().uuid() }).safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Position id and idempotency key must be UUIDs" });
  const { data, error } = await adminClient.rpc("pf_engine_close_position", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_request_id: body.data.requestId,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return data;
});
app.post("/v1/positions/:id/close-partial", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({ requestId: z.string().uuid(), lots: z.number().min(0.01).max(99.99) })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid partial close request" });
  const { data, error } = await adminClient.rpc("pf_engine_close_partial", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_close_lots: body.data.lots,
    p_request_id: body.data.requestId,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return data;
});
app.post("/v1/positions/:id/protection", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({
      stopLoss: z.number().positive().nullable(),
      takeProfit: z.number().positive().nullable(),
    })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid protection request" });
  const { data, error } = await adminClient.rpc("pf_engine_modify_position", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_sl: body.data.stopLoss,
    p_tp: body.data.takeProfit,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return data;
});
app.post("/v1/orders/:id/cancel", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid order id" });
  const { data, error } = await adminClient.rpc("pf_engine_cancel_order", {
    p_user_id: user.id,
    p_order_id: params.data.id,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return data;
});
app.post("/v1/orders/:id/modify", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({
      price: z.number().positive(),
      stopLoss: z.number().positive().nullable(),
      takeProfit: z.number().positive().nullable(),
    })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid order modification" });
  const { data, error } = await adminClient.rpc("pf_engine_modify_order", {
    p_user_id: user.id,
    p_order_id: params.data.id,
    p_trigger: body.data.price,
    p_sl: body.data.stopLoss,
    p_tp: body.data.takeProfit,
  });
  if (error) {
    const e = rpcError(error);
    return reply.code(e.status).send(e.body);
  }
  return data;
});
app.get("/v1/accounts", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { data, error } = await adminClient
    .from("pf_engine_accounts")
    .select("id,initial_balance,balance,leverage,status,created_at,updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return reply.code(503).send({ error: "Trading accounts unavailable" });
  return { accounts: data ?? [] };
});
app.get("/v1/accounts/:id/state", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().min(1).max(80) }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid account id" });
  const { data: account, error } = await adminClient
    .from("pf_engine_accounts")
    .select("id,initial_balance,balance,leverage,status,updated_at")
    .eq("id", params.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return reply.code(503).send({ error: "Trading database unavailable" });
  if (!account) return reply.code(404).send({ error: "Account not found" });
  const [
    { data: positions, error: pErr },
    { data: orders, error: oErr },
    { data: ledger, error: lErr },
    { data: history, error: hErr },
  ] = await Promise.all([
    adminClient
      .from("pf_engine_positions")
      .select(
        "id,order_id,symbol,side,lots,entry_price,stop_loss,take_profit,status,opened_at,closed_at,exit_price,realized_pnl,close_reason",
      )
      .eq("account_id", account.id)
      .eq("user_id", user.id)
      .order("opened_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_orders")
      .select(
        "id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status,reason,created_at",
      )
      .eq("account_id", account.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_ledger")
      .select("id,position_id,event,amount,balance_after,details,created_at")
      .eq("account_id", account.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_trades_history")
      .select(
        "id,position_id,symbol,side,lots,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at",
      )
      .eq("account_id", account.id)
      .eq("user_id", user.id)
      .order("closed_at", { ascending: false })
      .limit(500),
  ]);
  if (pErr || oErr || lErr || hErr)
    return reply.code(503).send({ error: "Trading state unavailable" });
  return { account, positions, orders, ledger, history };
});

export async function startApi() {
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ host: "0.0.0.0", port });
  return app;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await startApi();
