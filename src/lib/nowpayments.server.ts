// Server-only helpers for NOWPayments and the PLUTUS database.
// The payment database must be the same project as the application. Never hard-code
// a URL or publishable key here: deployments provide these values as server config.
export const PLOTOS_SB_URL = process.env["PLOTOS_SB_URL"] ?? process.env["SUPABASE_URL"] ?? "";
export const PLOTOS_SB_KEY =
  process.env["PLOTOS_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((o, k) => {
        o[k] = sortDeep((v as Record<string, unknown>)[k]);
        return o;
      }, {});
  }
  return v;
}

/** NOWPayments IPN: HMAC-SHA512 over JSON with keys sorted, hex. */
export async function verifyIpn(body: unknown, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(sortDeep(body))),
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export function rest(path: string, init: RequestInit & { token?: string; admin?: boolean } = {}) {
  const service =
    process.env["PLOTOS_SERVICE_ROLE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!PLOTOS_SB_URL || !PLOTOS_SB_KEY) {
    throw new Error("Payment Supabase configuration is missing");
  }
  if (init.admin && !service) throw new Error("PLOTOS_SERVICE_ROLE_KEY missing");
  // sb_secret_ keys are opaque (not JWTs): send only as apikey, never as Bearer.
  const auth = init.admin ? (service!.startsWith("sb_secret_") ? undefined : service) : init.token;
  return fetch(`${PLOTOS_SB_URL}${path}`, {
    ...init,
    headers: {
      apikey: init.admin ? service! : PLOTOS_SB_KEY,
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
